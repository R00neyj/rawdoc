// 지금 끌고 있는 탭 — 창에 하나라 칸마다 있는 탭 줄과 칸 영역이 같은 값을 본다 (F-2165 3장)
import { useSyncExternalStore } from 'react'

export type TabDrag = { pane: string; key: string }

let drag: TabDrag | null = null
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function currentTabDrag(): TabDrag | null {
  return drag
}

export function startTabDrag(next: TabDrag) {
  drag = next
  // 놓은 뒤 문서에서 빠진 탭 요소는 dragend 를 창까지 올리지 못해 놓기 처리도 endTabDrag 를 부른다
  window.addEventListener('dragend', endTabDrag, true)
  listeners.forEach((listener) => listener())
}

export function endTabDrag() {
  window.removeEventListener('dragend', endTabDrag, true)
  if (drag === null) return
  drag = null
  listeners.forEach((listener) => listener())
}

export function useTabDrag(): TabDrag | null {
  return useSyncExternalStore(subscribe, currentTabDrag, currentTabDrag)
}
