// 서버 목록 줄이기 — 캐시 목록 + 마지막 공유 목록, 서버 목록은 TTL 밖에서만 뒤에서 (specs/features/F-2056.md 5장)
import type { Doc, Folder, Store } from '../types'

export const LIST_FRESH_TTL_MS = 600_000

export function isListStale(input: { lastServerListAt: number | null; now: number; ttlMs?: number }): boolean {
  if (input.lastServerListAt === null) return true
  if (input.now < input.lastServerListAt) return false
  return input.now - input.lastServerListAt >= (input.ttlMs ?? LIST_FRESH_TTL_MS)
}

export function hasLiveChangesSince(changedAt: ReadonlyMap<string, number>, since: number | null): boolean {
  if (since === null) return changedAt.size > 0
  for (const at of changedAt.values()) if (at > since) return true
  return false
}

// 같은 id 는 공유 목록 쪽이 이긴다 — 첫 편집으로 캐시된 공유 문서가 owner 로 뒤집히지 않게 (3.2)
export function combineCachedList<T extends { id: string; updatedAt: number }>(input: {
  cached: readonly T[]
  shared: readonly T[] | null
}): { docs: T[]; sharedListed: boolean } {
  const byUpdatedAtDesc = (a: T, b: T) => b.updatedAt - a.updatedAt
  if (input.shared === null) return { docs: [...input.cached].sort(byUpdatedAtDesc), sharedListed: false }
  const sharedIds = new Set(input.shared.map((d) => d.id))
  const docs = [...input.cached.filter((d) => !sharedIds.has(d.id)), ...input.shared].sort(byUpdatedAtDesc)
  return { docs, sharedListed: true }
}

export type ListRefresher = {
  run(): Promise<void>
  maybeRefresh(): void
}

export function createListRefresher(deps: { refresh: () => Promise<void>; isStale: () => boolean }): ListRefresher {
  let running: Promise<void> | null = null
  function run(): Promise<void> {
    if (running) return running
    const current = (async () => {
      try {
        await deps.refresh()
      } catch (err) {
        console.error('list_refresh_failed', err)
      }
    })()
    running = current
    void current.finally(() => {
      if (running === current) running = null
    })
    return current
  }
  return {
    run,
    maybeRefresh() {
      if (running || !deps.isStale()) return
      void run()
    },
  }
}

// 이 페이지에서 /api/docs 를 읽은 회차가 아직 없고 온라인이면 그 회차(진행 중이면 합류)를 기다린다. 거부는 삼킨다 (F-2133 5.2)
export function waitFirstServerList(store: { lastServerListAt(): number | null; list(): Promise<unknown> }, online: boolean): Promise<void> | null {
  if (store.lastServerListAt() !== null || !online) return null
  return store.list().then(
    () => {},
    () => {},
  )
}

// 검색·지도에 넘기는 목록 소스 — list()·listFolders() 가 한 번의 캐시 읽기를 나눠 쓴다 (5.5)
export function createCachedListSource(deps: {
  listCached: () => Promise<{ docs: Doc[]; folders: Folder[] }>
  lastSharedList: () => Doc[] | null
  hasLiveChanges: () => boolean
  isOnline: () => boolean
  refresher: ListRefresher
  firstServerList: () => Promise<void> | null
}): Pick<Store, 'list' | 'listFolders'> {
  let round: Promise<{ docs: Doc[]; folders: Folder[] }> | null = null

  async function readRound(): Promise<{ docs: Doc[]; folders: Folder[] }> {
    const first = deps.firstServerList()
    if (first) await first
    if (deps.hasLiveChanges() && deps.isOnline()) await deps.refresher.run()
    else deps.refresher.maybeRefresh()
    const cached = await deps.listCached()
    return { docs: combineCachedList({ cached: cached.docs, shared: deps.lastSharedList() }).docs, folders: cached.folders }
  }

  function currentRound() {
    if (!round) {
      const started = readRound()
      round = started
      const clear = () => {
        if (round === started) round = null
      }
      started.then(clear, clear)
    }
    return round
  }

  return {
    async list() {
      return (await currentRound()).docs
    },
    async listFolders() {
      return (await currentRound()).folders
    },
  }
}
