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
