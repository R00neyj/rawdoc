// 폴더 트리 조립·깊이 검사 — 순수 함수. 폴더는 2단계까지만 허용한다(하위 폴더는 하위 폴더를 못 가짐) (specs/features/F-126.md 4장)

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

// 부모 없는(또는 끊긴) 폴더·문서는 최상위로. 같은 부모 안에서는 폴더 먼저(이름순), 그다음 문서(updatedAt 내림차순)
export function buildTree({ folders, docs }: { folders: FolderLike[]; docs: DocLike[] }): TreeNode[] {
  const folderIds = new Set(folders.map((f) => f.id))

  // 존재하지 않는 폴더를 가리키는 parentId·folderId 는 null(최상위)로 본다 (F-126.md 3장)
  const resolvedParentId = (parentId: string | null) => (parentId && folderIds.has(parentId) ? parentId : null)
  const resolvedFolderId = (folderId: string | null) => (folderId && folderIds.has(folderId) ? folderId : null)

  function childrenOf(parentId: string | null): TreeNode[] {
    const childFolders: FolderNode[] = folders
      .filter((f) => resolvedParentId(f.parentId) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((f) => ({
        type: 'folder',
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        children: childrenOf(f.id),
      }))

    const childDocs: DocNode[] = docs
      .filter((d) => resolvedFolderId(d.folderId) === parentId)
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

// parentId 아래에 새 폴더를 만들 수 있는가. 최상위(null)는 항상 가능. 대상이 없거나 하위 폴더면 불가
export function canCreateFolder({
  folders,
  parentId,
}: {
  folders: FolderLike[]
  parentId: string | null | undefined
}): boolean {
  if (parentId === null || parentId === undefined) return true
  const target = folders.find((f) => f.id === parentId)
  if (!target) return false
  return target.parentId === null
}

// 폴더 id 를 parentId 아래로 옮길 수 있는가. 자기 자신 밑·하위 폴더 안·자식 있는 폴더를 다른 폴더 안으로는 못 간다(2단계 초과)
export function canMoveFolder({
  folders,
  id,
  parentId,
}: {
  folders: FolderLike[]
  id: string
  parentId: string | null | undefined
}): boolean {
  if (parentId === id) return false
  if (parentId === null || parentId === undefined) return true

  const target = folders.find((f) => f.id === parentId)
  if (!target) return false
  if (target.parentId !== null) return false // 대상 자신이 하위 폴더면 불가 (2단계 초과)

  const hasChildren = folders.some((f) => f.parentId === id)
  if (hasChildren) return false // 하위 폴더를 가진 폴더는 다른 폴더 안으로 못 감

  return true
}

// 문서를 열 때 펼칠 폴더 id 목록(최상위 → 하위 순). 폴더 밖이거나 가리키는 폴더가 없으면 빈 배열
export function ancestorsOfDoc({
  folders,
  doc,
}: {
  folders: FolderLike[]
  doc: DocLike | null | undefined
}): string[] {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const result: string[] = []
  let current = doc?.folderId ?? null

  while (current && folderById.has(current)) {
    result.unshift(current)
    current = folderById.get(current)!.parentId
  }

  return result
}

// pinnedAt 이 있는 문서를 고정한 순서(오름차순)로. 없거나 null 이면 제외한다 (specs/features/F-132.md 2장)
export function pinnedDocs<T extends DocLike>(docs: T[]): T[] {
  return docs.filter((d) => d.pinnedAt != null).sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0))
}

// id 자신과 그 아래 모든 하위 폴더 id (형제·부모 미포함). id 가 없으면 빈 배열 (F-242.md 3.1)
export function descendantFolderIds(folders: FolderLike[], id: string): string[] {
  if (!folders.some((f) => f.id === id)) return []
  const result = new Set<string>([id])
  let added = true
  while (added) {
    added = false
    for (const f of folders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id)
        added = true
      }
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
