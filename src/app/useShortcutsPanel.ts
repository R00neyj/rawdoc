// 단축키 판 열림·커서 스크롤 — App.tsx 에서 옮김 (F-2078, F-2052)
import { useEffect, useRef, useState, type RefObject } from 'react'
import { EditorView } from '@codemirror/view'
import type { EditorHandle } from '../editor/Editor'

export type UseShortcutsPanelOptions = {
  editorRef: RefObject<EditorHandle | null>
  viewMode: string
  shortcutsButtonRef: RefObject<HTMLButtonElement | null>
}

export type UseShortcutsPanelResult = {
  shortcutsOpen: boolean
  openShortcuts: () => void
  closeShortcuts: () => void
  toggleShortcuts: () => void
}

export function useShortcutsPanel(options: UseShortcutsPanelOptions): UseShortcutsPanelResult {
  const { editorRef, viewMode, shortcutsButtonRef } = options
  // 단축키 판 열림 상태 — 새로고침하면 닫힌다, 저장하지 않는다 (specs/features/F-2052.md 4.3)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const pendingShortcutsScrollFixRef = useRef(false) // 판을 열기 직전 커서가 보였는지 (F-2052 5.5)

  // 열기 직전 본문 커서가 편집 영역에 보였으면 판이 자리를 잡은 뒤에도 보이게 한다(5.5) — 팔레트·`?`·단축키 세 진입점이 함께 쓴다(6.2)
  function openShortcuts() {
    if (shortcutsOpen) return // 팔레트는 열기만 한다 — 이미 열려 있으면 그대로(6.1)
    const view = editorRef.current?.view
    if (view && viewMode !== 'view') {
      const head = view.state.selection.main.head
      const coords = view.coordsAtPos(head)
      const scrollerRect = view.scrollDOM.getBoundingClientRect()
      pendingShortcutsScrollFixRef.current = Boolean(
        coords && coords.top >= scrollerRect.top && coords.bottom <= scrollerRect.bottom,
      )
    } else {
      pendingShortcutsScrollFixRef.current = false
    }
    setShortcutsOpen(true)
  }

  // 닫힐 때 포커스가 판 안에 있었던 모든 경우 `?` 버튼으로 되돌린다 — 사라진 요소에 남지 않게(5.3)
  function closeShortcuts() {
    const panel = document.getElementById('shortcut-panel')
    const hadFocusInside = panel !== null && panel.contains(document.activeElement)
    setShortcutsOpen(false)
    if (hadFocusInside) {
      requestAnimationFrame(() => shortcutsButtonRef.current?.focus())
    }
  }

  function toggleShortcuts() {
    if (shortcutsOpen) closeShortcuts()
    else openShortcuts()
  }

  // 판이 자리를 잡은 뒤(레이아웃 갱신) 커서 줄을 보이게 한다 — 판을 닫을 때는 하지 않는다(5.5)
  useEffect(() => {
    if (!shortcutsOpen || !pendingShortcutsScrollFixRef.current) return
    pendingShortcutsScrollFixRef.current = false
    const view = editorRef.current?.view
    if (!view) return
    requestAnimationFrame(() => {
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) })
    })
  }, [shortcutsOpen, editorRef])

  return { shortcutsOpen, openShortcuts, closeShortcuts, toggleShortcuts }
}
