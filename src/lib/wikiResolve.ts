// 위키링크 대상 → 문서 해석기. 순수 함수, DOM·CM6·markdown-it·React·저장소를 import 하지 않는다. worker 도 import 한다 (specs/features/F-2018.md 4장)
import { screenParentResolver } from './folderTree'

// e2ee: 금고 문서(잠김·열림 무관). 해석에는 쓰지 않는다 — 받은 그대로 docs 에 둔다 (F-409 4.1)
export type WikiDocRef = { id: string; title: string; folderId: string | null; e2ee?: true }
export type WikiFolderRef = { id: string; name: string; parentId: string | null }

export type WikiResolver = {
  resolve(target: string, sourceFolderId: string | null): WikiDocRef | null
  findLinkFolder(target: string, sourceFolderId: string | null): { folderId: string; title: string } | null
  folderNames(folderId: string | null): string[] | null
  readonly docs: readonly WikiDocRef[]
}

// 폴더 사슬 — 든 폴더부터 위로. names 는 비교용(앞뒤 공백 제거·소문자) (4.2)
type Chain = { ids: string[]; names: string[]; reachesTop: boolean }

// 후보별 가까운 폴더 표 — 키가 처음 물릴 때 만든다 (4.6)
type PickTables = {
  direct: Map<string | null, WikiDocRef>
  descendant: Map<string, WikiDocRef>
}

const TOP_CHAIN: Chain = { ids: [], names: [], reachesTop: true }

const fold = (s: string) => s.toLowerCase()

// '/' 로 나눈 조각. 맨 앞 '/' 는 떼고, 빈 조각이 있으면 null (4.3 의 2)
function splitPath(target: string): string[] | null {
  const parts = target.replace(/^\/+/, '').split('/').map((p) => p.trim())
  return parts.some((p) => p === '') ? null : parts
}

// 사슬 이름을 아래에서부터 읽어 folderPath 의 끝과 맞는가
function chainEndsWith(chain: Chain, foldedPath: string[]): boolean {
  if (chain.names.length < foldedPath.length) return false
  for (let i = 0; i < foldedPath.length; i++) {
    if (chain.names[i] !== foldedPath[foldedPath.length - 1 - i]) return false
  }
  return true
}

function pushToMap<K>(map: Map<K, WikiDocRef[]>, key: K, doc: WikiDocRef) {
  const list = map.get(key)
  if (list) list.push(doc)
  else map.set(key, [doc])
}

export function createWikiResolver(docs: readonly WikiDocRef[], folders: readonly WikiFolderRef[]): WikiResolver {
  const folderById = new Map<string, WikiFolderRef>()
  for (const f of folders) folderById.set(f.id, f)

  // 사이드바와 같은 화면 부모 규칙 하나를 쓴다 — 없는 부모·순환 폴더는 최상위 (F-2017 3.3)
  const screenParent = screenParentResolver(folders)

  const chainCache = new Map<string, Chain>()
  function chainOf(folderId: string | null): Chain {
    if (folderId === null) return TOP_CHAIN
    const hit = chainCache.get(folderId)
    if (hit) return hit
    let chain: Chain
    if (!folderById.has(folderId)) {
      chain = { ids: [folderId], names: [], reachesTop: false }
    } else {
      const ids: string[] = []
      const names: string[] = []
      const seen = new Set<string>()
      let cur: string | null = folderId
      while (cur !== null && !seen.has(cur)) {
        const f: WikiFolderRef = folderById.get(cur)!
        seen.add(cur)
        ids.push(cur)
        names.push(fold(f.name.trim()))
        cur = screenParent(f)
      }
      chain = { ids, names, reachesTop: true }
    }
    chainCache.set(folderId, chain)
    return chain
  }

  const exactByTitle = new Map<string, WikiDocRef[]>()
  const foldedByTitle = new Map<string, WikiDocRef[]>()
  for (const d of docs) {
    const title = d.title.trim()
    if (title === '') continue
    pushToMap(exactByTitle, title, d)
    pushToMap(foldedByTitle, fold(title), d)
  }

  const tablesCache = new WeakMap<readonly WikiDocRef[], PickTables>()
  function tablesFor(candidates: readonly WikiDocRef[]): PickTables {
    let tables = tablesCache.get(candidates)
    if (tables) return tables
    tables = { direct: new Map(), descendant: new Map() }
    for (const c of candidates) {
      if (!tables.direct.has(c.folderId)) tables.direct.set(c.folderId, c)
      for (const id of chainOf(c.folderId).ids) {
        if (!tables.descendant.has(id)) tables.descendant.set(id, c)
      }
    }
    tablesCache.set(candidates, tables)
    return tables
  }

  // 4.4 — 같은 폴더·조상(최상위가 마지막) → 공통 조상이 가장 깊은 후보 → 목록 앞
  function pickNearest(candidates: readonly WikiDocRef[], sourceFolderId: string | null): WikiDocRef {
    if (candidates.length === 1) return candidates[0]
    const { direct, descendant } = tablesFor(candidates)
    const source = chainOf(sourceFolderId)
    for (const id of source.ids) {
      const hit = direct.get(id)
      if (hit) return hit
    }
    if (source.reachesTop) {
      const hit = direct.get(null)
      if (hit) return hit
    }
    for (const id of source.ids) {
      const hit = descendant.get(id)
      if (hit) return hit
    }
    return candidates[0]
  }

  function pathCandidates(target: string): WikiDocRef[] | null {
    const parts = splitPath(target)
    if (!parts) return null
    const title = parts[parts.length - 1]
    const foldedPath = parts.slice(0, -1).map(fold)
    const matching = (list: WikiDocRef[] | undefined) =>
      (list ?? []).filter((d) => chainEndsWith(chainOf(d.folderId), foldedPath))
    const exact = matching(exactByTitle.get(title))
    if (exact.length > 0) return exact
    const folded = matching(foldedByTitle.get(fold(title)))
    return folded.length > 0 ? folded : null
  }

  function findOnce(target: string): readonly WikiDocRef[] | null {
    const exact = exactByTitle.get(target)
    if (exact) return exact
    const folded = foldedByTitle.get(fold(target))
    if (folded) return folded
    return target.includes('/') ? pathCandidates(target) : null
  }

  const candidatesCache = new Map<string, readonly WikiDocRef[] | null>()
  function candidatesFor(target: string): readonly WikiDocRef[] | null {
    if (candidatesCache.has(target)) return candidatesCache.get(target)!
    let found = findOnce(target)
    if (!found && fold(target).endsWith('.md')) {
      const stripped = target.slice(0, -3).trim()
      if (stripped !== '') found = findOnce(stripped)
    }
    candidatesCache.set(target, found)
    return found
  }

  function resolve(target: string, sourceFolderId: string | null): WikiDocRef | null {
    const t = typeof target === 'string' ? target.trim() : ''
    if (t === '') return null
    const candidates = candidatesFor(t)
    return candidates ? pickNearest(candidates, sourceFolderId) : null
  }

  function findLinkFolder(target: string, sourceFolderId: string | null) {
    const parts = splitPath(typeof target === 'string' ? target.trim() : '')
    if (!parts || parts.length < 2) return null
    const title = parts[parts.length - 1]
    const foldedPath = parts.slice(0, -1).map(fold)
    const asDocs: WikiDocRef[] = []
    for (const f of folders) {
      if (chainEndsWith(chainOf(f.id), foldedPath)) asDocs.push({ id: f.id, title, folderId: f.id })
    }
    if (asDocs.length === 0) return null
    const picked = pickNearest(asDocs, sourceFolderId)
    return { folderId: picked.id, title }
  }

  function folderNames(folderId: string | null): string[] | null {
    if (folderId === null) return []
    if (!folderById.has(folderId)) return null
    return chainOf(folderId).ids.map((id) => folderById.get(id)!.name).reverse()
  }

  return { resolve, findLinkFolder, folderNames, docs }
}

// 4.8 — 제목 → 가까운 폴더/제목 → … 중 resolve 가 그 문서를 돌려주는 첫 형태, 없으면 제목
export function shortestWikiTarget(resolver: WikiResolver, doc: WikiDocRef, sourceFolderId: string | null): string {
  const title = doc.title.trim()
  if (resolver.resolve(title, sourceFolderId)?.id === doc.id) return title
  const names = resolver.folderNames(doc.folderId)
  if (names) {
    for (let k = 1; k <= names.length; k++) {
      const form = `${names.slice(names.length - k).join('/')}/${title}`
      if (resolver.resolve(form, sourceFolderId)?.id === doc.id) return form
    }
  }
  return title
}
