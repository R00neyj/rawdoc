// 사후 검사 순수 판정 (specs/features/F-502.md 3장, 13.1 G1~G13)
import { describe, expect, it } from 'vitest'

import { planCommentFixes } from './commentGuard'
import type { CommentChange, CommentFix, CommentFixActor } from './commentGuard'
import { validateCommentEntry } from '../src/lib/docComments'
import type { CommentAuthor, CommentEntry } from '../src/lib/docComments'

const OWNER: CommentFixActor = { userId: 'owner-id', email: 'owner@example.com', role: 'owner' }
const ED: CommentFixActor = { userId: 'ed-id', email: 'ed@example.com', role: 'edit' }
const ED_AUTHOR: CommentAuthor = { id: 'ed-id', email: 'ed@example.com' }
const OTHER: CommentAuthor = { id: 'other-id', email: 'other@example.com' }
const LOCAL: CommentAuthor = { id: null, email: null }
const ANCHOR = {
  start: { tname: 'content', item: { client: 1, clock: 0 }, assoc: 0 },
  end: { tname: 'content', item: { client: 1, clock: 3 }, assoc: -1 },
}
const ANCHOR2 = {
  start: { tname: 'content', item: { client: 1, clock: 5 }, assoc: 0 },
  end: { tname: 'content', item: { client: 1, clock: 7 }, assoc: -1 },
}

function root(author: CommentAuthor, over: Partial<CommentEntry> = {}): CommentEntry {
  return { v: 1, parent: null, anchor: ANCHOR, quote: 'abc', body: '본문', mentions: [], author, createdAt: 1, resolved: null, ...over }
}

function reply(parent: string, author: CommentAuthor, over: Partial<CommentEntry> = {}): CommentEntry {
  return { v: 1, parent, anchor: null, quote: '', body: '답글', mentions: [], author, createdAt: 2, resolved: null, ...over }
}

// before → after 로 YMapEvent.changes.keys 를 흉내 낸다
function plan(before: Record<string, unknown>, after: Record<string, unknown>, actor: CommentFixActor | null): CommentFix[] {
  const changes: CommentChange[] = []
  for (const key of Object.keys(after)) {
    if (!(key in before)) changes.push({ key, action: 'add', oldValue: undefined })
    else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.push({ key, action: 'update', oldValue: before[key] })
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) changes.push({ key, action: 'delete', oldValue: before[key] })
  }
  return planCommentFixes(new Map(Object.entries(after)), changes, actor)
}

function byKey(fixes: CommentFix[]): Record<string, CommentFix> {
  return Object.fromEntries(fixes.map((f) => [f.key, f]))
}

describe('F-502 G1 정직한 클라이언트', () => {
  it('첫 댓글 추가 / 답글 추가 / 해결 / 다시 열기 / 자기 답글 지우기 — 모두 []', () => {
    const r = root(OTHER)
    expect(plan({}, { c1: root(ED_AUTHOR) }, ED)).toEqual([])
    expect(plan({ r }, { r, a1: reply('r', ED_AUTHOR) }, ED)).toEqual([])
    const resolved = root(OTHER, { resolved: { by: ED_AUTHOR, at: 9 } })
    expect(plan({ r }, { r: resolved }, ED)).toEqual([])
    expect(plan({ r: resolved }, { r }, ED)).toEqual([])
    expect(plan({ r, a1: reply('r', ED_AUTHOR) }, { r }, ED)).toEqual([])
  })
})

describe('F-502 G2 다시 도장', () => {
  it('남의 author 로 추가 → author 가 행위자', () => {
    const fixes = plan({}, { c1: root(OTHER) }, ED)
    expect(fixes).toHaveLength(1)
    const fix = fixes[0]
    expect(fix.op).toBe('set')
    if (fix.op !== 'set') return
    expect(fix.key).toBe('c1')
    expect(fix.value.author).toEqual(ED_AUTHOR)
    expect(validateCommentEntry(fix.value).ok).toBe(true)
  })

  it('로컬 작성자 + 해결됨 → author 와 resolved.by 둘 다 행위자', () => {
    const fixes = plan({}, { c1: root(LOCAL, { resolved: { by: LOCAL, at: 5 } }) }, ED)
    expect(fixes).toHaveLength(1)
    const fix = fixes[0]
    if (fix.op !== 'set') throw new Error('set 이어야 한다')
    expect(fix.value.author).toEqual(ED_AUTHOR)
    expect(fix.value.resolved).toEqual({ by: ED_AUTHOR, at: 5 })
    expect(validateCommentEntry(fix.value).ok).toBe(true)
  })
})

describe('F-502 G3 모양', () => {
  it('모양 틀린 값 / isCommentId 가 아닌 키 → delete', () => {
    expect(plan({}, { c1: { ...root(ED_AUTHOR), v: 2 } }, ED)).toEqual([{ op: 'delete', key: 'c1' }])
    expect(plan({}, { 'bad key!': root(ED_AUTHOR) }, ED)).toEqual([{ op: 'delete', key: 'bad key!' }])
  })
})

describe('F-502 G4 있던 첫 댓글 바꾸기', () => {
  it('body / anchor / author 를 바꾸면 옛 값', () => {
    const old = root(OTHER)
    for (const next of [root(OTHER, { body: '바꿈' }), root(OTHER, { anchor: ANCHOR2 }), root(ED_AUTHOR)]) {
      expect(plan({ r: old }, { r: next }, OWNER)).toEqual([{ op: 'set', key: 'r', value: old }])
    }
  })
})

describe('F-502 G5 해결한 사람 속이기', () => {
  it('resolved.by 를 남으로 → by 가 행위자', () => {
    const fixes = plan({ r: root(OTHER) }, { r: root(OTHER, { resolved: { by: OTHER, at: 7 } }) }, ED)
    expect(fixes).toEqual([{ op: 'set', key: 'r', value: root(OTHER, { resolved: { by: ED_AUTHOR, at: 7 } }) }])
  })
})

describe('F-502 G6 답글에 해결', () => {
  it('답글에 resolved 를 넣으면 옛 값', () => {
    const r = root(OTHER)
    const a = reply('r', ED_AUTHOR)
    const fixes = plan({ r, a }, { r, a: { ...a, resolved: { by: ED_AUTHOR, at: 3 } } }, ED)
    expect(fixes).toEqual([{ op: 'set', key: 'a', value: a }])
  })
})

describe('F-502 G7 첫 댓글 지우기 권한', () => {
  it('edit 가 남의 것 → 되살림, 소유자 → [], 작성자 자신 → []', () => {
    const other = root(OTHER)
    expect(plan({ r: other }, {}, ED)).toEqual([{ op: 'set', key: 'r', value: other }])
    expect(plan({ r: other }, {}, OWNER)).toEqual([])
    expect(plan({ r: root(ED_AUTHOR) }, {}, ED)).toEqual([])
  })
})

describe('F-502 G8 스레드 삭제', () => {
  it('작성자가 자기 첫 댓글 + 남의 답글 둘 → []', () => {
    const before = { r: root(ED_AUTHOR), a1: reply('r', OTHER), a2: reply('r', OTHER, { createdAt: 3 }) }
    expect(plan(before, {}, ED)).toEqual([])
  })

  it('edit 가 남의 첫 댓글 + 그 답글들 → 모두 되살림', () => {
    const before = { r: root(OTHER), a1: reply('r', OTHER), a2: reply('r', OTHER, { createdAt: 3 }) }
    const fixes = byKey(plan(before, {}, ED))
    expect(Object.keys(fixes).sort()).toEqual(['a1', 'a2', 'r'])
    expect(fixes.r).toEqual({ op: 'set', key: 'r', value: before.r })
    expect(fixes.a1).toEqual({ op: 'set', key: 'a1', value: before.a1 })
    expect(fixes.a2).toEqual({ op: 'set', key: 'a2', value: before.a2 })
  })
})

describe('F-502 G9 부모 잃은 답글', () => {
  it('첫 댓글만 지우고 답글이 남으면 답글 delete', () => {
    const before = { r: root(OTHER), a1: reply('r', OTHER) }
    expect(plan(before, { a1: before.a1 }, OWNER)).toEqual([{ op: 'delete', key: 'a1' }])
  })
})

describe('F-502 G10 답글 모양', () => {
  it('답글의 답글 / 부모 없는 답글 → delete', () => {
    const r = root(OTHER)
    const a = reply('r', OTHER)
    expect(plan({ r, a }, { r, a, b: reply('a', ED_AUTHOR) }, ED)).toEqual([{ op: 'delete', key: 'b' }])
    expect(plan({ r }, { r, b: reply('nope', ED_AUTHOR) }, ED)).toEqual([{ op: 'delete', key: 'b' }])
  })
})

describe('F-502 G11 한도', () => {
  it('499개에 셋 추가 → 늦은 둘 delete, 있던 항목은 그대로', () => {
    const before: Record<string, unknown> = {}
    for (let i = 0; i < 499; i++) before[`old${i}`] = root(OTHER, { createdAt: i })
    const after = { ...before, n1: root(ED_AUTHOR, { createdAt: 1000 }), n2: root(ED_AUTHOR, { createdAt: 1002 }), n3: root(ED_AUTHOR, { createdAt: 1001 }) }
    const fixes = plan(before, after, ED)
    expect(fixes.map((f) => f.key).sort()).toEqual(['n2', 'n3'])
    expect(fixes.every((f) => f.op === 'delete')).toBe(true)
  })

  it('답글 99개 스레드에 셋 → 늦은 둘 delete', () => {
    const before: Record<string, unknown> = { r: root(OTHER) }
    for (let i = 0; i < 99; i++) before[`a${i}`] = reply('r', OTHER, { createdAt: 10 + i })
    const after = { ...before, x1: reply('r', ED_AUTHOR, { createdAt: 500 }), x2: reply('r', ED_AUTHOR, { createdAt: 500 }), x3: reply('r', ED_AUTHOR, { createdAt: 499 }) }
    const fixes = plan(before, after, ED)
    expect(fixes.map((f) => f.key).sort()).toEqual(['x1', 'x2'])
    expect(fixes.every((f) => f.op === 'delete')).toBe(true)
  })
})

describe('F-502 G12 행위자 없음', () => {
  it('추가 delete, 바꿈·지움 옛 값', () => {
    const r = root(OTHER)
    const s = root(OTHER, { createdAt: 5 })
    const fixes = byKey(plan({ r, s }, { r: root(OTHER, { body: '바꿈' }), n: root(ED_AUTHOR) }, null))
    expect(fixes.n).toEqual({ op: 'delete', key: 'n' })
    expect(fixes.r).toEqual({ op: 'set', key: 'r', value: r })
    expect(fixes.s).toEqual({ op: 'set', key: 's', value: s })
    expect(Object.keys(fixes)).toHaveLength(3)
  })
})

describe('F-502 G13 같은 키의 고치기 둘', () => {
  it('다시 도장 + 한도 초과 → 그 키가 한 번, delete', () => {
    const before: Record<string, unknown> = {}
    for (let i = 0; i < 500; i++) before[`old${i}`] = root(OTHER, { createdAt: i })
    const fixes = plan(before, { ...before, n: root(OTHER, { createdAt: 9999 }) }, ED)
    expect(fixes).toEqual([{ op: 'delete', key: 'n' }])
  })
})
