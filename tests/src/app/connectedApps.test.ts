import { describe, expect, it } from 'vitest'
import { connectedAppMeta, focusAfterRemove, formatLastUsed, isConnectedAppList } from '../../../src/app/connectedApps'

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime()
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN

describe('F-2148 U2 formatLastUsed', () => {
  it('60초 미만은 방금 전, 이상은 분 단위', () => {
    expect(formatLastUsed(NOW - 59 * SEC, NOW)).toBe('방금 전')
    expect(formatLastUsed(NOW - 60 * SEC, NOW)).toBe('1분 전')
    expect(formatLastUsed(NOW - 59 * MIN, NOW)).toBe('59분 전')
  })
  it('60분부터 24시간 미만은 시간 단위', () => {
    expect(formatLastUsed(NOW - 60 * MIN, NOW)).toBe('1시간 전')
    expect(formatLastUsed(NOW - (23 * HOUR + 59 * MIN), NOW)).toBe('23시간 전')
  })
  it('24시간을 넘으면 지역 날짜 기준 어제·N일 전·날짜', () => {
    const at = new Date(2026, 9, 15, 11, 59, 0).getTime()
    expect(formatLastUsed(at, NOW)).toBe('어제')
    expect(formatLastUsed(new Date(2026, 9, 15, 0, 1, 0).getTime(), NOW)).toBe('어제')
    expect(formatLastUsed(new Date(2026, 9, 14, 8, 0, 0).getTime(), NOW)).toBe('2일 전')
    expect(formatLastUsed(new Date(2026, 8, 17, 8, 0, 0).getTime(), NOW)).toBe('29일 전')
    expect(formatLastUsed(new Date(2026, 8, 16, 8, 0, 0).getTime(), NOW)).toBe('2026-09-16')
  })
  it('미래 시각은 방금 전', () => {
    expect(formatLastUsed(NOW + 5 * MIN, NOW)).toBe('방금 전')
  })
})

describe('F-2148 U2 connectedAppMeta', () => {
  const base = { id: 'a', name: 'n', host: 'h', createdAt: new Date(2026, 9, 1, 9, 0, 0).getTime(), lastUsedAt: null }
  it('사용 있음', () => {
    expect(connectedAppMeta({ ...base, lastUsedAt: NOW - 3 * MIN }, NOW)).toBe('2026-10-01 연결 · 마지막 사용 3분 전')
  })
  it('사용 없음', () => {
    expect(connectedAppMeta(base, NOW)).toBe('2026-10-01 연결 · 아직 사용 안 함')
  })
})

describe('F-2148 U3 focusAfterRemove', () => {
  const ids = ['a', 'b', 'c']
  it('가운데는 다음, 끝은 앞', () => {
    expect(focusAfterRemove(ids, 'b')).toBe('c')
    expect(focusAfterRemove(ids, 'c')).toBe('b')
  })
  it('하나뿐이면 null, 없는 id 면 첫 행', () => {
    expect(focusAfterRemove(['a'], 'a')).toBeNull()
    expect(focusAfterRemove(ids, 'x')).toBe('a')
  })
})

describe('F-2148 U3 isConnectedAppList', () => {
  const ok = { id: 'a', name: 'n', host: 'h', createdAt: 1, lastUsedAt: null }
  it('올바른 목록', () => {
    expect(isConnectedAppList([])).toBe(true)
    expect(isConnectedAppList([ok, { ...ok, lastUsedAt: 5 }])).toBe(true)
  })
  it('키 빠짐·형 틀림은 거짓', () => {
    expect(isConnectedAppList([{ id: 'a', name: 'n', host: 'h', createdAt: 1 }])).toBe(false)
    expect(isConnectedAppList([{ ...ok, lastUsedAt: 'x' }])).toBe(false)
    expect(isConnectedAppList({})).toBe(false)
    expect(isConnectedAppList(null)).toBe(false)
  })
})
