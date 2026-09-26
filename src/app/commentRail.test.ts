import { describe, expect, it } from 'vitest'
import {
  commentAccess,
  commentBadgeText,
  commentRailExtra,
  commentRailMode,
  formatCommentTime,
  initialCommentRailOpen,
  layoutRailCards,
  type CommentAccessInput,
} from './commentRail'

function baseInput(overrides: Partial<CommentAccessInput>): CommentAccessInput {
  return {
    storeKind: 'idb',
    docPath: 'local',
    e2ee: false,
    sharedScreen: false,
    role: undefined,
    account: null,
    readOnly: false,
    ...overrides,
  }
}

describe('layoutRailCards — U1~U4 (F-505.md 3.1, r1)', () => {
  const cards = [
    { id: 'a', anchorTop: 100, height: 50 },
    { id: 'b', anchorTop: 110, height: 50 },
    { id: 'c', anchorTop: 120, height: 50 },
  ]

  it('U1 활성 없음', () => {
    expect(layoutRailCards(cards, null, 8, 0)).toEqual([100, 158, 216])
  })

  it('U2 활성 b / 활성 c', () => {
    expect(layoutRailCards(cards, 'b', 8, 0)).toEqual([52, 110, 168])
    expect(layoutRailCards(cards, 'c', 8, 0)).toEqual([4, 62, 120])
  })

  it('U3 활성이 맨 앞을 minTop 위로 밀어내면 활성 없음 식을 한 번 더 — 활성도 밀린다', () => {
    const narrow = [
      { id: 'a', anchorTop: 10, height: 50 },
      { id: 'b', anchorTop: 12, height: 50 },
    ]
    expect(layoutRailCards(narrow, 'b', 8, 0)).toEqual([0, 58])
  })

  it('U4 겹침 없음·빈 배열·카드 하나, 그리고 무작위 500개에서도 겹치지 않는다', () => {
    const spread = [
      { id: 'a', anchorTop: 0, height: 50 },
      { id: 'b', anchorTop: 200, height: 50 },
      { id: 'c', anchorTop: 400, height: 50 },
    ]
    expect(layoutRailCards(spread, null, 8, 0)).toEqual([0, 200, 400])
    expect(layoutRailCards([], null, 8, 0)).toEqual([])
    expect(layoutRailCards([{ id: 'a', anchorTop: 30, height: 50 }], null, 8, 10)).toEqual([30])
    expect(layoutRailCards([{ id: 'a', anchorTop: 0, height: 50 }], null, 8, 10)).toEqual([10])

    let seed = 1
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let trial = 0; trial < 20; trial++) {
      const n = 500
      const randomCards = Array.from({ length: n }, (_, i) => ({
        id: `c${i}`,
        anchorTop: Math.floor(rand() * 2000),
        height: 20 + Math.floor(rand() * 80),
      }))
      const activeId = trial % 2 === 0 ? null : randomCards[Math.floor(rand() * n)].id
      const tops = layoutRailCards(randomCards, activeId, 8, 0)
      expect(tops.length).toBe(n)
      for (let i = 0; i < n - 1; i++) {
        expect(tops[i + 1]).toBeGreaterThanOrEqual(tops[i] + randomCards[i].height + 8 - 1e-9)
      }
    }
  })
})

describe('commentRailMode — U5', () => {
  it('967 → sheet, 968 → rail', () => {
    expect(commentRailMode(967)).toBe('sheet')
    expect(commentRailMode(968)).toBe('rail')
  })
})

describe('initialCommentRailOpen — U6', () => {
  it("open→참, closed→거짓, null 은 열린 스레드 수로", () => {
    expect(initialCommentRailOpen('open', 0)).toBe(true)
    expect(initialCommentRailOpen('closed', 5)).toBe(false)
    expect(initialCommentRailOpen(null, 0)).toBe(false)
    expect(initialCommentRailOpen(null, 1)).toBe(true)
  })
})

describe('formatCommentTime — U7', () => {
  const now = new Date('2026-09-26T12:00:00.000Z').getTime()

  it('60초 미만(미래 포함)·60분 미만·24시간 미만은 상대 표현', () => {
    expect(formatCommentTime(now, now)).toBe('방금 전')
    expect(formatCommentTime(now - 59_000, now)).toBe('방금 전')
    expect(formatCommentTime(now - 60_000, now)).toBe('1분 전')
    expect(formatCommentTime(now - 59 * 60_000, now)).toBe('59분 전')
    expect(formatCommentTime(now - 60 * 60_000, now)).toBe('1시간 전')
    expect(formatCommentTime(now - (23 * 60 + 59) * 60_000, now)).toBe('23시간 전')
    expect(formatCommentTime(now + 10_000, now)).toBe('방금 전')
  })

  it('24시간 이상은 날짜 — 같은 해면 M월 D일, 다른 해면 YYYY. M. D.', () => {
    const sameYearAt = new Date('2026-01-05T00:00:00.000Z').getTime()
    expect(formatCommentTime(sameYearAt, now)).toBe('1월 5일')
    const otherYearAt = new Date('2025-03-09T00:00:00.000Z').getTime()
    expect(formatCommentTime(otherYearAt, now)).toBe('2025. 3. 9.')
  })
})

describe('commentAccess — U8, 4장 표', () => {
  it('로컬, 쓰기', () => {
    const result = commentAccess(baseInput({ docPath: 'local', readOnly: false }))
    expect(result).toEqual({
      kind: 'write',
      via: 'direct',
      actor: { kind: 'local', canEdit: true },
      author: { id: null, email: null },
    })
  })

  it('로컬, 읽기 전용', () => {
    expect(commentAccess(baseInput({ docPath: 'local', readOnly: true }))).toEqual({ kind: 'read' })
  })

  it('실시간, owner (role 없음 → owner)', () => {
    const result = commentAccess(
      baseInput({ docPath: 'realtime', role: undefined, account: { id: 'u1', email: 'a@b.com', blocked: false } }),
    )
    expect(result).toEqual({
      kind: 'write',
      via: 'direct',
      actor: { kind: 'server', userId: 'u1', role: 'owner', blocked: false },
      author: { id: 'u1', email: 'a@b.com' },
    })
  })

  it('실시간, edit', () => {
    const result = commentAccess(
      baseInput({ docPath: 'realtime', role: 'edit', account: { id: 'u2', email: 'b@b.com', blocked: false } }),
    )
    expect(result.kind).toBe('write')
    if (result.kind === 'write') {
      expect(result.actor).toEqual({ kind: 'server', userId: 'u2', role: 'edit', blocked: false })
    }
  })

  it('실시간, readOnly 면 read', () => {
    const result = commentAccess(
      baseInput({ docPath: 'realtime', role: 'edit', account: { id: 'u2', email: 'b@b.com', blocked: false }, readOnly: true }),
    )
    expect(result).toEqual({ kind: 'read' })
  })

  it('실시간, role view → unavailable', () => {
    const result = commentAccess(
      baseInput({ docPath: 'realtime', role: 'view', account: { id: 'u2', email: 'b@b.com', blocked: false } }),
    )
    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('막힌 계정 → unavailable', () => {
    const result = commentAccess(
      baseInput({ docPath: 'realtime', role: 'edit', account: { id: 'u2', email: 'b@b.com', blocked: true } }),
    )
    expect(result).toEqual({ kind: 'unavailable' })
  })

  it('view·pending·fallback·offline-view → unavailable', () => {
    for (const docPath of ['view', 'pending', 'fallback', 'offline-view'] as const) {
      expect(commentAccess(baseInput({ docPath }))).toEqual({ kind: 'unavailable' })
    }
  })

  it('경로 판정 전(null) → loading', () => {
    expect(commentAccess(baseInput({ docPath: null }))).toEqual({ kind: 'loading' })
  })

  it('로컬 금고(e2ee: true, 경로 local) → none', () => {
    expect(commentAccess(baseInput({ docPath: 'local', e2ee: true }))).toEqual({ kind: 'none' })
  })

  it('서버 금고(docPath e2ee) → none', () => {
    expect(commentAccess(baseInput({ docPath: 'e2ee', e2ee: true }))).toEqual({ kind: 'none' })
  })

  it('공유 화면 → none', () => {
    expect(commentAccess(baseInput({ sharedScreen: true }))).toEqual({ kind: 'none' })
  })
})

describe('commentBadgeText — U8b', () => {
  it('0·1·99·100', () => {
    expect(commentBadgeText(0)).toBeNull()
    expect(commentBadgeText(1)).toBe('1')
    expect(commentBadgeText(99)).toBe('99')
    expect(commentBadgeText(100)).toBe('99+')
  })
})

describe('commentRailExtra — 5.6 레일 여분 (F-505.md 5.6)', () => {
  it('마지막 카드 아랫변 + 간격이 스크롤 높이 안이면 0', () => {
    expect(commentRailExtra(500, 1000, 0)).toBe(0)
    expect(commentRailExtra(992, 1000, 0)).toBe(0)
  })
  it('넘으면 넘는 만큼 + 간격(8px)', () => {
    expect(commentRailExtra(1000, 1000, 0)).toBe(8)
    expect(commentRailExtra(1100, 1000, 0)).toBe(108)
  })
  it('비교할 높이는 지금 여분을 뺀 스크롤 높이 — 여분이 여분을 부르지 않는다', () => {
    expect(commentRailExtra(1100, 1108, 108)).toBe(108)
    expect(commentRailExtra(900, 1108, 108)).toBe(0)
  })
  it('소수는 올림, 카드가 없으면(아랫변 0) 0', () => {
    expect(commentRailExtra(1000.4, 1000, 0)).toBe(9)
    expect(commentRailExtra(0, 0, 0)).toBe(0)
  })
})
