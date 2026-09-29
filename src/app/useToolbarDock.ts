// 휴대폰 폭 서식 바 — 앱 틀 맨 아래로 붙일지, 편집기 포커스 중인지 (F-2084 3.4·3.5)
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import { isComposing } from '../editor/composition'
import { DOCK_QUERY } from './viewportFit'
import { typingSurface } from './softKeyboard'
import { useSoftKeyboard } from './useSoftKeyboard'

const ROW_SELECTOR = '.editor-toolbar-row'

// view.hasFocus 는 document.hasFocus() 도 요구해 앱 전환 뒤 한 번 거짓이 된다 — contentDOM 과 직접 비교한다 (F-2084 3.4)
function isEditorFocus(active: Element | null, contentDOM: HTMLElement | undefined): boolean {
  if (!active) return false
  if (contentDOM && active === contentDOM) return true
  return active.closest(ROW_SELECTOR) !== null
}

export function useToolbarDock(editorRef: RefObject<EditorHandle | null>): { docked: boolean; dockVisible: boolean } {
  const [docked, setDocked] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(DOCK_QUERY).matches : false))
  const [editorFocused, setEditorFocused] = useState(false)
  const keyboard = useSoftKeyboard()

  useEffect(() => {
    const mql = window.matchMedia(DOCK_QUERY)
    function handleChange(e: MediaQueryListEvent) {
      setDocked(e.matches)
    }
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (!docked) return
    let timer: ReturnType<typeof setTimeout> | undefined
    function check() {
      setEditorFocused(isEditorFocus(document.activeElement, editorRef.current?.view.contentDOM))
    }
    // 새 편집기는 layout effect 에서 focus 한 뒤에야 editorRef 가 채워진다(Editor.tsx) — 다음 틱에 한 번 더 본다
    function handleFocusIn() {
      clearTimeout(timer)
      check()
      timer = setTimeout(check, 0)
    }
    // 포커스가 잠깐 빠졌다 곧바로 돌아오는 경우(조합 중 탭 뒤 view.focus()) 한 프레임 깜빡이지 않게 다음 틱에 판정
    function handleFocusOut() {
      clearTimeout(timer)
      timer = setTimeout(check, 0)
    }
    check()
    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('focusout', handleFocusOut, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('focusout', handleFocusOut, true)
    }
  }, [docked, editorRef])

  return { docked, dockVisible: typingSurface(editorFocused, keyboard) }
}

// docked 줄 mousedown — 포커스(가상 키보드)를 편집기에 남긴다. 한글 조합 중 버튼만 예외로 조합을 먼저 끝낸다 (F-2084 3.5)
export function keepEditorFocusOnToolbar(e: ReactMouseEvent, editorRef: RefObject<EditorHandle | null>): void {
  const onButton = (e.target as Element).closest('button') !== null
  if (onButton && isComposing(editorRef.current?.view)) return
  e.preventDefault()
}
