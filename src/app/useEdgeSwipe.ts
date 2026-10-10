// app-shell 에 터치 이벤트를 달아 F-227 화면 밀기로 좁은 창 겹침 사이드바를 여닫는 훅
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { classifySwipe, dragAxis } from './edgeSwipe'

type UseEdgeSwipeArgs = {
  shellRef: RefObject<HTMLElement | null>
  sidebarRef: RefObject<HTMLElement | null>
  enabled: boolean
  // 지도 보기처럼 가로 끌기를 화면이 쓰는 동안 열기만 막는다 (F-227 2.2)
  canOpen: boolean
  sidebarOpen: boolean
  onOpen: () => void
  onClose: () => void
}

type StartInfo = {
  x: number
  y: number
  startedInSidebar: boolean
  startedInScrollableLeft: boolean
  skip: boolean
  guardEditorDrag: boolean
  axis: 'x' | 'y' | null
}

export function hasOpenDialog(): boolean {
  return document.querySelector('dialog[open]') != null
}

// 시작 지점 조상 중 왼쪽으로 스크롤될 수 있는 요소가 있는가 (2.2 예외 — 표·코드 블록·가로 넘치는 이미지 등)
function hasScrollableLeftAncestor(start: Element | null): boolean {
  let node: Element | null = start
  while (node) {
    if (node.scrollWidth > node.clientWidth && node.scrollLeft > 0) return true
    node = node.parentElement
  }
  return false
}

// 시작 지점 조상 중 오른쪽으로 더 스크롤될 수 있는 요소가 있는가 (F-2089 4.2)
// overflow visible·hidden 은 손가락으로 못 민다 — 몇 px 넘친 .cm-content 가 편집기 전체 밀기를 막았다
export function hasScrollableRightAncestor(start: Element | null): boolean {
  let node: Element | null = start
  while (node) {
    if (node.scrollWidth - node.clientWidth - node.scrollLeft > 1 && /^(auto|scroll)$/.test(getComputedStyle(node).overflowX)) return true
    node = node.parentElement
  }
  return false
}

// 시작 지점 조상 중 가로로 넘치는 요소가 있는가 — 표·코드 블록의 가로 스크롤은 막지 않는다
function hasHorizontalScroller(start: Element | null): boolean {
  let node: Element | null = start
  while (node) {
    if (node.scrollWidth > node.clientWidth + 1 && getComputedStyle(node).overflowX !== 'visible') return true
    node = node.parentElement
  }
  return false
}

// 편집기 안에서 비어 있지 않은 선택을 끄는 중이면 열지 않는다 (2.2 예외)
export function isDraggingTextSelection(target: Element | null): boolean {
  if (!target?.closest?.('.cm-content, [contenteditable="true"]')) return false
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed)
}

export function useEdgeSwipe({ shellRef, sidebarRef, enabled, canOpen, sidebarOpen, onOpen, onClose }: UseEdgeSwipeArgs) {
  const startRef = useRef<StartInfo | null>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || !enabled) return

    function handleCompositionStart() {
      composingRef.current = true
    }
    function handleCompositionEnd() {
      composingRef.current = false
    }

    function handleTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1 || composingRef.current || hasOpenDialog() || document.querySelector(".outline-panel[data-state='open']")) {
        startRef.current = null
        return
      }
      const touch = e.touches[0]
      const target = touch.target as Element | null
      const startedInSidebar = Boolean(
        sidebarRef.current?.contains(target) || target?.closest('.sidebar-backdrop'),
      )
      const skip = isDraggingTextSelection(target)
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startedInSidebar,
        startedInScrollableLeft: hasScrollableLeftAncestor(target),
        skip,
        guardEditorDrag: !skip && Boolean(target?.closest?.('.cm-content')) && !hasHorizontalScroller(target),
        axis: null,
      }
    }

    // 옵시디언처럼 편집기 안 가로 끌기는 커서를 옮기지 않는다 — 밀기 판정은 touchend 가 그대로 한다 (tweak 2026-09-30)
    function handleTouchMove(e: TouchEvent) {
      const start = startRef.current
      const touch = e.touches[0]
      if (!start?.guardEditorDrag || !touch || e.touches.length !== 1) return
      start.axis ??= dragAxis(touch.clientX - start.x, touch.clientY - start.y)
      if (start.axis === 'x' && e.cancelable) e.preventDefault()
    }

    function handleTouchEnd(e: TouchEvent) {
      const start = startRef.current
      startRef.current = null
      if (!start || start.skip || composingRef.current || hasOpenDialog()) return
      const touch = e.changedTouches[0]
      if (!touch) return
      const result = classifySwipe({
        startX: start.x,
        startY: start.y,
        endX: touch.clientX,
        endY: touch.clientY,
        sidebarOpen,
        startedInSidebar: start.startedInSidebar,
        startedInScrollableLeft: start.startedInScrollableLeft,
      })
      if (result === 'open' && canOpen) onOpen()
      else if (result === 'close') onClose()
    }

    function handleTouchCancel() {
      startRef.current = null
    }

    shell.addEventListener('touchstart', handleTouchStart, { passive: true })
    shell.addEventListener('touchmove', handleTouchMove, { passive: false })
    shell.addEventListener('touchend', handleTouchEnd, { passive: true })
    shell.addEventListener('touchcancel', handleTouchCancel, { passive: true })
    document.addEventListener('compositionstart', handleCompositionStart)
    document.addEventListener('compositionend', handleCompositionEnd)
    return () => {
      shell.removeEventListener('touchstart', handleTouchStart)
      shell.removeEventListener('touchmove', handleTouchMove)
      shell.removeEventListener('touchend', handleTouchEnd)
      shell.removeEventListener('touchcancel', handleTouchCancel)
      document.removeEventListener('compositionstart', handleCompositionStart)
      document.removeEventListener('compositionend', handleCompositionEnd)
    }
  }, [shellRef, sidebarRef, enabled, canOpen, sidebarOpen, onOpen, onClose])
}
