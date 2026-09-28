import { describe, it, expect, vi } from 'vitest'
import {
  LIST_FRESH_TTL_MS,
  isListStale,
  hasLiveChangesSince,
  combineCachedList,
  createListRefresher,
  createCachedListSource,
  type ListRefresher,
} from './cachedList'
import type { Doc, Folder } from '../types'

function doc(id: string, updatedAt: number, extra: Partial<Doc> = {}): Doc {
  return { id, title: id, content: '', lineEnding: 'lf', folderId: null, pinnedAt: null, createdAt: updatedAt, updatedAt, ...extra }
}

function folder(id: string): Folder {
  return { id, name: id, parentId: null, createdAt: 1, updatedAt: 1 }
}

async function flush(n = 5) {
  for (let i = 0; i < n; i++) await Promise.resolve()
}

describe('F-2056 C1 isListStale', () => {
  it('null → 참, TTL-1 → 거짓, TTL → 참, 시계가 뒤로 가면 거짓', () => {
    expect(isListStale({ lastServerListAt: null, now: 1000 })).toBe(true)
    expect(isListStale({ lastServerListAt: 1000, now: 1000 + LIST_FRESH_TTL_MS - 1 })).toBe(false)
    expect(isListStale({ lastServerListAt: 1000, now: 1000 + LIST_FRESH_TTL_MS })).toBe(true)
    expect(isListStale({ lastServerListAt: 5000, now: 1000 })).toBe(false)
    expect(LIST_FRESH_TTL_MS).toBe(600_000)
  })
})

describe('F-2056 C2 hasLiveChangesSince', () => {
  it('빈 Map 거짓, 값 > since 참, 값 = since 거짓, since null + 비지 않음 참', () => {
    expect(hasLiveChangesSince(new Map(), 10)).toBe(false)
    expect(hasLiveChangesSince(new Map([['a', 11]]), 10)).toBe(true)
    expect(hasLiveChangesSince(new Map([['a', 10]]), 10)).toBe(false)
    expect(hasLiveChangesSince(new Map([['a', 1]]), null)).toBe(true)
    expect(hasLiveChangesSince(new Map(), null)).toBe(false)
  })
})

describe('F-2056 C3 combineCachedList', () => {
  it('shared null → 캐시만 정렬, sharedListed false', () => {
    const cached = [doc('a', 1), doc('b', 3)]
    const out = combineCachedList({ cached, shared: null })
    expect(out.docs.map((d) => d.id)).toEqual(['b', 'a'])
    expect(out.sharedListed).toBe(false)
    expect(cached.map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('같은 id 는 공유 쪽 하나만, updatedAt 내림차순, 입력 불변', () => {
    const cached = [doc('a', 1, { role: 'owner' }), doc('s', 5, { role: 'owner' })]
    const shared = [doc('s', 4, { role: 'edit' }), doc('t', 2, { role: 'view' })]
    const out = combineCachedList({ cached, shared })
    expect(out.sharedListed).toBe(true)
    expect(out.docs.map((d) => `${d.id}:${d.role}`)).toEqual(['s:edit', 't:view', 'a:owner'])
    expect(cached).toHaveLength(2)
    expect(shared).toHaveLength(2)
    expect(shared.map((d) => d.id)).toEqual(['s', 't'])
  })
})

function deferred() {
  let resolve!: () => void
  let reject!: (err: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('F-2056 C4 createListRefresher run', () => {
  it('동시 두 번 → refresh 1번·같은 약속, 끝난 뒤 다시, 던져도 resolve', async () => {
    const gate = deferred()
    const refresh = vi.fn(() => gate.promise)
    const r = createListRefresher({ refresh, isStale: () => true })
    const p1 = r.run()
    const p2 = r.run()
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(p1).toBe(p2)
    gate.resolve()
    await p1
    await r.run()
    expect(refresh).toHaveBeenCalledTimes(2)

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = createListRefresher({ refresh: () => Promise.reject(new Error('x')), isStale: () => true })
    await expect(failing.run()).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe('F-2056 C5 maybeRefresh', () => {
  it('isStale 거짓 0번, 참 1번, 진행 중 또 불러도 1번', async () => {
    let stale = false
    const gate = deferred()
    const refresh = vi.fn(() => gate.promise)
    const r = createListRefresher({ refresh, isStale: () => stale })
    r.maybeRefresh()
    expect(refresh).toHaveBeenCalledTimes(0)
    stale = true
    r.maybeRefresh()
    r.maybeRefresh()
    expect(refresh).toHaveBeenCalledTimes(1)
    gate.resolve()
    await flush()
  })
})

function makeSource(over: {
  hasLiveChanges?: boolean
  online?: boolean
  refresher?: ListRefresher
  shared?: Doc[] | null
  calls?: string[]
}) {
  const calls = over.calls ?? []
  const listCached = vi.fn(async () => {
    calls.push('listCached')
    return { docs: [doc('a', 1), doc('b', 2)], folders: [folder('f1')] }
  })
  const refresher: ListRefresher = over.refresher ?? { run: vi.fn(async () => {}), maybeRefresh: vi.fn() }
  const source = createCachedListSource({
    listCached,
    lastSharedList: () => (over.shared === undefined ? [doc('s', 3, { role: 'view' })] : over.shared),
    hasLiveChanges: () => over.hasLiveChanges ?? false,
    isOnline: () => over.online ?? true,
    refresher,
  })
  return { source, listCached, refresher, calls }
}

describe('F-2056 C6 소스 한 회차', () => {
  it('list·listFolders 를 같은 틱에 → listCached 1번, 캐시 ∪ 공유, 캐시 폴더', async () => {
    const { source, listCached } = makeSource({})
    const [docs, folders] = await Promise.all([source.list(), source.listFolders()])
    expect(listCached).toHaveBeenCalledTimes(1)
    expect(docs.map((d) => d.id)).toEqual(['s', 'b', 'a'])
    expect(folders.map((f) => f.id)).toEqual(['f1'])
    await source.list()
    expect(listCached).toHaveBeenCalledTimes(2)
  })
})

describe('F-2056 C7 실시간 변경 없음', () => {
  it('TTL 안 → refresh 0번, TTL 밖 → 1번이고 list() 는 기다리지 않는다', async () => {
    const fresh = vi.fn(() => Promise.resolve())
    const inTtl = makeSource({ refresher: createListRefresher({ refresh: fresh, isStale: () => false }) })
    await inTtl.source.list()
    expect(fresh).toHaveBeenCalledTimes(0)

    const never = vi.fn(() => new Promise<void>(() => {}))
    const outTtl = makeSource({ refresher: createListRefresher({ refresh: never, isStale: () => true }) })
    const docs = await outTtl.source.list()
    expect(never).toHaveBeenCalledTimes(1)
    expect(docs.length).toBe(3)
  })
})

describe('F-2056 C8 실시간 변경 있음', () => {
  it('온라인 → refresh 가 끝난 뒤 listCached, 오프라인 → 곧바로 listCached', async () => {
    const calls: string[] = []
    const gate = deferred()
    const refresh = vi.fn(async () => {
      calls.push('refresh-start')
      await gate.promise
      calls.push('refresh-end')
    })
    const online = makeSource({ hasLiveChanges: true, online: true, calls, refresher: createListRefresher({ refresh, isStale: () => false }) })
    const p = online.source.list()
    await flush(10)
    expect(calls).toEqual(['refresh-start'])
    gate.resolve()
    await p
    expect(calls).toEqual(['refresh-start', 'refresh-end', 'listCached'])

    const offCalls: string[] = []
    const never = vi.fn(() => new Promise<void>(() => {}))
    const offline = makeSource({ hasLiveChanges: true, online: false, calls: offCalls, refresher: createListRefresher({ refresh: never, isStale: () => false }) })
    await offline.source.list()
    expect(offCalls).toEqual(['listCached'])
    expect(never).toHaveBeenCalledTimes(0)
  })
})
