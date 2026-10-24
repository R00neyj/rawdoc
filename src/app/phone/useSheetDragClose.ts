// 하단 판 손잡이를 아래로 끌면 판이 따라 내려오고, 충분히 끌면 닫힌다 (small 2026-10-22)
import { useRef, type PointerEvent, type RefObject } from 'react'

const CLOSE_DISTANCE = 80

export function sheetDragShouldClose(dy: number, height: number): boolean {
  return dy >= Math.min(CLOSE_DISTANCE, height / 3)
}

export function useSheetDragClose(sheetRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const startRef = useRef<{ y: number; id: number } | null>(null)

  function reset(sheet: HTMLElement) {
    sheet.style.transform = ''
    sheet.style.transition = ''
  }

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return
      startRef.current = { y: e.clientY, id: e.pointerId }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const start = startRef.current
      const sheet = sheetRef.current
      if (!start || start.id !== e.pointerId || !sheet) return
      const dy = Math.max(0, e.clientY - start.y)
      sheet.style.transition = 'none'
      sheet.style.transform = `translateY(${dy}px)`
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const start = startRef.current
      const sheet = sheetRef.current
      startRef.current = null
      if (!start || start.id !== e.pointerId || !sheet) return
      const dy = Math.max(0, e.clientY - start.y)
      reset(sheet)
      if (sheetDragShouldClose(dy, sheet.offsetHeight)) onClose()
    },
    onPointerCancel() {
      startRef.current = null
      if (sheetRef.current) reset(sheetRef.current)
    },
  }
}
