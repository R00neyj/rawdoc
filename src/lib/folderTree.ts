// 폴더 트리 조립·이동 검사 — 순수 함수. 깊이 제한 없음, 순환이 저장돼도 끝난다 (specs/features/F-2017.md 3장)

export type FolderLike = { id: string; name: string; parentId: string | null }
export type DocLike = {
  id: string
  title: string
  updatedAt: number
  folderId: string | null
  pinnedAt?: number | null
}
export type FolderNode = {
  type: 'folder'
  id: string
  name: string
  parentId: string | null
  children: TreeNode[]
}
export type DocNode = {
  type: 'doc'
  id: string
  title: string
  updatedAt: number
  folderId: string | null
  pinnedAt: number | null
}
export type TreeNode = FolderNode | DocNode

const byName = (a: FolderLike, b: FolderLike) => a.name.localeCompare(b.name, 'ko')

// 저장된 parentId 를 따라 올라가다 자기 자신에게 돌아오는 폴더 id (자기 순환 포함)
function cyclicFolderIds(folderById: Map<string, FolderLike>): Set<string> {
  const done = new Set<string>()
  const cyclic = new Set<string>()
  for (const start of folderById.keys()) {
    if (done.has(start)) continue
    const path: string[] = []
    const onPath = new Set<string>()
    let current: string | null = start
    while (current !== null && folderById.has(current) && !done.has(current) && !onPath.has(current)) {
      path.push(current)
      onPath.add(current)
      current = folderById.get(current)!.parentId
    }
    if (current !== null && onPath.has(current)) {
      for (let i = path.indexOf(current); i < path.length; i++) cyclic.add(path[i])
    }
    for (const id of path) done.add(id)
  }
  return cyclic
}

// 화면 트리의 부모 판정 — 없는 부모·순환에 든 폴더는 최상위(null), 그 밖은 저장된 부모 (3.3)
function screenParentResolver(folders: FolderLike[]): (f: FolderLike) => string | null {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const cyclic = cyclicFolderIds(folderById)
  return (f) => (f.parentId !== null && folderById.has(f.parentId) && !cyclic.has(f.id) ? f.parentId : null)
}

function groupFoldersByScreenParent<T extends FolderLike>(folders: T[]): Map<string | null, T[]> {
  const screenParent = screenParentResolver(folders)
  const groups = new Map<string | null, T[]>()
  for (const f of folders) {
    const key = screenParent(f)
    const group = groups.get(key)
    if (group) group.push(f)
    else groups.set(key, [f])
  }
  for (const group of groups.values()) group.sort(byName)
  return groups
}

// 부모 없는(또는 끊긴·순환) 폴더와 문서는 최상위로. 같은 부모 안에서는 폴더 먼저(이름순), 그다음 문서(updatedAt 내림차순)
export function buildTree({ folders, docs }: { folders: FolderLike[]; docs: DocLike[] }): TreeNode[] {
  const folderIds = new Set(folders.map((f) => f.id))
  const foldersByParent = groupFoldersByScreenParent(folders)

  const docsByFolder = new Map<string | null, DocLike[]>()
  for (const d of docs) {
    const key = d.folderId && folderIds.has(d.folderId) ? d.folderId : null
    const group = docsByFolder.get(key)
    if (group) group.push(d)
    else docsByFolder.set(key, [d])
  }

  function childrenOf(parentId: string | null): TreeNode[] {
    const childFolders: FolderNode[] = (foldersByParent.get(parentId) ?? []).map((f) => ({
      type: 'folder',
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      children: childrenOf(f.id),
    }))

    const childDocs: DocNode[] = (docsByFolder.get(parentId) ?? [])
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({
        type: 'doc',
        id: d.id,
        title: d.title,
        updatedAt: d.updatedAt,
        folderId: d.folderId,
        pinnedAt: d.pinnedAt ?? null, // F-132: 없으면 null 로 본다
      }))

    return [...childFolders, ...childDocs]
  }

  return childrenOf(null)
}

// 폴더를 트리 순서(부모 다음 자식, 형제는 이름 ko 순)로 편다. 부모 판정은 buildTree 와 같다
export function flattenFolderTree<T extends FolderLike>(folders: T[]): Array<T & { depth: number }> {
  const foldersByParent = groupFoldersByScreenParent(folders)
  const result: Array<T & { depth: number }> = []
  function walk(parentId: string | null, depth: number) {
    for (const f of foldersByParent.get(parentId) ?? []) {
      result.push({ ...f, depth })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return result
}

// folderId 자신부터 저장된 부모 사슬을 가까운 것부터. 없는 폴더·이미 모은 id 를 만나면 멈춘다
export function folderAncestors(folders: FolderLike[], folderId: string | null): string[] {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const result: string[] = []
  const seen = new Set<string>()
  let current = folderId
  while (current !== null && folderById.has(current) && !seen.has(current)) {
    result.push(current)
    seen.add(current)
    current = folderById.get(current)!.parentId
  }
  return result
}

// parentId 아래에 새 폴더를 만들 수 있는가. 최상위(null)이거나 존재하는 폴더면 가능 (3.1)
export function canCreateFolder({
  folders,
  parentId,
}: {
  folders: FolderLike[]
  parentId: string | null | undefined
}): boolean {
  if (parentId === null || parentId === undefined) return true
  return folders.some((f) => f.id === parentId)
}

// 폴더 id 를 parentId 아래로 옮길 수 있는가. 자기 자신·자기 자손·없는 대상만 막는다 — 대상에서 위로 올라가며 본다 (3.2)
export function canMoveFolder({
  folders,
  id,
  parentId,
}: {
  folders: FolderLike[]
  id: string
  parentId: string | null | undefined
}): boolean {
  if (parentId === null || parentId === undefined) return true
  if (!folders.some((f) => f.id === parentId)) return false
  return !folderAncestors(folders, parentId).includes(id)
}

// 문서를 열 때 펼칠 폴더 id 목록(최상위 → 하위 순). 화면 부모로 올라간다. 폴더 밖이거나 가리키는 폴더가 없으면 빈 배열
export function ancestorsOfDoc({
  folders,
  doc,
}: {
  folders: FolderLike[]
  doc: DocLike | null | undefined
}): string[] {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const screenParent = screenParentResolver(folders)
  const result: string[] = []
  let current = doc?.folderId ?? null

  while (current !== null && folderById.has(current)) {
    result.unshift(current)
    current = screenParent(folderById.get(current)!)
  }

  return result
}

// pinnedAt 이 있는 문서를 고정한 순서(오름차순)로. 없거나 null 이면 제외한다 (specs/features/F-132.md 2장)
export function pinnedDocs<T extends DocLike>(docs: T[]): T[] {
  return docs.filter((d) => d.pinnedAt != null).sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0))
}

// id 자신(맨 앞)과 모든 하위 폴더 id. 없는 id 면 빈 배열. 부모별 묶음으로 내려가 폴더 수에 비례하고 순환에서도 끝난다 (F-242 3.1, F-2017 4.2)
export function descendantFolderIds(folders: FolderLike[], id: string): string[] {
  if (!folders.some((f) => f.id === id)) return []
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (!f.parentId) continue
    const children = childrenOf.get(f.parentId)
    if (children) children.push(f.id)
    else childrenOf.set(f.parentId, [f.id])
  }
  const result = new Set<string>([id])
  const queue = [id]
  for (let i = 0; i < queue.length; i++) {
    for (const child of childrenOf.get(queue[i]) ?? []) {
      if (result.has(child)) continue
      result.add(child)
      queue.push(child)
    }
  }
  return [...result]
}

// 새 문서를 넣을 대상 폴더를 정한다. 존재하는 폴더가 아니면 최상위(null)로 되돌려 저장소 reject 을 막는다 (specs/features/F-138.md 3.4)
export function resolveTargetFolderId({
  folders,
  folderId,
}: {
  folders: FolderLike[]
  folderId: string | null | undefined
}): string | null {
  if (!folderId) return null
  return folders.some((f) => f.id === folderId) ? folderId : null
}
