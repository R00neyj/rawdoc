// 폴더 트리 조립·깊이 검사 — 순수 함수 (specs/features/F-126.md 4장)
// 폴더는 2단계까지만 허용한다: 최상위 폴더(parentId null) → 하위 폴더(parentId = 최상위 폴더 id).
// 하위 폴더는 하위 폴더를 가질 수 없다

/**
 * @typedef {{ id:string, name:string, parentId:string|null }} FolderLike
 * @typedef {{ id:string, title:string, updatedAt:number, folderId:string|null }} DocLike
 * @typedef {{ type:'folder', id:string, name:string, parentId:string|null, children:Node[] }
 *         | { type:'doc', id:string, title:string, updatedAt:number, folderId:string|null }} Node
 */

/**
 * @param {{ folders: FolderLike[], docs: DocLike[] }} args
 * @returns {Node[]} 부모가 없는(또는 부모 참조가 끊긴) 폴더·문서는 최상위로 올라온다.
 *   같은 부모 안에서는 폴더 먼저(이름 `localeCompare(..., 'ko')` 오름차순), 그다음 문서
 *   (`updatedAt` 내림차순)
 */
export function buildTree({ folders, docs }) {
  const folderIds = new Set(folders.map((f) => f.id))

  // 존재하지 않는 폴더를 가리키는 parentId·folderId 는 null(최상위)로 본다
  // (F-126.md 3장 — 지운 폴더를 가리키는 문서는 최상위에 보인다)
  const resolvedParentId = (parentId) => (parentId && folderIds.has(parentId) ? parentId : null)
  const resolvedFolderId = (folderId) => (folderId && folderIds.has(folderId) ? folderId : null)

  function childrenOf(parentId) {
    const childFolders = folders
      .filter((f) => resolvedParentId(f.parentId) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
      .map((f) => ({
        type: 'folder',
        id: f.id,
        name: f.name,
        parentId: f.parentId,
        children: childrenOf(f.id),
      }))

    const childDocs = docs
      .filter((d) => resolvedFolderId(d.folderId) === parentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({ type: 'doc', id: d.id, title: d.title, updatedAt: d.updatedAt, folderId: d.folderId }))

    return [...childFolders, ...childDocs]
  }

  return childrenOf(null)
}

/**
 * @param {{ folders: FolderLike[], parentId: string|null }} args
 * @returns {boolean} `parentId` 아래에 새 폴더를 만들 수 있는가. 최상위(null)는 항상 가능.
 *   `parentId` 가 가리키는 폴더가 없거나, 그 폴더 자신이 하위 폴더(parentId 가 있음)이면 불가
 */
export function canCreateFolder({ folders, parentId }) {
  if (parentId === null || parentId === undefined) return true
  const target = folders.find((f) => f.id === parentId)
  if (!target) return false
  return target.parentId === null
}

/**
 * @param {{ folders: FolderLike[], id: string, parentId: string|null }} args
 * @returns {boolean} 폴더 `id` 를 `parentId` 아래로 옮길 수 있는가.
 *   자기 자신 밑으로는 못 간다. 최상위(null)로는 항상(자기 자신이 아니면) 갈 수 있다.
 *   대상이 없거나 대상 자신이 하위 폴더면 불가. 옮기려는 폴더가 하위 폴더를 가지고
 *   있으면(즉 그 자신이 최상위 폴더고 자식이 있으면) 다른 폴더 안으로는 못 간다(2단계 초과)
 */
export function canMoveFolder({ folders, id, parentId }) {
  if (parentId === id) return false
  if (parentId === null || parentId === undefined) return true

  const target = folders.find((f) => f.id === parentId)
  if (!target) return false
  if (target.parentId !== null) return false // 대상 자신이 하위 폴더면 불가 (2단계 초과)

  const hasChildren = folders.some((f) => f.parentId === id)
  if (hasChildren) return false // 하위 폴더를 가진 폴더는 다른 폴더 안으로 못 감

  return true
}

/**
 * @param {{ folders: FolderLike[], doc: DocLike|null|undefined }} args
 * @returns {string[]} 문서를 열 때 펼칠 폴더 id 목록(최상위 → 하위 순). 문서가 폴더 밖이거나
 *   가리키는 폴더가 없으면 빈 배열
 */
export function ancestorsOfDoc({ folders, doc }) {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const result = []
  let current = doc?.folderId ?? null

  while (current && folderById.has(current)) {
    result.unshift(current)
    current = folderById.get(current).parentId
  }

  return result
}
