// 지도 필터 — 무엇을 보이게 두고 무엇을 배경으로 가라앉히나. DOM 도 three 도 import 하지 않는 순수 모듈이다 (specs/features/F-2007.md 3장)
import { matchDoc, parseSearchQuery, type ParsedQuery, type SearchDocInput } from './docSearch'

// 걸러진 것을 --panel 쪽으로 섞는 비율. F-292 결정 14 가 정한 값이고 F-2010 의 MAP_HOVER_DIM 과 같다 (9장)
export const MAP_FILTER_DIM = 0.85

// `현재 문서에서 몇 다리` 의 최댓값. 0 은 `없음` 이다 (7.5)
export const MAP_HOPS_MAX = 3

// 폴더 밖 문서를 가리키는 자리표. 실제 폴더 id 는 절대 빈 문자열이 아니다 (3.3)
export const MAP_FILTER_ROOT = ''

export type MapFilter = {
  folders: string[] // 고른 폴더 id. 빈 배열 = 전체
  isolated: boolean // 고립 문서 보임
  broken: boolean // 끊긴 링크 보임
  hops: number // 0~3 정수. 0 = 없음
}

export const MAP_FILTER_DEFAULT: Readonly<MapFilter> = Object.freeze({
  folders: [],
  isolated: true,
  broken: true,
  hops: 0,
})

// src/types 의 Folder 와 구조가 같다. src/lib 은 src/app·src/types 를 가져오지 않는다 (docSearch.ts 와 같은 규칙)
export type MapFilterFolder = { id: string; parentId: string | null }
export type MapFilterDoc = SearchDocInput & { folderId: string | null }
export type MapFilterNode = { id: string; missing: boolean; degree: number }

export type MapFilterContext = {
  nodes: readonly MapFilterNode[]
  docById: ReadonlyMap<string, MapFilterDoc> // 끊긴 링크 노드는 여기 없다
  distances: Int32Array | null // 중심이 없으면 null (4장)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeMapFilter(raw: unknown): MapFilter {
  const source = isPlainObject(raw) ? raw : null

  const foldersRaw = source ? source.folders : undefined
  const folders = Array.isArray(foldersRaw)
    ? Array.from(new Set(foldersRaw.filter((f): f is string => typeof f === 'string')))
    : []

  const isolatedRaw = source ? source.isolated : undefined
  const isolated = typeof isolatedRaw === 'boolean' ? isolatedRaw : true

  const brokenRaw = source ? source.broken : undefined
  const broken = typeof brokenRaw === 'boolean' ? brokenRaw : true

  const hopsRaw = source ? source.hops : undefined
  const hops = typeof hopsRaw === 'number' && Number.isFinite(hopsRaw) ? Math.min(MAP_HOPS_MAX, Math.max(0, Math.round(hopsRaw))) : 0

  return { folders, isolated, broken, hops }
}

// 고른 폴더와 그 하위 폴더 전부. 고른 것이 없으면 null(= 전체) (3.3)
export function expandFolders(selected: readonly string[], folders: readonly MapFilterFolder[]): ReadonlySet<string> | null {
  if (selected.length === 0) return null

  const children = new Map<string, string[]>()
  for (const f of folders) {
    if (f.parentId === null) continue
    if (!children.has(f.parentId)) children.set(f.parentId, [])
    children.get(f.parentId)!.push(f.id)
  }

  const result = new Set<string>()
  for (const id of selected) {
    if (result.has(id)) continue
    result.add(id)
    if (id === MAP_FILTER_ROOT) continue
    const queue = [id]
    while (queue.length > 0) {
      const cur = queue.shift() as string
      for (const child of children.get(cur) ?? []) {
        if (result.has(child)) continue
        result.add(child)
        queue.push(child)
      }
    }
  }
  return result
}

export function isFilterActive(filter: MapFilter, query: ParsedQuery): boolean {
  return filter.folders.length > 0 || !filter.isolated || !filter.broken || filter.hops > 0 || !query.isEmpty
}

function withinHops(filter: MapFilter, ctx: MapFilterContext, i: number): boolean {
  if (filter.hops <= 0 || ctx.distances === null) return true
  const d = ctx.distances[i]
  return d >= 0 && d <= filter.hops
}

// 노드 하나마다 위에서 아래로 판정한다 (3.2)
function isNodeVisible(
  node: MapFilterNode,
  i: number,
  filter: MapFilter,
  query: ParsedQuery,
  allowedFolders: ReadonlySet<string> | null,
  folderActive: boolean,
  searchActive: boolean,
  ctx: MapFilterContext,
): boolean {
  if (node.missing) {
    if (!filter.broken) return false
    if (searchActive || folderActive) return false
    return withinHops(filter, ctx, i)
  }

  const doc = ctx.docById.get(node.id)
  if (!doc) return false // 지도 인덱스와 검색 인덱스가 어긋난 경우 — 조용히 빼지 않고 안 보이는 쪽으로 드러낸다 (3.2)
  if (!filter.isolated && node.degree === 0) return false
  if (folderActive) {
    const key = doc.folderId ?? MAP_FILTER_ROOT
    if (!(allowedFolders as ReadonlySet<string>).has(key)) return false
  }
  if (searchActive && matchDoc(doc, query) === null) return false
  return withinHops(filter, ctx, i)
}

// 팔레트 색 수. src/app/mapPrefs.ts 의 MAP_GROUP_MAX 와 같은 값이어야 한다 (F-2008 13.1 U12 가 지킨다)
export const MAP_GROUP_PALETTE = 8

// src/app/mapPrefs.ts 의 MapGroup 과 구조가 같다. src/lib 은 src/app 을 가져오지 않는다 (F-2008 2.2)
export type MapFilterGroup = { q: string; c: number }

// out[i] = 0 이면 그룹 없음, 1~8 이면 그 팔레트 번호. 돌려주는 값은 색이 칠해진 노드 수 (F-2008 4장)
export function computeGroupColors(
  groups: readonly MapFilterGroup[],
  ctx: MapFilterContext,
  out: Uint8Array,
): number {
  out.fill(0)
  if (groups.length === 0) return 0

  const parsed = groups.map((g) => ({
    query: parseSearchQuery(g.q),
    color: Number.isInteger(g.c) && g.c >= 1 && g.c <= MAP_GROUP_PALETTE ? g.c : 1,
  }))

  let painted = 0
  for (let i = 0; i < ctx.nodes.length; i++) {
    const node = ctx.nodes[i]
    if (node.missing) continue
    const doc = ctx.docById.get(node.id)
    if (!doc) continue
    for (const g of parsed) {
      if (g.query.isEmpty) continue
      if (matchDoc(doc, g.query) !== null) {
        out[i] = g.color
        painted++
        break
      }
    }
  }
  return painted
}

// out[i] = 1 이면 보임. 돌려주는 값은 보이는 노드 수
export function computeVisibleNodes(
  filter: MapFilter,
  query: ParsedQuery,
  allowedFolders: ReadonlySet<string> | null,
  ctx: MapFilterContext,
  out: Uint8Array,
): number {
  const folderActive = allowedFolders !== null
  const searchActive = !query.isEmpty
  let count = 0
  for (let i = 0; i < ctx.nodes.length; i++) {
    const visible = isNodeVisible(ctx.nodes[i], i, filter, query, allowedFolders, folderActive, searchActive, ctx)
    out[i] = visible ? 1 : 0
    if (visible) count++
  }
  return count
}
