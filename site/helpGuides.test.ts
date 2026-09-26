// 도움말 ↔ 사용법 글 분담 규칙 (specs/features/F-2039.md 2장 R3~R7, 8.2 U4~U7)
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { findFrontmatter, parseSimpleProperties } from '../src/lib/frontmatter'
import { HELP_DOC_CONTENT } from '../src/app/helpDoc'
import brand from '../brand.config'
import {
  E2EE_MIN_PASSWORD_CHARS,
  E2EE_PBKDF2_ITERATIONS,
  E2EE_MAX_PLAIN_CONTENT_BYTES,
  E2EE_MAX_ATTACHMENT_REFS,
} from '../src/lib/e2eeLimits'
import { E2EE_LOCK_MINUTES, E2EE_DEFAULT_LOCK_MINUTES } from '../src/e2ee/keyring'
import { E2EE_SERVER_SAVE_INTERVAL_MS } from '../src/storage/serverStore'
import { RECOVERY_CODE_BYTES } from '../src/e2ee/recoveryCode'
import { buildE2eeConvertDialogText } from '../src/e2ee/convert'
import { PEER_AVATARS_MAX, PEER_AVATARS_MAX_NARROW } from '../src/lib/peers'
import { DISCONNECT_NOTICE_MS } from '../src/app/liveDoc'
import { MAX_CONTENT_BYTES, MAX_ATTACHMENT_BYTES } from '../src/app/importWorkspace'
import { E2EE_SERVER_MAX_CONTENT_BYTES } from '../src/lib/e2eeLimits'
import { RETAIN_MS } from '../src/storage/yjsStore'
import { MAX_INPUT_BYTES, MAX_RESULT_BYTES, MAX_DIM, MAX_AREA } from '../src/app/attachImages'
import { MAX_SIDE } from '../src/lib/shrinkImage'
import { GRACE_MS } from '../src/app/attachmentGc'
import { RESULT_LIMIT, SNIPPET_BEFORE, SNIPPET_AFTER } from '../src/lib/docSearch'
import { ACCOUNT_DELETE_FRESH_MS } from '../src/lib/accountDeletion'
import {
  COMMENT_BODY_MAX,
  REPLIES_PER_THREAD_MAX,
  MENTIONS_PER_COMMENT_MAX,
  NOTIFICATIONS_LIST_DEFAULT,
  NOTIFICATION_RETAIN_DAYS,
  NOTIFICATIONS_PER_RECIPIENT_MAX,
} from '../src/lib/docComments'
import { COMMENT_BODY_COUNTER_FROM } from '../src/app/commentRail'
import { MENTION_CANDIDATES_MAX } from '../src/app/mentionCandidates'
import { NOTIFICATIONS_POLL_MS, notificationText } from '../src/app/notificationsApi'
import { COMMENT_TEXT } from '../src/app/useDocComments'
import { EditorState } from '@codemirror/state'
import { insertTable } from '../src/editor/insertCommands'
import { parseTable } from '../src/editor/preview/tableModel'

const GUIDES_DIR = fileURLToPath(new URL('../content/guides', import.meta.url))

function readGuide(slug: string): string {
  return readFileSync(`${GUIDES_DIR}/${slug}.md`, 'utf-8')
}

function guideTitle(raw: string): string {
  const frontmatter = findFrontmatter(raw)
  if (!frontmatter) return ''
  const content = raw.slice(frontmatter.contentFrom, frontmatter.contentTo)
  const props = parseSimpleProperties(content)
  const titleProp = props?.find((p) => p.key === 'title')
  return titleProp && typeof titleProp.value === 'string' ? titleProp.value : ''
}

// 프론트매터를 뗀 본문
function guideBody(raw: string): string {
  const frontmatter = findFrontmatter(raw)
  if (!frontmatter) return raw
  return raw.slice(frontmatter.to).replace(/^\r?\n/, '')
}

// R4 판정 — .·?·! 뒤 공백·줄바꿈으로 문장을 자르고, 목록 기호·표 칸 구분자를 뗀 뒤 20자 이상만 남긴다
function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.?!])\s+/)
    .map((s) =>
      s
        .trim()
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/^\|\s*/, '')
        .replace(/\s*\|$/, ''),
    )
    .filter((s) => [...s].length >= 20)
}

const HELP_LINK_RE = /사용법 글: \[([^\]]+)\]\(\/guides\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)\)/g

function helpLinks(): Array<{ slug: string; label: string }> {
  const out: Array<{ slug: string; label: string }> = []
  for (const m of HELP_DOC_CONTENT.matchAll(HELP_LINK_RE)) out.push({ label: m[1], slug: m[2] })
  return out
}

// 그 글을 링크하는 도움말 절 모두의 본문 — 절 제목 줄과 사용법 글 줄 자신은 떼고 빈 줄 두 개로 이어 붙인다 (F-2047 R4)
function helpSectionBodyFor(slug: string): string {
  const needle = `/guides/${slug})`
  const sections = HELP_DOC_CONTENT.split(/\n(?=## )/).filter((s) => s.includes(needle))
  return sections
    .map((section) =>
      section.replace(/^## .+\n\n?/, '').replace(/(?:\n\n)?사용법 글: \[[^\]]+\]\([^)]+\)\s*$/, ''),
    )
    .join('\n\n')
}

describe('U4 링크 대상 (R3)', () => {
  it('도움말의 사용법 글 링크마다 content/guides/{slug}.md 가 있고, 글자가 그 title 과 같다', () => {
    const links = helpLinks()
    expect(links.length).toBeGreaterThan(0)
    for (const { slug, label } of links) {
      const raw = readGuide(slug)
      expect(guideTitle(raw), slug).toBe(label)
    }
  })
})

describe('U5 서로 옮기지 않는다 (R4)', () => {
  it('링크로 이어진 (절, 글) 쌍마다 20자 이상 문장이 양방향으로 다른 쪽에 그대로 없다', () => {
    for (const { slug } of helpLinks()) {
      const helpBody = helpSectionBodyFor(slug)
      const guideText = guideBody(readGuide(slug))
      for (const sentence of sentencesOf(helpBody)) {
        expect(guideText, `도움말 문장이 ${slug}.md 에 그대로 있다: ${sentence}`).not.toContain(sentence)
      }
      for (const sentence of sentencesOf(guideText)) {
        expect(helpBody, `${slug}.md 문장이 도움말에 그대로 있다: ${sentence}`).not.toContain(sentence)
      }
    }
  })
})

const FORBIDDEN_WORDS = [
  // 쓰지 않는 말 (F-400 5.1)
  '비밀번호',
  '마스터 암호',
  '복구 키',
  '백업 코드',
  '보관함',
  '비밀 폴더',
  '잠금 폴더',
  '가이드',
  '튜토리얼',
  // 내부 용어
  'DEK',
  'KEK',
  'AES-KW',
  'Y.Text',
  'Y.Doc',
  'Durable Object',
  'md-yjs',
  'md-docs',
  'md-remote',
  'e2ee',
  '키 묶음',
  '봉투',
  'outbox',
  'IndexedDB',
  // 과장
  '완벽',
  '100% 안전',
]

describe('U6 글 전체의 말과 분량 (R6·R7)', () => {
  const files = readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.md'))

  it('글 파일이 하나 이상 있다', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} 이 쓰지 않는 말을 담지 않고, 본문 6,000자·## 10개 이하다`, () => {
      const body = guideBody(readGuide(file.replace(/\.md$/, '')))
      for (const word of FORBIDDEN_WORDS) {
        expect(body, `${file} 에 "${word}"`).not.toContain(word)
      }
      expect([...body].length, `${file} 본문 길이`).toBeLessThanOrEqual(6000)
      const headingCount = (body.match(/^## /gm) ?? []).length
      expect(headingCount, `${file} ## 개수`).toBeLessThanOrEqual(10)
    })
  }

  it('encryption.md 에 제품명(brand.name·brand.shortName)이 없다', () => {
    const body = guideBody(readGuide('encryption')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

function lockLabel(m: number): string {
  return m === 60 ? '1시간' : m === 240 ? '4시간' : `${m}분`
}

describe('U7 금고 글의 수치 (R5)', () => {
  const raw = readGuide('encryption')

  it('금고 암호 최소 길이', () => {
    expect(raw).toContain(`${E2EE_MIN_PASSWORD_CHARS}자 이상`)
  })

  it('PBKDF2 반복 수', () => {
    expect(raw).toContain(`${E2EE_PBKDF2_ITERATIONS.toLocaleString('en-US')}번`)
  })

  it('금고 문서 최대 크기', () => {
    expect(raw).toContain(`약 ${Math.round(E2EE_MAX_PLAIN_CONTENT_BYTES / 1000)}KB`)
  })

  it('금고 문서의 이미지 개수 한도', () => {
    expect(raw).toContain(`${E2EE_MAX_ATTACHMENT_REFS.toLocaleString('en-US')}개까지`)
  })

  it('자동 잠금 선택지와 기본값', () => {
    const labels = E2EE_LOCK_MINUTES.map((m) => `\`${lockLabel(m)}\``).join('·')
    expect(raw).toContain(labels)
    expect(raw).toContain(`처음 값은 ${lockLabel(E2EE_DEFAULT_LOCK_MINUTES)}`)
  })

  it('서버로 보내는 간격', () => {
    expect(raw).toContain(`${Math.round(E2EE_SERVER_SAVE_INTERVAL_MS / 1000)}초에 한 번`)
  })

  it('복구 코드 길이·묶음·비트 수', () => {
    const chars = Math.ceil((RECOVERY_CODE_BYTES * 8) / 5)
    const bits = RECOVERY_CODE_BYTES * 8
    expect(raw).toContain(`${chars}자`)
    expect(raw).toContain(`4자씩 ${chars / 4}묶음`)
    expect(raw).toContain(`${bits}비트`)
  })

  it('옮기기 전 내용의 백업 보관 기간', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: 'x',
      targetKind: 'doc',
      docCount: 0,
      folderCount: 0,
      showBackupNotice: true,
      usage: { writesLeft: null, bytesLeft: null },
      cost: { writes: 0, deltaBytes: 0 },
    })
    const days = /최대 (\d+)일/.exec(text.backupNotice ?? '')?.[1]
    expect(days).toBeTruthy()
    expect(raw).toContain(`최대 ${days}일`)
  })

  it('암호화로 커지는 비율', () => {
    const text = buildE2eeConvertDialogText({
      direction: 'to-e2ee',
      scope: 'account',
      name: 'x',
      targetKind: 'doc',
      docCount: 0,
      folderCount: 0,
      showBackupNotice: false,
      usage: { writesLeft: null, bytesLeft: 0 },
      cost: { writes: 0, deltaBytes: 100 },
    })
    const ratio = /약 ([\d.]+)배/.exec(text.notes.join(' '))?.[1]
    expect(ratio).toBeTruthy()
    expect(raw).toContain(`약 ${ratio}배`)
  })
})

// F-2045.md 6.2 U2~U4
describe('F-2045 공유 글', () => {
  it('U2: 공유 글의 수치가 상수에서 만든 문자열과 같다 (R5)', () => {
    const raw = readGuide('sharing')
    expect(raw).toContain(`넓은 창에서는 ${PEER_AVATARS_MAX}명까지`)
    expect(raw).toContain(`좁은 창에서는 ${PEER_AVATARS_MAX_NARROW}명까지`)
    expect(raw).toContain(`${DISCONNECT_NOTICE_MS / 1000}초 넘게`)
  })

  it('U3: 공유 글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('sharing')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

// F-2046.md 6.2 U2~U4
describe('F-2046 옵시디언 볼트 글', () => {
  it('U2: 옵시디언 볼트 글의 수치가 상수에서 만든 문자열과 같다 (R5)', () => {
    const raw = readGuide('obsidian-vault')
    expect(raw).toContain(`${MAX_CONTENT_BYTES / 1_000_000}MB를 넘는 문서`)
    expect(raw).toContain(`한 장에 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB를 넘는 이미지`)
  })

  it('U3: 옵시디언 볼트 글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('obsidian-vault')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })

  it('U4: markdown-portability 가 이 글을 가리킨다 (R8)', () => {
    const raw = readGuide('markdown-portability')
    expect(raw).toContain('](/guides/obsidian-vault)')
  })
})

// F-2047.md 6.2 U2·U3
describe('F-2047 오프라인과 동기화 글', () => {
  it('U2: 글의 앱 쪽 수치가 상수에서 만든 문자열과 같다 (R5)', () => {
    const raw = readGuide('offline-sync')
    expect(raw).toContain(`문서 하나 ${E2EE_SERVER_MAX_CONTENT_BYTES / 1_000_000}MB`)
    expect(raw).toContain(`최근 ${RETAIN_MS / 86_400_000}일`)
  })

  it('U3: 글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('offline-sync')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

// F-2048.md 6.2 U2·U3
describe('F-2048 이미지 글', () => {
  it('U2: 글의 앱 쪽 수치가 상수에서 만든 문자열과 같다 (R5)', () => {
    const raw = readGuide('images')
    expect(raw).toContain(`고른 파일이 ${MAX_INPUT_BYTES / 1024 / 1024}MB를`)
    expect(raw).toContain(`한 변이 ${MAX_DIM.toLocaleString('en-US')}px`)
    expect(raw).toContain(`화소 수가 ${(MAX_AREA / 10_000).toLocaleString('en-US')}만`)
    expect(raw).toContain(`긴 변이 ${MAX_SIDE.toLocaleString('en-US')}px`)
    expect(raw).toContain(`결과가 ${MAX_RESULT_BYTES / 1024 / 1024}MB를`)
    expect(raw).toContain(`넣은 지 ${GRACE_MS / 3_600_000}시간`)
  })

  it('U3: 글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('images')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

// 사용법 글 search (write-guide, 2026-09-27)
describe('search 글', () => {
  it('글의 앱 쪽 수치가 상수에서 만든 문자열과 같다 (R5)', () => {
    const raw = readGuide('search')
    expect(raw).toContain(`맞은 글자 앞 ${SNIPPET_BEFORE}자와 뒤 ${SNIPPET_AFTER}자`)
    expect(raw).toContain(`목록에는 ${RESULT_LIMIT}개까지`)
    expect(raw).toContain(`앞 ${RESULT_LIMIT}개만 보입니다`)
    expect(raw).toContain(`${RESULT_LIMIT}개까지 보입니다`)
  })

  it('글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('search')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

// 사용법 글 account (write-guide, 2026-09-27)
describe('account 글', () => {
  it('글의 앱 쪽 수치가 상수·화면 글자와 같다 (R5)', () => {
    const raw = readGuide('account')
    expect(raw).toContain(`로그인한 지 ${ACCOUNT_DELETE_FRESH_MS / 60_000}분`)
    // 백업 보관 기간은 계정 삭제 창 안내 문구가 원천이다 — 문구가 모듈 밖으로 나오지 않아 원문에서 읽는다
    const dialogSource = readFileSync(fileURLToPath(new URL('../src/app/AccountDeleteDialog.tsx', import.meta.url)), 'utf-8')
    const days = /자동 백업에 최대 (\d+)일/.exec(dialogSource)?.[1]
    expect(days).toBeTruthy()
    expect(raw).toContain(`최대 ${days}일`)
  })

  it('글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('account')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

// 사용법 글 tables (write-guide, 2026-09-27)
describe('tables 글', () => {
  it('삽입 ▸ 표 가 넣는 표의 크기가 글과 같다 (R5)', () => {
    let state = EditorState.create({ doc: '' })
    const ran = insertTable({ state, dispatch: (tr) => (state = tr.state) })
    expect(ran).toBe(true)
    const table = parseTable(state.doc.toString(), 0)
    const bodyRows = table.rows.length - 1
    expect(guideBody(readGuide('tables'))).toContain(`머리 행과 빈 행 ${bodyRows}개로 된 ${table.columnCount}열 빈 표`)
  })

  it('글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('tables')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

// 사용법 글 comments (write-guide, 2026-09-27)
describe('comments 글', () => {
  it('글의 앱 쪽 수치가 상수와 같다 (R5)', () => {
    const raw = readGuide('comments')
    expect(raw).toContain(`한 댓글은 ${COMMENT_BODY_MAX.toLocaleString('en-US')}자까지`)
    expect(raw).toContain(`${COMMENT_BODY_COUNTER_FROM}자에 이르면`)
    expect(raw).toContain(`/${COMMENT_BODY_MAX}\``)
    expect(raw).toContain(`한 스레드에 ${REPLIES_PER_THREAD_MAX}개까지`)
    expect(raw).toContain(`한 번에 ${MENTION_CANDIDATES_MAX}명까지`)
    expect(raw).toContain(`${MENTIONS_PER_COMMENT_MAX}명까지 멘션`)
    expect(raw).toContain(`최근 ${NOTIFICATIONS_LIST_DEFAULT}개가 새것부터`)
    expect(raw).toContain(`${NOTIFICATIONS_POLL_MS / 60_000}분마다`)
    expect(raw).toContain(`${NOTIFICATION_RETAIN_DAYS}일이 지났거나 사람마다 최근 ${NOTIFICATIONS_PER_RECIPIENT_MAX}개`)
  })

  it('글이 인용한 화면 글자가 코드 문구와 같다', () => {
    const raw = readGuide('comments')
    for (const text of [COMMENT_TEXT.selectFirst, COMMENT_TEXT.unavailable, COMMENT_TEXT.offline, COMMENT_TEXT.notFound]) {
      expect(raw).toContain(`\`${text}\``)
    }
    expect(raw).toContain(`\`멘션은 한 댓글에 ${MENTIONS_PER_COMMENT_MAX}명까지 할 수 있습니다.\``)
    const sample = { id: 'n', docId: 'd', commentId: 'c', threadId: 't', actorEmail: '…', docTitle: '회의록', excerpt: '', createdAt: 0, readAt: null }
    expect(raw).toContain(`\`${notificationText({ ...sample, kind: 'mention' })}\``)
    expect(raw).toContain(`\`${notificationText({ ...sample, kind: 'reply' })}\``)
    // 금고로 옮기기 확인 창 댓글 줄 — buildE2eeConvertDialogText 의 문구 틀
    const convertSource = readFileSync(fileURLToPath(new URL('../src/e2ee/convert.ts', import.meta.url)), 'utf-8')
    expect(convertSource).toContain('개도 함께 지워집니다.')
    expect(raw).toContain('`댓글 3개도 함께 지워집니다.`')
  })

  it('글에 제품명이 없다 (R6)', () => {
    const body = guideBody(readGuide('comments')).toLowerCase()
    expect(body).not.toContain(brand.name.toLowerCase())
    expect(body).not.toContain(brand.shortName.toLowerCase())
  })
})

describe('U4 글 사이 링크 대상 (R8)', () => {
  it('모든 content/guides/*.md 본문의 (/guides/{slug}) 링크마다 content/guides/{slug}.md 가 있다', () => {
    const files = readdirSync(GUIDES_DIR).filter((f) => f.endsWith('.md'))
    const linkRe = /\]\(\/guides\/([a-z0-9]([a-z0-9-]*[a-z0-9])?)\)/g
    let checked = 0
    for (const file of files) {
      const body = guideBody(readGuide(file.replace(/\.md$/, '')))
      for (const m of body.matchAll(linkRe)) {
        const slug = m[1]
        expect(files, `${file} → ${slug}`).toContain(`${slug}.md`)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(0)
  })
})
