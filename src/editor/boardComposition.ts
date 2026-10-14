// 칸반 보드 입력칸의 IME 조합을 원격 게이트에 알리는 판 — 주 view 하나에 보드 하나 (F-2141 2장)
import type { EditorView } from '@codemirror/view'

type Entry = { root: HTMLElement | null; composing: boolean; ends: Set<() => void> }

const entries = new WeakMap<EditorView, Entry>()

function entryFor(view: EditorView): Entry {
  let entry = entries.get(view)
  if (!entry) {
    entry = { root: null, composing: false, ends: new Set() }
    entries.set(view, entry)
  }
  return entry
}

export function setBoardComposing(view: EditorView, root: HTMLElement | null, composing: boolean): void {
  const entry = entryFor(view)
  const ended = entry.composing && !composing
  entry.root = root
  entry.composing = composing
  if (ended) [...entry.ends].forEach((fn) => fn())
}

export function isBoardCompositionStarted(view: EditorView | null | undefined): boolean {
  return !!view && entries.get(view)?.composing === true
}

// 보드 안에 포커스가 있고 창이 보이는 채 앞에 있으면 살아 있는 조합이다 (F-303 5.4 와 같은 규칙)
export function boardCompositionAlive(view: EditorView): boolean {
  const root = entries.get(view)?.root
  return !!root && root.contains(document.activeElement) && document.hasFocus() && document.visibilityState === 'visible'
}

export function onBoardCompositionEnd(view: EditorView, fn: () => void): () => void {
  const entry = entryFor(view)
  entry.ends.add(fn)
  return () => {
    entry.ends.delete(fn)
  }
}
