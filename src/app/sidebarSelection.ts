// 사이드바 여러 항목 선택 — 순수 함수, 화면 없음 (specs/features/F-255.md 3.1)
import type { DocLike, FolderLike, TreeNode } from '../lib/folderTree'

export type SelectionKind = 'doc' | 'folder'
export type SelectionItem = { kind: SelectionKind; id: string }
export type Selection = { ids: string[]; anchorId: string | null }

export const EMPTY_SELECTION: Selection = { ids: [], anchorId: null }

// Ctrl/Cmd+클릭 — 이미 있으면 빼고 없으면 더한다. anchor 는 방금 누른 것
export function toggle(sel: Selection, item: SelectionItem): Selection {
  const has = sel.ids.includes(item.id)
  return {
    ids: has ? sel.ids.filter((id) => id !== item.id) : [...sel.ids, item.id],
    anchorId: item.id,
  }
}

// Shift+클릭 — anchor 부터 item 까지 화면에 보이는 순서로 채운다. anchor 가 없으면 단독 선택
export function extend(sel: Selection, item: SelectionItem, visibleItems: SelectionItem[]): Selection {
  if (!sel.anchorId) return replace(sel, item)
  const anchorIndex = visibleItems.findIndex((v) => v.id === sel.anchorId)
  const itemIndex = visibleItems.findIndex((v) => v.id === item.id)
  if (anchorIndex === -1 || itemIndex === -1) return replace(sel, item)
  const [start, end] = anchorIndex <= itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex]
  return { ids: visibleItems.slice(start, end + 1).map((v) => v.id), anchorId: sel.anchorId }
}

// 일반 클릭 — 그 항목 하나만 선택
export function replace(sel: Selection, item: SelectionItem): Selection {
  void sel
  return { ids: [item.id], anchorId: item.id }
}

export function clear(sel: Selection): Selection {
  void sel
  return { ids: [], anchorId: null }
}

// 목록에서 사라진(삭제·이동 후) id 는 선택에서 뺀다
export function prune(sel: Selection, visibleIds: string[]): Selection {
  const visible = new Set(visibleIds)
  const ids = sel.ids.filter((id) => visible.has(id))
  const anchorId = sel.anchorId && visible.has(sel.anchorId) ? sel.anchorId : null
  return { ids, anchorId }
}

// 화면에 보이는 순서 — 고정됨 묶음 다음 트리 순, 접힌 폴더 안은 뺀다
export function visibleOrder({
  pinnedIds,
  tree,
  openFolderIds,
}: {
  pinnedIds: string[]
  tree: TreeNode[]
  openFolderIds: string[]
}): SelectionItem[] {
  const out: SelectionItem[] = pinnedIds.map((id) => ({ kind: 'doc', id }))

  function walk(nodes: TreeNode[]) {
    for (const node of nodes) {
      if (node.type === 'folder') {
        out.push({ kind: 'folder', id: node.id })
        if (openFolderIds.includes(node.id)) walk(node.children)
      } else {
        out.push({ kind: 'doc', id: node.id })
      }
    }
  }
  walk(tree)
  return out
}

// 선택한 것들의 공통 부모(문서는 folderId, 폴더는 parentId). 섞여 있으면 최상위(null)로 본다
export function commonParentId(items: SelectionItem[], docs: DocLike[], folders: FolderLike[]): string | null {
  if (items.length === 0) return null
  const parents = items.map((item) => {
    if (item.kind === 'doc') return docs.find((d) => d.id === item.id)?.folderId ?? null
    return folders.find((f) => f.id === item.id)?.parentId ?? null
  })
  const [first, ...rest] = parents
  return rest.every((p) => p === first) ? first : null
}

// 선택 안에 부모 폴더와 그 자식이 같이 있으면 부모만 남긴다 — 폴더가 옮겨가면 자식은 따라가므로 같은 이동을 두 번 하지 않는다
export function dedupeDescendants(items: SelectionItem[], docs: DocLike[], folders: FolderLike[]): SelectionItem[] {
  const selectedFolderIds = new Set(items.filter((i) => i.kind === 'folder').map((i) => i.id))
  const folderById = new Map(folders.map((f) => [f.id, f]))

  function parentOf(item: SelectionItem): string | null {
    if (item.kind === 'doc') return docs.find((d) => d.id === item.id)?.folderId ?? null
    return folderById.get(item.id)?.parentId ?? null
  }

  function hasSelectedAncestor(parentId: string | null): boolean {
    let current = parentId
    while (current) {
      if (selectedFolderIds.has(current)) return true
      current = folderById.get(current)?.parentId ?? null
    }
    return false
  }

  return items.filter((item) => !hasSelectedAncestor(parentOf(item)))
}
