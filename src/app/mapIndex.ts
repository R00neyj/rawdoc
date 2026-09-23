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
}

type CachedEntry = MapIndexEntry & { __key: string }

let cache = new Map<string, CachedEntry>()
let cachedScope: string | null = null

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
}

export async function buildMapIndex(args: { store: MapSource; scope: string; docs?: Doc[] }): Promise<MapIndexResult> {
  const { store, scope } = args

  if (scope !== cachedScope) {
    cache.clear()
  }

  const docs = args.docs ?? (await store.list())

  let rebuiltCount = 0
  let reusedCount = 0
  const entries: MapIndexEntry[] = []
  const seenIds = new Set<string>()

  for (const doc of docs) {
    seenIds.add(doc.id)
    const key = changeKey(doc)
    const hit = cache.get(doc.id)

    let cached: CachedEntry
    if (hit && hit.__key === key) {
      cached = hit
      reusedCount++
    } else {
      cached = {
        id: doc.id,
        title: doc.title,
        targets: extractWikiTargets(doc.content),
        unreadable: doc.content === '',
        updatedAt: doc.updatedAt,
        __key: key,
      }
      rebuiltCount++
    }

    cache.set(doc.id, cached)
    entries.push({ id: cached.id, title: cached.title, targets: cached.targets, unreadable: cached.unreadable, updatedAt: cached.updatedAt })
  }

  // list() 에 없는 id 는 지운다 — 끝에 둬서 중간에 실패해도 인덱스가 반쯤 지워지지 않는다
  for (const id of [...cache.keys()]) {
    if (!seenIds.has(id)) cache.delete(id)
  }

  cachedScope = scope

  return { entries, rebuiltCount, reusedCount }
}

// 모듈 수준 캐시를 비운다. 테스트가 매번 부른다
export function resetMapIndexCache(): void {
  cache = new Map()
  cachedScope = null
}
