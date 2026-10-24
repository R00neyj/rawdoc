// 칸반 카드 끌기 판정 순수 함수 (specs/features/F-2142.md 2장, U1~U3)
import { describe, expect, it } from 'vitest'
import { KANBAN_EDGE_PX, dropSlot, edgeScroll, keyMoveTarget, laneMoveTarget, moveTarget, neighborCard, pickupState } from '../../../../src/app/kanban/kanbanDrag'

describe('F-2142 U1 pickupState', () => {
  it('마우스는 4px 움직이면 집는다', () => {
    expect(pickupState({ pointerType: 'mouse', dx: 3, dy: 0, elapsedMs: 0 })).toBe('wait')
    expect(pickupState({ pointerType: 'mouse', dx: 0, dy: -3, elapsedMs: 2000 })).toBe('wait')
    expect(pickupState({ pointerType: 'mouse', dx: 4, dy: 0, elapsedMs: 0 })).toBe('pick')
    expect(pickupState({ pointerType: 'mouse', dx: 0, dy: -4, elapsedMs: 10 })).toBe('pick')
  })

  it.each(['touch', 'pen'] as const)('%s 는 400ms 눌러야 집고, 그 전에 8px 넘게 움직이면 스크롤로 넘긴다', (pointerType) => {
    expect(pickupState({ pointerType, dx: 0, dy: 0, elapsedMs: 399 })).toBe('wait')
    expect(pickupState({ pointerType, dx: 7, dy: 0, elapsedMs: 400 })).toBe('pick')
    expect(pickupState({ pointerType, dx: 0, dy: 7, elapsedMs: 400 })).toBe('pick')
    expect(pickupState({ pointerType, dx: 9, dy: 0, elapsedMs: 300 })).toBe('cancel')
    expect(pickupState({ pointerType, dx: 0, dy: -9, elapsedMs: 300 })).toBe('cancel')
    expect(pickupState({ pointerType, dx: 8, dy: 0, elapsedMs: 300 })).toBe('wait')
  })
})

describe('F-2142 U2 dropSlot·moveTarget', () => {
  const mids = [20, 60, 100]

  it('dropSlot 은 세로 가운데로 자리를 고른다', () => {
    expect(dropSlot([], 50)).toBe(0)
    expect(dropSlot(mids, 5)).toBe(0)
    expect(dropSlot(mids, 19)).toBe(0)
    expect(dropSlot(mids, 40)).toBe(1)
    expect(dropSlot(mids, 80)).toBe(2)
    expect(dropSlot(mids, 100)).toBe(3)
    expect(dropSlot(mids, 500)).toBe(3)
  })

  it('moveTarget 은 같은 칸 위→아래면 뒤 자리 하나를 뺀다', () => {
    expect(moveTarget({ lane: 0, card: 0 }, 0, 3)).toEqual({ lane: 0, index: 2 })
    expect(moveTarget({ lane: 1, card: 1 }, 1, 3)).toEqual({ lane: 1, index: 2 })
    // 제 자리 바로 위·아래 틈은 그대로다
    expect(moveTarget({ lane: 0, card: 1 }, 0, 1)).toEqual({ lane: 0, index: 1 })
    expect(moveTarget({ lane: 0, card: 1 }, 0, 2)).toEqual({ lane: 0, index: 1 })
  })

  it('moveTarget 같은 칸 아래→위와 다른 칸은 자리 그대로다', () => {
    expect(moveTarget({ lane: 0, card: 2 }, 0, 0)).toEqual({ lane: 0, index: 0 })
    expect(moveTarget({ lane: 0, card: 2 }, 0, 1)).toEqual({ lane: 0, index: 1 })
    expect(moveTarget({ lane: 0, card: 0 }, 2, 1)).toEqual({ lane: 2, index: 1 })
    expect(moveTarget({ lane: 2, card: 3 }, 0, 0)).toEqual({ lane: 0, index: 0 })
  })
})

describe('F-2142 U3 edgeScroll', () => {
  const start = 100
  const end = 500

  it('띠 밖은 0', () => {
    expect(edgeScroll(300, start, end)).toBe(0)
    expect(edgeScroll(start + KANBAN_EDGE_PX, start, end)).toBe(0)
    expect(edgeScroll(end - KANBAN_EDGE_PX, start, end)).toBe(0)
  })

  it('가장자리는 ±12, 시작 쪽은 음수·끝 쪽은 양수', () => {
    expect(edgeScroll(start, start, end)).toBe(-12)
    expect(edgeScroll(end, start, end)).toBe(12)
    expect(edgeScroll(start - 30, start, end)).toBe(-12)
    expect(edgeScroll(end + 30, start, end)).toBe(12)
  })

  it('띠 경계 쪽으로 갈수록 0 에 가깝다', () => {
    const near = edgeScroll(start + 4, start, end)
    const mid = edgeScroll(start + KANBAN_EDGE_PX / 2, start, end)
    const far = edgeScroll(start + KANBAN_EDGE_PX - 1, start, end)
    expect(near).toBeLessThan(mid)
    expect(mid).toBeLessThan(far)
    expect(far).toBeLessThan(0)
    expect(edgeScroll(end - KANBAN_EDGE_PX + 1, start, end)).toBeGreaterThan(0)
    expect(edgeScroll(end - KANBAN_EDGE_PX + 1, start, end)).toBeLessThan(edgeScroll(end - 4, start, end))
  })
})

describe('F-2142 4장 키보드 — 옮길 자리와 포커스 옮김', () => {
  const counts = [2, 0, 3]

  it('keyMoveTarget: 같은 칸 위·아래, 옆 칸 같은 자리(길이보다 크면 끝), 맨 끝은 null', () => {
    expect(keyMoveTarget({ lane: 0, card: 1 }, counts, 'up')).toEqual({ lane: 0, index: 0 })
    expect(keyMoveTarget({ lane: 0, card: 0 }, counts, 'up')).toBeNull()
    expect(keyMoveTarget({ lane: 0, card: 0 }, counts, 'down')).toEqual({ lane: 0, index: 1 })
    expect(keyMoveTarget({ lane: 0, card: 1 }, counts, 'down')).toBeNull()
    expect(keyMoveTarget({ lane: 0, card: 1 }, counts, 'right')).toEqual({ lane: 1, index: 0 })
    expect(keyMoveTarget({ lane: 2, card: 2 }, counts, 'left')).toEqual({ lane: 1, index: 0 })
    expect(keyMoveTarget({ lane: 0, card: 1 }, counts, 'left')).toBeNull()
    expect(keyMoveTarget({ lane: 2, card: 0 }, counts, 'right')).toBeNull()
  })

  it('neighborCard: 같은 칸 위·아래, 옆 칸은 빈 칸을 건너뛰고 같은 자리 또는 마지막 카드', () => {
    expect(neighborCard({ lane: 0, card: 0 }, counts, 'down')).toEqual({ lane: 0, card: 1 })
    expect(neighborCard({ lane: 0, card: 1 }, counts, 'down')).toBeNull()
    expect(neighborCard({ lane: 0, card: 1 }, counts, 'right')).toEqual({ lane: 2, card: 1 })
    expect(neighborCard({ lane: 2, card: 2 }, counts, 'left')).toEqual({ lane: 0, card: 1 })
    expect(neighborCard({ lane: 0, card: 0 }, counts, 'left')).toBeNull()
  })
})

describe('laneMoveTarget (small 2026-10-14)', () => {
  it('끄는 칸이 남은 줄의 틈을 옮긴 뒤 순서로 — 제자리면 null', () => {
    expect(laneMoveTarget(0, 3, 3)).toBe(2)
    expect(laneMoveTarget(2, 3, 0)).toBe(0)
    expect(laneMoveTarget(1, 3, 1)).toBeNull()
    expect(laneMoveTarget(1, 3, 2)).toBeNull()
  })
  it('왼쪽·오른쪽 한 칸, 끝이면 null', () => {
    expect(laneMoveTarget(1, 3, 'left')).toBe(0)
    expect(laneMoveTarget(1, 3, 'right')).toBe(2)
    expect(laneMoveTarget(0, 3, 'left')).toBeNull()
    expect(laneMoveTarget(2, 3, 'right')).toBeNull()
  })
})
