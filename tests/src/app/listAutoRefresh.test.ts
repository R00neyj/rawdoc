import { describe, expect, it } from 'vitest'
import {
  baseIntervalMs,
  focusGapMs,
  listFingerprint,
  nextIdleStreak,
  nextIntervalMs,
  shouldStartListRefresh,
  type ListRefreshReason,
} from '../../../src/app/listAutoRefresh'

describe('F-2120 U1 baseIntervalMs', () => {
  it('행 수에 비례하고 최소·최대로 묶는다 (45초·270ms/행)', () => {
    expect(baseIntervalMs(0)).toBe(45_000)
    expect(baseIntervalMs(166)).toBe(45_000)
    expect(baseIntervalMs(500)).toBe(135_000)
    expect(baseIntervalMs(10_000)).toBe(1_800_000)
    expect(baseIntervalMs(50_000)).toBe(1_800_000)
  })
  it('덮어쓰기는 그대로 쓰고 0 이하는 끈다', () => {
    expect(baseIntervalMs(500, 1_500)).toBe(1_500)
    expect(baseIntervalMs(500, 0)).toBeNull()
    expect(baseIntervalMs(500, -1)).toBeNull()
  })
})

describe('F-2120 U2 nextIntervalMs', () => {
  it('무변화 연속 수에 따라 최대 4배', () => {
    expect([0, 1, 2, 5].map((n) => nextIntervalMs(45_000, n))).toEqual([45_000, 90_000, 180_000, 180_000])
    expect(nextIntervalMs(1_800_000, 2)).toBe(1_800_000)
    expect(nextIntervalMs(1_500, 2)).toBe(6_000)
  })
})

describe('F-2120 U3 focusGapMs', () => {
  it('기본 주기의 1/4, 최소 10초, 주기를 넘지 않는다', () => {
    expect(focusGapMs(45_000)).toBe(11_250)
    expect(focusGapMs(40_000)).toBe(10_000)
    expect(focusGapMs(135_000)).toBe(33_750)
    expect(focusGapMs(1_800_000)).toBe(450_000)
    expect(focusGapMs(1_500)).toBe(1_500)
  })
})

describe('F-2120 U4 shouldStartListRefresh', () => {
  const reasons: ListRefreshReason[] = ['interval', 'visible', 'focus', 'online', 'sidebar']
  const base = { now: 1_000_000, lastServerListAt: 0, intervalMs: 45_000, focusGapMs: 11_250, visible: true, sidebarVisible: true, online: true, signedOut: false }

  it('숨김·사이드바 안 보임·오프라인·signedOut 이면 모두 거짓', () => {
    for (const reason of reasons) {
      expect(shouldStartListRefresh({ ...base, reason, visible: false })).toBe(false)
      expect(shouldStartListRefresh({ ...base, reason, sidebarVisible: false })).toBe(false)
      expect(shouldStartListRefresh({ ...base, reason, online: false })).toBe(false)
      expect(shouldStartListRefresh({ ...base, reason, signedOut: true })).toBe(false)
    }
  })
  it('lastServerListAt 이 null 이면 참', () => {
    for (const reason of reasons) expect(shouldStartListRefresh({ ...base, reason, lastServerListAt: null })).toBe(true)
  })
  it('interval 은 경과 >= intervalMs', () => {
    expect(shouldStartListRefresh({ ...base, reason: 'interval', lastServerListAt: base.now - 44_999 })).toBe(false)
    expect(shouldStartListRefresh({ ...base, reason: 'interval', lastServerListAt: base.now - 45_000 })).toBe(true)
  })
  it('나머지 넷은 경과 >= focusGapMs', () => {
    for (const reason of ['focus', 'visible', 'online', 'sidebar'] as const) {
      expect(shouldStartListRefresh({ ...base, reason, lastServerListAt: base.now - 11_249 })).toBe(false)
      expect(shouldStartListRefresh({ ...base, reason, lastServerListAt: base.now - 11_250 })).toBe(true)
    }
  })
  it('시계가 거꾸로 가면 거짓', () => {
    expect(shouldStartListRefresh({ ...base, reason: 'interval', lastServerListAt: base.now + 1 })).toBe(false)
  })
})

describe('F-2120 U5 nextIdleStreak', () => {
  it('변화가 있으면 0, 무변화·실패면 최대 2까지 올린다', () => {
    expect(nextIdleStreak(0, { failed: false, changed: true })).toBe(0)
    expect(nextIdleStreak(0, { failed: false, changed: false })).toBe(1)
    expect(nextIdleStreak(2, { failed: false, changed: false })).toBe(2)
    expect(nextIdleStreak(1, { failed: true, changed: true })).toBe(2)
    expect(nextIdleStreak(2, { failed: false, changed: true })).toBe(0)
  })
})

describe('F-2120 U6 listFingerprint', () => {
  type D = { id: string; title: string; updatedAt: number; folderId?: string | null; pinnedAt?: number | null; role?: string }
  const docs = (): D[] => [
    { id: 'a', title: 'A', updatedAt: 1, folderId: null, pinnedAt: null, role: 'owner' },
    { id: 'b', title: 'B', updatedAt: 2, folderId: 'f', pinnedAt: 5, role: 'edit' },
  ]
  const folders = (): { id: string; name: string; parentId: string | null }[] => [{ id: 'f', name: '폴더', parentId: null }]
  const fp = (d = docs(), f = folders()) => listFingerprint(d, f)

  it('같은 내용은 다른 배열이어도 같다', () => {
    expect(fp()).toBe(fp())
  })
  it('각 필드 변화는 다르다', () => {
    const base = fp()
    expect(fp(docs().slice(0, 1))).not.toBe(base)
    expect(fp([...docs(), { id: 'c', title: 'C', updatedAt: 3 }])).not.toBe(base)
    for (const patch of [{ updatedAt: 9 }, { title: 'X' }, { folderId: 'g' }, { pinnedAt: 6 }, { role: 'view' }]) {
      const d = docs()
      d[1] = { ...d[1], ...patch }
      expect(fp(d)).not.toBe(base)
    }
    expect(fp(docs(), [{ id: 'f', name: '다름', parentId: null }])).not.toBe(base)
    expect(fp(docs(), [{ id: 'f', name: '폴더', parentId: 'p' }])).not.toBe(base)
  })
})
