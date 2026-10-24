// 제목을 바꿀 때 다른 문서 위키링크 함께 고치기 — 링크 찾기·원문 고치기·되돌리기 (small 2026-10-24, wireframes/wikilink-rename-flow.html)
import { describe, expect, it } from 'vitest'
import {
  applyLinkEdits,
  planRenameEdits,
  recordAppliedEdits,
  renameContext,
  revertAppliedEdits,
  titleTakenByOther,
  type RenameSource,
} from '../../../src/lib/wikiRename'
import type { WikiDocRef, WikiFolderRef } from '../../../src/lib/wikiResolve'

const folder = (id: string, name: string, parentId: string | null = null): WikiFolderRef => ({ id, name, parentId })
const doc = (id: string, title: string, folderId: string | null = null): WikiDocRef => ({ id, title, folderId })
const src = (id: string, content: string, folderId: string | null = null, extra: Partial<RenameSource> = {}): RenameSource => ({
  id,
  title: id,
  folderId,
  content,
  ...extra,
})

// 회의록(m, 업무 폴더) → 주간 회의록. 링크를 거는 문서 a 는 최상위
function meetingCtx(extraDocs: WikiDocRef[] = [], newTitle = '주간 회의록') {
  const folders = [folder('f1', '업무')]
  const docs = [doc('m', newTitle, 'f1'), doc('a', 'a'), ...extraDocs]
  return renameContext(docs, folders, 'm', '회의록', newTitle)
}

function fix(content: string, folderId: string | null = null, extraDocs: WikiDocRef[] = []): string {
  const ctx = meetingCtx(extraDocs)!
  const plan = planRenameEdits([src('a', content, folderId)], ctx)
  return plan.docs.length === 0 ? content : applyLinkEdits(content, plan.docs[0].edits)
}

describe('대상 부분만 바꾼다', () => {
  it('별칭·절·폴더 접두는 그대로, 제목 부분만', () => {
    const before = '[[회의록]] 참고\n[[회의록|지난 회의]]\n[[회의록#결정]]\n[[업무/회의록]]\n'
    expect(fix(before)).toBe('[[주간 회의록]] 참고\n[[주간 회의록|지난 회의]]\n[[주간 회의록#결정]]\n[[업무/주간 회의록]]\n')
  })

  it('대괄호 안 앞뒤 공백·.md 꼬리는 그대로 둔다', () => {
    expect(fix('[[ 회의록 ]] [[회의록.md]]')).toBe('[[ 주간 회의록 ]] [[주간 회의록.md]]')
  })

  it('대소문자만 다르게 쓴 링크도 고친다', () => {
    const ctx = renameContext([doc('m', 'Weekly'), doc('a', 'a')], [], 'm', 'Meeting', 'Weekly')!
    const plan = planRenameEdits([src('a', '[[meeting]]')], ctx)
    expect(applyLinkEdits('[[meeting]]', plan.docs[0].edits)).toBe('[[Weekly]]')
  })

  it('제목에 / 가 든 문서는 경로가 아니라 제목 전체를 바꾼다', () => {
    const ctx = renameContext([doc('m', 'C/D'), doc('a', 'a')], [], 'm', 'A/B', 'C/D')!
    const plan = planRenameEdits([src('a', '[[A/B]]')], ctx)
    expect(applyLinkEdits('[[A/B]]', plan.docs[0].edits)).toBe('[[C/D]]')
  })
})

describe('링크가 아닌 자리는 건드리지 않는다', () => {
  it('펜스 코드블록·인라인 코드 안은 그대로', () => {
    const before = '```\n[[회의록]]\n```\n`[[회의록]]` 와 [[회의록]]\n'
    expect(fix(before)).toBe('```\n[[회의록]]\n```\n`[[회의록]]` 와 [[주간 회의록]]\n')
  })

  it('표 안 [[대상\\|별칭]] 은 \\| 를 지키고 고친다', () => {
    const before = '| 문서 | 메모 |\n| --- | --- |\n| [[회의록\\|별칭]] | x |\n'
    expect(fix(before)).toBe('| 문서 | 메모 |\n| --- | --- |\n| [[주간 회의록\\|별칭]] | x |\n')
  })

  it('[[#절]] 은 지금 문서를 가리키므로 그대로', () => {
    expect(fix('[[#회의록]]')).toBe('[[#회의록]]')
  })

  it('CRLF 원문은 줄 끝을 그대로 둔다', () => {
    expect(fix('첫 줄\r\n[[회의록]]\r\n끝\r\n')).toBe('첫 줄\r\n[[주간 회의록]]\r\n끝\r\n')
  })
})

describe('해석기 판정', () => {
  it('같은 제목 다른 문서로 풀리던 링크는 고치지 않는다', () => {
    const folders = [folder('fA', 'A'), folder('fB', 'B')]
    const docs = [doc('m', '주간 회의록', 'fA'), doc('other', '회의록', 'fB'), doc('a', 'a', 'fB')]
    const ctx = renameContext(docs, folders, 'm', '회의록', '주간 회의록')!
    const plan = planRenameEdits([src('a', '[[회의록]] [[A/회의록]]', 'fB')], ctx)
    expect(plan.links).toBe(1)
    expect(applyLinkEdits('[[회의록]] [[A/회의록]]', plan.docs[0].edits)).toBe('[[회의록]] [[A/주간 회의록]]')
  })

  it('바꾼 뒤에도 같은 문서로 풀리는 링크(대소문자만 바꿈)는 세지 않는다', () => {
    const ctx = renameContext([doc('m', 'Meeting'), doc('a', 'a')], [], 'm', 'meeting', 'Meeting')!
    expect(planRenameEdits([src('a', '[[meeting]]')], ctx).links).toBe(0)
  })

  it('제목 바꾼 문서 안의 자기 링크도 센다', () => {
    const ctx = meetingCtx()!
    const plan = planRenameEdits([src('m', '[[회의록#결정]]', 'f1')], ctx)
    expect(plan.links).toBe(1)
  })
})

describe('묻지 않는 경우', () => {
  it('앞뒤 공백만 바뀌었으면 null', () => {
    expect(renameContext([doc('m', '회의록 ')], [], 'm', '회의록', '회의록 ')).toBeNull()
  })

  it('빈 제목·제목 없는 문서로 되돌림이면 null', () => {
    expect(renameContext([doc('m', '')], [], 'm', '회의록', '  ')).toBeNull()
    expect(renameContext([doc('m', '제목 없는 문서')], [], 'm', '회의록', '제목 없는 문서')).toBeNull()
  })

  it('옛 제목이 비었으면 null', () => {
    expect(renameContext([doc('m', '새 제목')], [], 'm', '', '새 제목')).toBeNull()
  })

  it('링크로 적을 수 없는 글자가 든 새 제목이면 null', () => {
    for (const bad of ['a|b', 'a#b', 'a[b', 'a]b']) {
      expect(renameContext([doc('m', bad)], [], 'm', '회의록', bad)).toBeNull()
    }
  })
})

describe('문서별 묶음', () => {
  it('문서마다 곳 수, 전체 링크 수, 금고 문서는 빼고 건너뛴 수만', () => {
    const ctx = meetingCtx([doc('b', 'b'), doc('v', 'v')])!
    const plan = planRenameEdits(
      [src('a', '[[회의록]] [[회의록|x]]'), src('b', '없음'), src('v', '[[회의록]]', null, { e2ee: true })],
      ctx,
    )
    expect(plan.links).toBe(2)
    expect(plan.docs.map((d) => [d.id, d.edits.length])).toEqual([['a', 2]])
    expect(plan.vaultSkipped).toBe(1)
  })

  it('새 제목이 이미 다른 문서 제목인지 (대소문자·앞뒤 공백 무시)', () => {
    const docs = [doc('m', '주간 회의록'), doc('x', ' 주간 회의록 ')]
    expect(titleTakenByOther(docs, 'm', '주간 회의록')).toBe(true)
    expect(titleTakenByOther([doc('m', '주간 회의록')], 'm', '주간 회의록')).toBe(false)
  })
})

describe('되돌리기', () => {
  const before = '앞 [[회의록]] 가운데 [[회의록|별칭]] 끝'
  function fixed() {
    const ctx = meetingCtx()!
    const edits = planRenameEdits([src('a', before)], ctx).docs[0].edits
    const after = applyLinkEdits(before, edits)
    return { after, applied: recordAppliedEdits(before, edits) }
  }

  it('그 사이 바뀐 게 없으면 원래 원문으로', () => {
    const { after, applied } = fixed()
    const result = revertAppliedEdits(after, after, applied)
    expect(applyLinkEdits(after, result.edits)).toBe(before)
    expect(result.missed).toBe(0)
  })

  it('링크 밖 한 곳에서 글을 더 썼으면 자리를 옮겨 되돌린다', () => {
    const { after, applied } = fixed()
    for (const [current, expected] of [
      ['새 줄\n' + after, '새 줄\n' + before],
      [after.replace('가운데', '가운데 더'), before.replace('가운데', '가운데 더')],
    ]) {
      const result = revertAppliedEdits(current, after, applied)
      expect(result.missed).toBe(0)
      expect(applyLinkEdits(current, result.edits)).toBe(expected)
    }
  })

  it('고친 링크를 사용자가 다시 고쳤으면 그 자리는 못 되돌린 것으로 센다', () => {
    const { after, applied } = fixed()
    const current = after.replace('[[주간 회의록]]', '[[다른 문서]]')
    const result = revertAppliedEdits(current, after, applied)
    expect(result.edits).toHaveLength(1)
    expect(result.missed).toBe(1)
    expect(applyLinkEdits(current, result.edits)).toBe('앞 [[다른 문서]] 가운데 [[회의록|별칭]] 끝')
  })
})
