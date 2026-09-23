// 사이드바 여러 항목 선택 — 순수 함수, 화면 없음 (specs/features/F-255.md 3.1)
import type { DocLike, FolderLike, TreeNode } from '../lib/folderTree'

export type SelectionKind = 'doc' | 'folder'
export type SelectionItem = { kind: SelectionKind; id: string }
// 화면의 한 줄. 고정된 문서는 `고정됨` 묶음과 트리 제자리에 두 줄로 나오므로(F-132)
// id 만으로는 어느 줄을 눌렀는지 가릴 수 없다. key 가 줄을 가린다 (2026-09-22)
export type SelectionRow = SelectionItem & { key: string }
export type RowPlace = 'pinned' | 'tree'
export type Selection = { ids: string[]; anchor: SelectionRow | null }

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null }

export function rowKey(place: RowPlace, id: string): string {
  return `${place}:${id}`
}

// Ctrl/Cmd+클릭 — 이미 있으면 빼고 없으면 더한다. anchor 는 방금 누른 줄
export function toggle(sel: Selection, row: SelectionRow): Selection {
  const has = sel.ids.includes(row.id)
  return {
    ids: has ? sel.ids.filter((id) => id !== row.id) : [...sel.ids, row.id],
    anchor: row,
  }
}

// Shift+클릭 — anchor 줄부터 누른 줄까지 화면에 보이는 순서로 채운다. anchor 가 없으면 단독 선택
export function extend(sel: Selection, row: SelectionRow, visibleRows: SelectionRow[]): Selection {
  const anchor = sel.anchor
  if (!anchor) return replace(sel, row)
  const anchorIndex = visibleRows.findIndex((v) => v.key === anchor.key)
  const rowIndex = visibleRows.findIndex((v) => v.key === row.key)
  if (anchorIndex === -1 || rowIndex === -1) return replace(sel, row)
  const [start, end] = anchorIndex <= rowIndex ? [anchorIndex, rowIndex] : [rowIndex, anchorIndex]
  // 같은 문서의 두 줄이 한 범위에 같이 들어올 수 있어 id 는 한 번만 담는다
  const ids = [...new Set(visibleRows.slice(start, end + 1).map((v) => v.id))]
  return { ids, anchor }
}

// 일반 클릭 — 그 항목 하나만 선택
export function replace(sel: Selection, row: SelectionRow): Selection {
  void sel
  return { ids: [row.id], anchor: row }
}

export function clear(sel: Selection): Selection {
  void sel
  return { ids: [], anchor: null }
}

// 목록에서 사라진(삭제·이동 후) id 는 선택에서 뺀다
export function prune(sel: Selection, visibleIds: string[]): Selection {
  const visible = new Set(visibleIds)
  const ids = sel.ids.filter((id) => visible.has(id))
  const anchor = sel.anchor && visible.has(sel.anchor.id) ? sel.anchor : null
  return { ids, anchor }
}

// 화면에 보이는 줄 순서 — 고정됨 묶음 다음 트리 순, 접힌 폴더 안은 뺀다.
// 고정된 문서는 트리 제자리에도 그대로 보이므로(F-132) 줄이 둘 다 들어간다
export function visibleOrder({
  pinnedIds,
  tree,
  openFolderIds,
}: {
  pinnedIds: string[]
  tree: TreeNode[]
  openFolderIds: string[]
}): SelectionRow[] {
  const out: SelectionRow[] = pinnedIds.map((id) => ({ kind: 'doc', id, key: rowKey('pinned', id) }))

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.type === 'folder') {
        out.push({ kind: 'folder', id: node.id, key: rowKey('tree', node.id) })
        if (openFolderIds.includes(node.id)) walk(node.children)
      } else {
        out.push({ kind: 'doc', id: node.id, key: rowKey('tree', node.id) })
      }
    }
  }
  walk(tree)
  return out
}

// 선택한 것들의 공통 부모(문서는 folderId, 폴더는 parentId). 섞여 있으면 최상위(null)로 본다
export function commonParentId(items: SelectionItem[], docs: DocLike[], folders: FolderLike[]): string | null {
  if (items.length === 0) return null
  const parents = items.map((item) => parentIdOf(item, docs, folders))
  const [first, ...rest] = parents
  return rest.every((p) => p === first) ? first : null
}

// 전부 이미 최상위인가 — 참이면 `최상위로 옮기기` 는 아무 일도 못 하므로 메뉴에서 뺀다 (2026-09-22 사용자 신고)
export function allAtRoot(items: SelectionItem[], docs: DocLike[], folders: FolderLike[]): boolean {
  return items.every((item) => parentIdOf(item, docs, folders) === null)
}

function parentIdOf(item: SelectionItem, docs: DocLike[], folders: FolderLike[]): string | null {
  if (item.kind === 'doc') return docs.find((d) => d.id === item.id)?.folderId ?? null
  return folders.find((f) => f.id === item.id)?.parentId ?? null
}

// 선택 안에 부모 폴더와 그 자식이 같이 있으면 부모만 남긴다 — 폴더가 옮겨가면 자식은 따라가므로 같은 이동을 두 번 하지 않는다
export function dedupeDescendants(items: SelectionItem[], docs: DocLike[], folders: FolderLike[]): SelectionItem[] {
  const selectedFolderIds = new Set(items.filter((i) => i.kind === 'folder').map((i) => i.id))
  const folderById = new Map(folders.map((f) => [f.id, f]))

  function hasSelectedAncestor(parentId: string | null): boolean {
    let current = parentId
    while (current) {
      if (selectedFolderIds.has(current)) return true
      current = folderById.get(current)?.parentId ?? null
    }
    return false
  }

  return items.filter((item) => !hasSelectedAncestor(parentIdOf(item, docs, folders)))
}
