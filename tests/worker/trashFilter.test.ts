// 휴지통 거르기 가드 — worker/*.ts 의 docs 질의 조각은 deleted_at 이 있거나 ALLOW 에 있어야 한다 (specs/features/F-3022.md 4장)
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

type Allow = { file: string; owner: string; count: number; reason: string }
type Hit = { file: string; owner: string; line: number; text: string }

const WORKER = fileURLToPath(new URL('../../worker/', import.meta.url))
const DOCS_SQL = /(FROM|JOIN|UPDATE|INTO) docs\b|docs d\b/

// F-3022 3장 허용 30 — F-3023·이후 명세가 고친다
const ALLOW: Allow[] = [
  { file: 'accessRequestNotifications.ts', owner: 'INSERT_SQL', count: 1, reason: '이미 거른 요청의 제목' },
  { file: 'account.ts', owner: 'COUNTS_SQL', count: 1, reason: '계정 삭제는 휴지통까지 즉시(F-2038)' },
  { file: 'account.ts', owner: 'SHARED_DOCS_SQL', count: 1, reason: '계정 삭제는 휴지통까지 즉시(F-2038)' },
  { file: 'account.ts', owner: 'deleteAccountStatements', count: 2, reason: '계정 삭제는 휴지통까지 즉시(F-2038)' },
  { file: 'attachmentGc.ts', owner: 'collectPlainReferencedIds', count: 1, reason: '휴지통 본문의 첨부를 지키려 셈' },
  { file: 'attachmentGc.ts', owner: 'collectE2eeDocReferencedIds', count: 1, reason: '휴지통 본문의 첨부를 지키려 셈' },
  { file: 'attachments.ts', owner: 'isAttachmentInUse', count: 2, reason: '휴지통 본문의 첨부를 지키려 셈' },
  { file: 'commentGc.ts', owner: 'NO_DOC', count: 1, reason: '휴지통 문서 댓글을 남김' },
  { file: 'commentRows.ts', owner: 'WROTE_KEY', count: 1, reason: '키 확인 — 휴지통 행도 대상' },
  { file: 'commentRows.ts', owner: 'OWNER_DOCS', count: 1, reason: '지우기 — 휴지통 행도 대상' },
  { file: 'docRoomCore.ts', owner: 'UPDATE_SQL', count: 1, reason: '휴지통 행에도 마지막 편집을 쓴다' },
  { file: 'docs.ts', owner: 'handleCreateDoc', count: 2, reason: 'id 검사는 SELECT * 로 deleted_at 을 읽어 갈래 · INSERT' },
  { file: 'docs.ts', owner: 'deleteDocRows', count: 1, reason: '영구 삭제' },
  { file: 'e2eeDocs.ts', owner: 'WROTE_KEY', count: 1, reason: '같은 batch 의 MOVE_ROW_SQL 이 이미 거름' },
  { file: 'e2eeKeys.ts', owner: 'E2EE_COUNTS_SQL', count: 1, reason: '휴지통 금고 문서도 남은 금고 문서(F-3021 Q2)' },
  { file: 'e2eeKeys.ts', owner: 'DELETE_SQL', count: 1, reason: '휴지통 금고 문서도 남은 금고 문서(F-3021 Q2)' },
  { file: 'folders.ts', owner: 'deleteFolderContents', count: 1, reason: 'move-up — 휴지통 문서도 따라 올라가 복원 자리가 산다 (F-3023)' },
  { file: 'githubImages.ts', owner: 'isGithubImageInUse', count: 1, reason: '사용 판정' },
  { file: 'githubImages.ts', owner: 'collectGithubImageRefs', count: 1, reason: '사용 판정' },
  { file: 'usage.ts', owner: 'DELETE_DOC_SQL', count: 1, reason: '용량은 휴지통도 셈' },
  { file: 'usage.ts', owner: 'E2EE_COMMENT_BYTES_OUT_SQL', count: 1, reason: '용량은 휴지통도 셈' },
]

// 주인 = 가장 가까운 함수·메서드 선언, 없으면 조각을 품은 최상위 const
function scanDocsSql(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const hits: Hit[] = []
  const visit = (node: ts.Node, owner: string): void => {
    let next = owner
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) next = node.name.getText(sf)
    else if (ts.isVariableStatement(node) && node.parent === sf) next = node.declarationList.declarations[0].name.getText(sf)
    const piece =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
        ? node.text
        : null
    if (piece !== null && DOCS_SQL.test(piece) && !piece.includes('deleted_at')) {
      hits.push({ file, owner: next, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: piece.slice(0, 80) })
    }
    ts.forEachChild(node, (child) => visit(child, next))
  }
  visit(sf, '(최상위)')
  return hits
}

function guardFailures(hits: Hit[], allow: Allow[]): string[] {
  const key = (file: string, owner: string) => `${file} ${owner}`
  const counts = new Map<string, Hit[]>()
  for (const hit of hits) counts.set(key(hit.file, hit.owner), [...(counts.get(key(hit.file, hit.owner)) ?? []), hit])
  const failures: string[] = []
  for (const [k, found] of counts) {
    const allowed = allow.find((a) => key(a.file, a.owner) === k)
    if (allowed?.count === found.length) continue
    for (const hit of found) failures.push(`${hit.file}:${hit.line} ${hit.owner} (${found.length}/${allowed?.count ?? 0}) ${hit.text}`)
  }
  for (const a of allow) {
    if (!counts.has(key(a.file, a.owner))) failures.push(`죽은 허용: ${a.file} ${a.owner}`)
  }
  return failures
}

function workerHits(): Hit[] {
  return readdirSync(WORKER)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .flatMap((name) => scanDocsSql(name, readFileSync(WORKER + name, 'utf-8')))
}

describe('F-3022 A1 휴지통 거르기 가드', () => {
  it('worker/*.ts 의 docs 질의는 deleted_at 이 있거나 ALLOW 와 개수까지 같다', () => {
    expect(guardFailures(workerHits(), ALLOW)).toEqual([])
  })

  it('deleted_at 없는 SELECT 1 FROM docs 를 품은 가짜 소스는 실패 목록에 나온다', () => {
    const source = "const OK = 'SELECT 1 FROM docs WHERE deleted_at IS NULL'\nexport function leak() {\n  return 'SELECT 1 FROM docs'\n}\n"
    expect(guardFailures(scanDocsSql('fake.ts', source), [])).toEqual(['fake.ts:3 leak (1/0) SELECT 1 FROM docs'])
  })

  it('허용된 함수에 질의가 하나 늘거나, 0개인 허용 항목은 실패', () => {
    const source = "function two() {\n  return ['SELECT id FROM docs', 'DELETE FROM docs']\n}\n"
    const allow = [
      { file: 'fake.ts', owner: 'two', count: 1, reason: '' },
      { file: 'fake.ts', owner: 'gone', count: 1, reason: '' },
    ]
    expect(guardFailures(scanDocsSql('fake.ts', source), allow)).toEqual([
      'fake.ts:2 two (2/1) SELECT id FROM docs',
      'fake.ts:2 two (2/1) DELETE FROM docs',
      '죽은 허용: fake.ts gone',
    ])
  })
})
