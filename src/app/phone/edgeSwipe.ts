// 터치 밀기 판정 순수 함수 (specs/features/F-227.md 2.2·2.3)

export const SWIPE_THRESHOLD_PX = 56
export const SWIPE_DIRECTION_RATIO = 1.5

export type SwipeInput = {
  startX: number
  startY: number
  endX: number
  endY: number
  sidebarOpen: boolean
  startedInSidebar: boolean
  startedInScrollableLeft: boolean
}

export type SwipeResult = 'open' | 'close' | null

export function classifySwipe(input: SwipeInput): SwipeResult {
  const { startX, startY, endX, endY, sidebarOpen, startedInSidebar, startedInScrollableLeft } = input
  const dx = endX - startX
  const dy = endY - startY
  const isHorizontalEnough = Math.abs(dx) >= SWIPE_DIRECTION_RATIO * Math.abs(dy)

  if (sidebarOpen) {
    if (!startedInSidebar) return null
    if (dx <= -SWIPE_THRESHOLD_PX && isHorizontalEnough) return 'close'
    return null
  }

  if (startedInScrollableLeft) return null
  if (dx >= SWIPE_THRESHOLD_PX && isHorizontalEnough) return 'open'
  return null
}

export type OutlineSwipeInput = {
  startX: number
  startY: number
  endX: number
  endY: number
  panelOpen: boolean
  startedInPanel: boolean
  startedInScrollableRight: boolean
}

// 휴대폰 폭 목차 오른쪽 패널 밀기 판정 — classifySwipe 의 거울 (F-2089 3.2)
export function classifyOutlineSwipe(input: OutlineSwipeInput): SwipeResult {
  const { startX, startY, endX, endY, panelOpen, startedInPanel, startedInScrollableRight } = input
  const dx = endX - startX
  const dy = endY - startY
  const isHorizontalEnough = Math.abs(dx) >= SWIPE_DIRECTION_RATIO * Math.abs(dy)

  if (panelOpen) {
    if (!startedInPanel) return null
    return dx >= SWIPE_THRESHOLD_PX && isHorizontalEnough ? 'close' : null
  }

  if (startedInScrollableRight) return null
  return dx <= -SWIPE_THRESHOLD_PX && isHorizontalEnough ? 'open' : null
}

export const DRAG_AXIS_SLOP_PX = 8

// 끌기 방향이 정해졌는가 — 편집기 안 가로 끌기의 기본 동작(커서 옮기기)만 막는 데 쓴다 (tweak 2026-09-30)
export function dragAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < DRAG_AXIS_SLOP_PX) return null
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}
