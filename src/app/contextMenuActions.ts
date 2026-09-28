import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { ContextMenuNode } from './contextMenuItems'
import type { UseDocCommentsResult } from './useDocComments'

// 우클릭 메뉴 상태 (specs/features/F-170.md) — 'editor'|'cell' 은 view·mainView, 'view' 는 container 를 쓴다
export type ContextMenuState = {
  x: number
  y: number
  place: 'editor' | 'cell' | 'view'
  view: EditorView | null
  mainView: EditorView | null
  container: HTMLElement | null
  nodes: ContextMenuNode[]
}

// 금고·none 이면 항목이 없다(F-505 3.5) — write 가 아니면 비활성으로 둔다
export function contextMenuCommentOption(
  comments: Pick<UseDocCommentsResult, 'access' | 'canWrite'> | null | undefined,
  place: 'editor' | 'cell',
): { disabled: boolean } | undefined {
  return comments && comments.access.kind !== 'none' ? { disabled: !comments.canWrite || place === 'cell' } : undefined
}

// CM6 Ctrl+C 와 같은 글자 — 줄 구분 \n (F-170.md 4장)
export function contextMenuSelectionText(state: EditorState): string {
  return state.selection.ranges.map((r) => state.sliceDoc(r.from, r.to)).join('\n')
}

export function replaceSelectionChanges(state: EditorState, insert: string): { from: number; to: number; insert: string }[] {
  return state.selection.ranges.map((r) => ({ from: r.from, to: r.to, insert }))
}

export type ClipboardPastePick =
  | { kind: 'text'; index: number }
  | { kind: 'image'; index: number; type: string; fileName: string }
  | null

// 글자 항목이 먼저, 이미지는 주 에디터에서만 (F-170.md 4장)
export function pickClipboardPaste(itemTypes: readonly (readonly string[])[], place: ContextMenuState['place']): ClipboardPastePick {
  const textIndex = itemTypes.findIndex((types) => types.includes('text/plain'))
  if (textIndex >= 0) return { kind: 'text', index: textIndex }
  if (place !== 'editor') return null
  for (let index = 0; index < itemTypes.length; index++) {
    const type = itemTypes[index].find((t) => t.startsWith('image/'))
    if (type) return { kind: 'image', index, type, fileName: `pasted.${type.split('/')[1] ?? 'png'}` }
  }
  return null
}

// 편집 모드에서 표 삽입 뒤에는 새 표의 머리 첫 칸 편집을 시작한다 (F-170.md 3.1 A6)
export function entersTableAfterCommand(input: { isInsertTable: boolean; place: ContextMenuState['place']; dataView: string | undefined }): boolean {
  return input.isInsertTable && input.place === 'editor' && input.dataView === 'live'
}
