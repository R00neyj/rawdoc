// 저장소 → 위키링크 지도 인덱스, 바뀐 문서만 다시 만든다 (specs/features/F-292.md 5.3, F-284 5.3 과 같은 방식)
import { extractWikiTargets } from '../lib/wikiGraph'
import type { Doc, Store } from '../types'

// 폴더 목록도 읽어야 지도 필터의 `폴더` 항목을 그릴 수 있다 (F-2007 5.5)
export type MapSource = Pick<Store, 'list' | 'listFolders'>

export type MapIndexEntry = {
  id: string
  title: string
  targets: string[]
  unreadable: boolean // content 가 '' — 공유받은 문서라 본문을 못 읽었을 때 (F-284 5.2 와 같다)
  updatedAt: number
  folderId: string | null // 캐시하지 않는다 — moveDoc 은 updatedAt 을 안 바꾼다 (F-2018 9.2)
}

type CachedEntry = Omit<MapIndexEntry, 'folderId'> & { __key: string }

let cache = new Map<string, CachedEntry>()
let cachedScope: string | null = null
// resetMapIndexCache 가 올리는 세대 표지 — 기다리는 동안 잠기면(F-405 c7) 캐시를 다시 쓰지 않는다 (F-409 3.3)
let generation = 0

// 인덱스를 만든 저장소 표시 — store.kind + 계정 id. 다르면 통째로 버린다 (5.3)
export function mapIndexScope(kind: Store['kind'], accountId: string | null): string {
  return `${kind}:${accountId ?? 'local'}`
}

// 판정 키는 updatedAt 과 title 둘 다, '>' 가 아니라 '!==' (5.3)
function changeKey(doc: Pick<Doc, 'updatedAt' | 'title'>): string {
  return `${doc.updatedAt}\u0000${doc.title}`
}

export type MapIndexResult = {
  entries: MapIndexEntry[]
  rebuiltCount: number
  reusedCount: number
  lockedCount: number // e2ee === 'locked' 이라 넣지 않은 문서 수 (MapPage 발 안내, F-409 3.2)
}

function buildFreshEntry(doc: Doc): CachedEntry {
  return {
    id: doc.id,
    title: doc.title,
    targets: extractWikiTargets(doc.content),
    unreadable: doc.content === '',
    updatedAt: doc.updatedAt,
    __key: changeKey(doc),
  }
}

export async function buildMapIndex(args: { store: MapSource; scope: string; docs?: Doc[] }): Promise<MapIndexResult> {
  const { store, scope } = args
  const startGeneration = generation

  if (scope !== cachedScope) {
    cache.clear()
  }

  const docs = args.docs ?? (await store.list())

  let rebuiltCount = 0
  let reusedCount = 0
  let lockedCount = 0
  const entries: MapIndexEntry[] = []

  // 목록을 기다리는 동안 잠기면(세대가 바뀌면) 캐시를 읽지도 쓰지도 지우지도 않는다 — 이미 취소된 호출이라 이번 목록만 계산해 돌려준다 (F-409 3.3)
  if (generation !== startGeneration) {
    for (const doc of docs) {
      if (doc.e2ee === 'locked') {
        lockedCount++
        continue
      }
      const fresh = buildFreshEntry(doc)
      rebuiltCount++
      entries.push({ id: fresh.id, title: fresh.title, targets: fresh.targets, unreadable: fresh.unreadable, updatedAt: fresh.updatedAt, folderId: doc.folderId ?? null })
    }
    return { entries, rebuiltCount, reusedCount, lockedCount }
  }

  const seenIds = new Set<string>()

  for (const doc of docs) {
    // 잠긴 금고 문서는 항목·unreadable 어디에도 안 넣는다 — seenIds 에서도 빠져 지우기 단계가 캐시의 평문을 스스로 지운다 (F-409 3.2)
    if (doc.e2ee === 'locked') {
      lockedCount++
      continue
    }
    seenIds.add(doc.id)
    const key = changeKey(doc)
    const hit = cache.get(doc.id)

    let cached: CachedEntry
    if (hit && hit.__key === key) {
      cached = hit
      reusedCount++
    } else {
      cached = buildFreshEntry(doc)
      rebuiltCount++
    }

    cache.set(doc.id, cached)
    entries.push({
      id: cached.id,
      title: cached.title,
      targets: cached.targets,
      unreadable: cached.unreadable,
      updatedAt: cached.updatedAt,
      folderId: doc.folderId ?? null,
    })
  }

  // list() 에 없는 id 는 지운다 — 끝에 둬서 중간에 실패해도 인덱스가 반쯤 지워지지 않는다
  for (const id of [...cache.keys()]) {
    if (!seenIds.has(id)) cache.delete(id)
  }

  cachedScope = scope

  return { entries, rebuiltCount, reusedCount, lockedCount }
}

// 모듈 수준 캐시를 비운다. 테스트가 매번 부른다. 세대를 올려, 이미 기다리던 buildMapIndex 가 이 리셋 뒤 평문을 캐시에 다시 쓰지 못하게 한다 (F-409 3.3)
export function resetMapIndexCache(): void {
  cache = new Map()
  cachedScope = null
  generation++
}

// 캐시에 든 항목 수. 테스트·계측용 (F-409 3.2)
export function mapIndexCacheSize(): number {
  return cache.size
}
