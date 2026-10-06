// F-2042 7.3 B1~B3 — 부팅 캐시 먼저 셸의 순수 함수, F-2134 7장 B4·B5
import { describe, expect, it } from 'vitest'
import { ACCOUNT_CONFIRM_WAIT_MS, canShowCachedShell, canStartBeforeAccount, judgeEarlyAccount, mergeBootList, shouldApplyListResult } from '../../../src/app/bootList'
import type { HashRoute } from '../../../src/app/hashRoute'

const NONE: HashRoute = { type: 'none' }
const HELP: HashRoute = { type: 'help' }
const SHARES: HashRoute = { type: 'shares' }
const SHARE: HashRoute = { type: 'share', fragment: 'abc' }
const MAP_NO_ID: HashRoute = { type: 'map' }

describe('B1 canShowCachedShell', () => {
  const base = {
    storeKind: 'server' as const,
    accountState: 'in' as const,
    hash: NONE,
    cachedDocIds: new Set(['d1', 'd2']),
  }

  it('4.1 표를 모두 만족하면 참 — none·help·shares·map(id 없음)·doc(캐시에 있음)', () => {
    expect(canShowCachedShell(base)).toBe(true)
    expect(canShowCachedShell({ ...base, hash: HELP })).toBe(true)
    expect(canShowCachedShell({ ...base, hash: SHARES })).toBe(true)
    expect(canShowCachedShell({ ...base, hash: MAP_NO_ID })).toBe(true)
    expect(canShowCachedShell({ ...base, hash: { type: 'doc', docId: 'd1' } })).toBe(true)
  })

  it('storeKind 가 server 가 아니면 거짓', () => {
    expect(canShowCachedShell({ ...base, storeKind: 'idb' })).toBe(false)
    expect(canShowCachedShell({ ...base, storeKind: 'memory' })).toBe(false)
  })

  it('accountState 가 in 이 아니면 거짓', () => {
    expect(canShowCachedShell({ ...base, accountState: 'out' })).toBe(false)
    expect(canShowCachedShell({ ...base, accountState: 'offline' })).toBe(false)
  })

  it('캐시 문서가 0개면 거짓', () => {
    expect(canShowCachedShell({ ...base, cachedDocIds: new Set() })).toBe(false)
  })

  it('해시가 공유 링크(share) 면 거짓', () => {
    expect(canShowCachedShell({ ...base, hash: SHARE })).toBe(false)
  })

  it('해시가 doc 인데 캐시에 없으면 거짓', () => {
    expect(canShowCachedShell({ ...base, hash: { type: 'doc', docId: 'other' } })).toBe(false)
  })

  it('해시가 map 이고 docId 가 있는데 캐시에 없으면 거짓, 캐시에 있으면 참', () => {
    expect(canShowCachedShell({ ...base, hash: { type: 'map', docId: 'other' } })).toBe(false)
    expect(canShowCachedShell({ ...base, hash: { type: 'map', docId: 'd1' } })).toBe(true)
  })
})

type T = { id: string; updatedAt: number }

describe('B2 mergeBootList', () => {
  it('스냅샷에 있었는데 결과에 없는 것만 지운다 — 스냅샷 뒤 생긴 문서는 남긴다', () => {
    const snapshotIds = new Set(['a', 'b', 'c'])
    const current: T[] = [
      { id: 'a', updatedAt: 1 },
      { id: 'b', updatedAt: 2 },
      { id: 'c', updatedAt: 3 },
      { id: 'n', updatedAt: 4 },
    ]
    const result: T[] = [
      { id: 'a', updatedAt: 10 },
      { id: 'c', updatedAt: 30 },
      { id: 'd', updatedAt: 40 },
    ]
    const { docs, removedIds } = mergeBootList({ snapshotIds, current, result })
    expect(removedIds).toEqual(['b'])
    expect(new Set(docs.map((d) => d.id))).toEqual(new Set(['a', 'c', 'd', 'n']))
    // updatedAt 내림차순
    expect(docs.map((d) => d.updatedAt)).toEqual([...docs.map((d) => d.updatedAt)].sort((x, y) => y - x))
    // 결과에 있는 문서는 결과 값으로 바뀐다
    expect(docs.find((d) => d.id === 'a')?.updatedAt).toBe(10)
    // 스냅샷 밖 문서(n)는 current 값 그대로
    expect(docs.find((d) => d.id === 'n')?.updatedAt).toBe(4)
  })

  it('빠진 것이 없으면 removedIds 가 빈 배열', () => {
    const snapshotIds = new Set(['a'])
    const current: T[] = [{ id: 'a', updatedAt: 1 }]
    const result: T[] = [{ id: 'a', updatedAt: 2 }]
    const { docs, removedIds } = mergeBootList({ snapshotIds, current, result })
    expect(removedIds).toEqual([])
    expect(docs).toEqual([{ id: 'a', updatedAt: 2 }])
  })
})

describe('B3 shouldApplyListResult — 순번 비교', () => {
  it('순번 2 결과가 이미 반영된 뒤 순번 1 결과는 반영하지 않는다', () => {
    expect(shouldApplyListResult({ seq: 1, lastAppliedSeq: 2 })).toBe(false)
  })

  it('더 늦게 시작한(순번이 큰) 결과는 반영한다', () => {
    expect(shouldApplyListResult({ seq: 3, lastAppliedSeq: 2 })).toBe(true)
  })

  it('같은 순번은 반영하지 않는다(중복 반영 방지)', () => {
    expect(shouldApplyListResult({ seq: 2, lastAppliedSeq: 2 })).toBe(false)
  })
})

describe('B4 canStartBeforeAccount', () => {
  const base = { storedAccountId: 'u1', localMigratedId: 'u1', hash: NONE }

  it('저장 id 없음 / localMigratedId 다름 / share 해시면 거짓', () => {
    expect(canStartBeforeAccount({ ...base, storedAccountId: null })).toBe(false)
    expect(canStartBeforeAccount({ ...base, localMigratedId: '' })).toBe(false)
    expect(canStartBeforeAccount({ ...base, localMigratedId: 'u2' })).toBe(false)
    expect(canStartBeforeAccount({ ...base, hash: SHARE })).toBe(false)
  })

  it('조건이 맞으면 home·none·doc·map·help·shares 에서 참', () => {
    const hashes: HashRoute[] = [{ type: 'home' }, NONE, { type: 'doc', docId: 'd1' }, MAP_NO_ID, { type: 'map', docId: 'd1' }, HELP, SHARES]
    for (const hash of hashes) expect(canStartBeforeAccount({ ...base, hash })).toBe(true)
  })
})

describe('B5 judgeEarlyAccount', () => {
  const inAs = (id: string) => ({ state: 'in' as const, id, email: `${id}@example.com`, blocked: false, warned: false })

  it('in 같은 id·offline 은 confirm', () => {
    expect(judgeEarlyAccount({ earlyId: 'u1', result: inAs('u1'), storedIdAfter: 'u1' })).toBe('confirm')
    expect(judgeEarlyAccount({ earlyId: 'u1', result: { state: 'offline' }, storedIdAfter: 'u1' })).toBe('confirm')
  })

  it('in 다른 id + 저장 갱신·out + 저장 지움은 reload', () => {
    expect(judgeEarlyAccount({ earlyId: 'u1', result: inAs('u2'), storedIdAfter: 'u2' })).toBe('reload')
    expect(judgeEarlyAccount({ earlyId: 'u1', result: { state: 'out' }, storedIdAfter: null })).toBe('reload')
  })

  it('저장이 그대로면 stuck', () => {
    expect(judgeEarlyAccount({ earlyId: 'u1', result: inAs('u2'), storedIdAfter: 'u1' })).toBe('stuck')
    expect(judgeEarlyAccount({ earlyId: 'u1', result: { state: 'out' }, storedIdAfter: 'u1' })).toBe('stuck')
  })

  it('확인 대기 상한은 5,000ms', () => {
    expect(ACCOUNT_CONFIRM_WAIT_MS).toBe(5_000)
  })
})
