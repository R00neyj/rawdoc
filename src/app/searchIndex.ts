// 검색 인덱스 만들기·재사용. 순수 데이터만 다룬다 — React·DOM·CM6 를 import 하지 않는다 (specs/features/F-286.md)
import { findFrontmatter, parseSimpleProperties, textAfterFrontmatter, type FrontmatterProperty } from '../lib/frontmatter'
import type { Doc, Folder, Store } from '../types'

// 이 모듈이 저장소에서 쓰는 것은 이 둘뿐이다 (F-286.md 3.1)
export type SearchSource = Pick<Store, 'list' | 'listFolders'>

// parseSimpleProperties 결과를 NFC 정규화한 것. 대소문자는 그대로 둔다. F-285 의 SearchProperty 와 모양이 같다 — 두 모듈이 각자 선언하고 구조적으로 맞춘다 (4.3, 8장 Q2)
export type SearchProperty = { key: string; value: string | string[] }

export type SearchIndexEntry = {
  id: string
  title: string // NFC 정규화한 제목. 제목 매칭과 결과 행 표시에 같이 쓴다
  body: string // 프론트매터를 뗀 뒤 NFC 정규화한 본문. 공유받은 문서는 '' (3.3)
  properties: SearchProperty[] | null // 프론트매터가 없거나 파서가 못 읽었으면 null (4.3)
  frontmatterUnreadable: boolean // 프론트매터는 있는데 parseSimpleProperties 가 null 을 돌려준 문서. 안내 문구용 (F-284 4.4)
  folderId: string | null
  folderPath: string // '상위 / 하위'. 폴더 밖이거나 없는 폴더를 가리키면 '' (4.4)
  updatedAt: number
  shared: boolean // role 이 'edit'|'view' 인 문서 — 본문을 넣지 않았다 (3.3)
}

export type SearchIndex = {
  scope: string
  entries: SearchIndexEntry[] // store.list() 순서 그대로 (updatedAt 내림차순). 정렬은 F-285·F-287 몫
  frontmatterUnreadableCount: number // frontmatterUnreadable 인 문서 수 (F-284 4.4 안내 문구)
  sharedCount: number // shared 인 문서 수 (F-284 4.4 안내 문구)
  rebuiltCount: number // 이번 호출에서 본문을 새로 만든 문서 수 — 계측·테스트용 (7장)
  reusedCount: number // 이번 호출에서 캐시를 재사용한 문서 수
  lockedCount: number // e2ee === 'locked' 이라 항목을 만들지 않은 문서 수 (SearchDialog 안내 줄, F-409 3.1)
}

// 인덱스 재사용 범위 키. 계정·저장소 종류가 다르면 인덱스를 통째로 버린다 (3.4)
export function searchScope(kind: Store['kind'], accountId: string | null): string {
  return `${kind}:${accountId ?? 'local'}`
}

// 변경 판정 키. 순수 함수 (3.5)
export function changeKey(doc: Pick<Doc, 'updatedAt' | 'content' | 'title'>): string {
  return `${doc.updatedAt}\u0000${doc.content.length}\u0000${doc.title}`
}

// 순환 참조를 만나면 멈추고 그 폴더 이름만 돌려준다 (4.4, serverStore.sortFoldersParentFirst 와 같은 방어)
function resolveFolderPath(id: string, byId: Map<string, Folder>, cache: Map<string, string>, visiting: Set<string>): string {
  const cached = cache.get(id)
  if (cached !== undefined) return cached
  const folder = byId.get(id)
  if (!folder) return ''
  if (visiting.has(id)) return folder.name // 순환 참조 방어
  visiting.add(id)
  const parentId = folder.parentId
  const parentPath = parentId && byId.has(parentId) ? resolveFolderPath(parentId, byId, cache, visiting) : ''
  const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name
  visiting.delete(id)
  cache.set(id, path)
  return path
}

// 폴더 id → '상위 / 하위' 경로 표. 한 번만 만든다. 순수 함수 (4.4)
export function folderPathMap(folders: Folder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const cache = new Map<string, string>()
  for (const folder of folders) {
    resolveFolderPath(folder.id, byId, cache, new Set())
  }
  return cache
}

function normalizeProperty(prop: FrontmatterProperty): SearchProperty {
  return {
    key: prop.key.normalize('NFC'),
    value: Array.isArray(prop.value) ? prop.value.map((v) => v.normalize('NFC')) : prop.value.normalize('NFC'),
  }
}

// 문서 하나를 인덱스 항목으로. 순수 함수 — store 를 모른다 (4.3)
export function makeIndexEntry(doc: Doc, folderPaths: Map<string, string>): SearchIndexEntry {
  const shared = doc.role === 'edit' || doc.role === 'view'
  const raw = shared ? '' : doc.content
  const fm = raw ? findFrontmatter(raw) : null
  const rawBody = fm ? textAfterFrontmatter(raw, fm) : raw
  const parsed = fm ? parseSimpleProperties(raw.slice(fm.contentFrom, fm.contentTo)) : null
  const properties = parsed ? parsed.map(normalizeProperty) : null
  const frontmatterUnreadable = fm !== null && parsed === null

  return {
    id: doc.id,
    title: doc.title.normalize('NFC'),
    body: rawBody.normalize('NFC'),
    properties,
    frontmatterUnreadable,
    folderId: doc.folderId,
    folderPath: doc.folderId ? (folderPaths.get(doc.folderId) ?? '') : '',
    updatedAt: doc.updatedAt,
    shared,
  }
}

// 캐시에 담는 비공개 모양. entries 로 내보낼 때는 __key 를 뺀다 (5.2)
type CachedEntry = SearchIndexEntry & { __key: string }

let cache = new Map<string, CachedEntry>()
let cachedScope: string | null = null
let cachedStore: SearchSource | null = null
// resetSearchIndexCache 가 올리는 세대 표지 — 기다리는 동안 잠기면(F-405 c7) 캐시를 다시 쓰지 않는다 (F-409 3.3)
let generation = 0

function toPublicEntry(entry: CachedEntry): SearchIndexEntry {
  const { id, title, body, properties, frontmatterUnreadable, folderId, folderPath, updatedAt, shared } = entry
  return { id, title, body, properties, frontmatterUnreadable, folderId, folderPath, updatedAt, shared }
}

// 인덱스를 만들거나 다시 쓴다. 모듈 수준 Map 을 쓴다 (5장)
export async function buildSearchIndex(args: { store: SearchSource; scope: string; docs?: Doc[]; folders?: Folder[] }): Promise<SearchIndex> {
  const { store, scope } = args
  const startGeneration = generation

  // 범위·저장소가 바뀌면 통째로 버린다 (3.4)
  if (scope !== cachedScope || store !== cachedStore) {
    cache.clear()
  }

  const [docs, folders] = await Promise.all([
    args.docs ? Promise.resolve(args.docs) : store.list(),
    args.folders ? Promise.resolve(args.folders) : store.listFolders(),
  ])
  const folderPaths = folderPathMap(folders)

  let rebuiltCount = 0
  let reusedCount = 0
  let frontmatterUnreadableCount = 0
  let sharedCount = 0
  let lockedCount = 0
  const entries: SearchIndexEntry[] = []

  // 목록을 기다리는 동안 잠기면(세대가 바뀌면) 캐시를 읽지도 쓰지도 지우지도 않는다 — 이미 취소된 호출이라 이번 목록만 계산해 돌려준다 (F-409 3.3)
  if (generation !== startGeneration) {
    for (const doc of docs) {
      if (doc.e2ee === 'locked') {
        lockedCount++
        continue
      }
      const entry = makeIndexEntry(doc, folderPaths)
      entries.push(entry)
      rebuiltCount++
      if (entry.frontmatterUnreadable) frontmatterUnreadableCount++
      if (entry.shared) sharedCount++
    }
    return { scope, entries, frontmatterUnreadableCount, sharedCount, rebuiltCount, reusedCount, lockedCount }
  }

  const seenIds = new Set<string>()

  for (const doc of docs) {
    // 잠긴 금고 문서는 항목을 안 만든다 — seenIds 에서도 빠져 지우기 단계가 캐시의 평문을 스스로 지운다 (F-409 3.1)
    if (doc.e2ee === 'locked') {
      lockedCount++
      continue
    }
    seenIds.add(doc.id)
    const key = changeKey(doc)
    const hit = cache.get(doc.id)
    const shared = doc.role === 'edit' || doc.role === 'view'
    const folderPath = doc.folderId ? (folderPaths.get(doc.folderId) ?? '') : ''

    // 비싼 부분(title·body·properties·frontmatterUnreadable)만 재사용하고, 싼 부분(folderId·folderPath·updatedAt·shared)은 매번 새 list() 결과로 덮는다. 기존 객체는 고치지 않고 사본을 만든다 (5.3)
    let cached: CachedEntry
    if (hit && hit.__key === key) {
      cached = { ...hit, folderId: doc.folderId, folderPath, updatedAt: doc.updatedAt, shared, __key: key }
      reusedCount++
    } else {
      cached = { ...makeIndexEntry(doc, folderPaths), __key: key }
      rebuiltCount++
    }

    cache.set(doc.id, cached)
    const entry = toPublicEntry(cached)
    entries.push(entry)
    if (entry.frontmatterUnreadable) frontmatterUnreadableCount++
    if (entry.shared) sharedCount++
  }

  // list() 에 없는 id 를 지운다. 끝에 둬서 중간에 실패해도 인덱스가 반쯤 지워지지 않는다 (5.2)
  for (const id of [...cache.keys()]) {
    if (!seenIds.has(id)) cache.delete(id)
  }

  cachedScope = scope
  cachedStore = store

  return { scope, entries, frontmatterUnreadableCount, sharedCount, rebuiltCount, reusedCount, lockedCount }
}

// 모듈 수준 캐시를 비운다. 테스트가 매번 부른다 (5.4). 세대를 올려, 이미 기다리던 buildSearchIndex 가 이 리셋 뒤 평문을 캐시에 다시 쓰지 못하게 한다 (F-409 3.3)
export function resetSearchIndexCache(): void {
  cache = new Map()
  cachedScope = null
  cachedStore = null
  generation++
}

// 캐시에 든 항목 수. 테스트·계측용 (5.4)
export function searchIndexCacheSize(): number {
  return cache.size
}
