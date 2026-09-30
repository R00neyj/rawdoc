// app-shell 에 터치 이벤트를 달아 휴대폰 폭 목차 패널을 여닫는 훅 (F-2089 4장)
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { classifyOutlineSwipe } from './edgeSwipe'
import { hasOpenDialog, hasScrollableRightAncestor, isDraggingTextSelection } from './useEdgeSwipe'

type Args = {
  containerRef: RefObject<HTMLElement | null>
  enabled: boolean
  panelOpen: boolean
  onOpen: () => void
  onClose: () => void
}

type StartInfo = {
  x: number
  y: number
  startedInPanel: boolean
  startedInScrollableRight: boolean
}

export function useOutlineSwipe({ containerRef, enabled, panelOpen, onOpen, onClose }: Args) {
  const startRef = useRef<StartInfo | null>(null)
  const composingRef = useRef(false)

  useEffect(() => {
    const shell = containerRef.current?.closest<HTMLElement>('.app-shell')
    if (!shell || !enabled) return

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      const target = touch?.target as Element | null
      const ignore =
        e.touches.length !== 1 ||
        composingRef.current ||
        hasOpenDialog() ||
        document.querySelector('.sidebar-backdrop') != null ||
        target?.closest('.comment-sheet') != null ||
        isDraggingTextSelection(target)
      if (ignore || !touch) {
        startRef.current = null
        return
      }
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        startedInPanel: Boolean(target?.closest('.outline-panel, .outline-panel-backdrop')),
        startedInScrollableRight: hasScrollableRightAncestor(target),
      }
    }

    function handleTouchEnd(e: TouchEvent) {
      const start = startRef.current
      startRef.current = null
      const touch = e.changedTouches[0]
      if (!start || !touch || composingRef.current || hasOpenDialog()) return
      const result = classifyOutlineSwipe({
        startX: start.x,
        startY: start.y,
        endX: touch.clientX,
        endY: touch.clientY,
        panelOpen,
        startedInPanel: start.startedInPanel,
        startedInScrollableRight: start.startedInScrollableRight,
      })
      if (result === 'open') onOpen()
      else if (result === 'close') onClose()
    }

    function handleTouchCancel() {
      startRef.current = null
    }
    function handleCompositionStart() {
      composingRef.current = true
    }
    function handleCompositionEnd() {
      composingRef.current = false
    }

    shell.addEventListener('touchstart', handleTouchStart, { passive: true })
    shell.addEventListener('touchend', handleTouchEnd, { passive: true })
    shell.addEventListener('touchcancel', handleTouchCancel, { passive: true })
    document.addEventListener('compositionstart', handleCompositionStart)
    document.addEventListener('compositionend', handleCompositionEnd)
    return () => {
      shell.removeEventListener('touchstart', handleTouchStart)
      shell.removeEventListener('touchend', handleTouchEnd)
      shell.removeEventListener('touchcancel', handleTouchCancel)
      document.removeEventListener('compositionstart', handleCompositionStart)
      document.removeEventListener('compositionend', handleCompositionEnd)
    }
  }, [containerRef, enabled, panelOpen, onOpen, onClose])
}
