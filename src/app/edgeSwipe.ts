// 터치 밀기 판정 순수 함수 (specs/features/F-227.md 2.2·2.3)

export const SWIPE_THRESHOLD_PX = 56
export const SWIPE_DIRECTION_RATIO = 1.5
// 편집기 안에서 시작한 밀기 — CM6 의 터치 커서 끌기와 겹쳐 커서만 옮기려다 패널이 열렸다 (tweak 2026-09-30)
export const SWIPE_EDITOR_THRESHOLD_PX = 96
export const SWIPE_EDITOR_DIRECTION_RATIO = 2.5

function limitsFor(startedInEditor: boolean | undefined): { px: number; ratio: number } {
  return startedInEditor
    ? { px: SWIPE_EDITOR_THRESHOLD_PX, ratio: SWIPE_EDITOR_DIRECTION_RATIO }
    : { px: SWIPE_THRESHOLD_PX, ratio: SWIPE_DIRECTION_RATIO }
}

export type SwipeInput = {
  startX: number
  startY: number
  endX: number
  endY: number
  sidebarOpen: boolean
  startedInSidebar: boolean
  startedInScrollableLeft: boolean
  startedInEditor?: boolean
}

export type SwipeResult = 'open' | 'close' | null

export function classifySwipe(input: SwipeInput): SwipeResult {
  const { startX, startY, endX, endY, sidebarOpen, startedInSidebar, startedInScrollableLeft } = input
  const dx = endX - startX
  const dy = endY - startY
  // 닫기는 사이드바 위에서 시작하므로 편집기 임계값이 걸리지 않는다
  const { px, ratio } = limitsFor(!sidebarOpen && input.startedInEditor)
  const isHorizontalEnough = Math.abs(dx) >= ratio * Math.abs(dy)

  if (sidebarOpen) {
    if (!startedInSidebar) return null
    if (dx <= -px && isHorizontalEnough) return 'close'
    return null
  }

  if (startedInScrollableLeft) return null
  if (dx >= px && isHorizontalEnough) return 'open'
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
  startedInEditor?: boolean
}

// 휴대폰 폭 목차 오른쪽 패널 밀기 판정 — classifySwipe 의 거울 (F-2089 3.2)
export function classifyOutlineSwipe(input: OutlineSwipeInput): SwipeResult {
  const { startX, startY, endX, endY, panelOpen, startedInPanel, startedInScrollableRight } = input
  const dx = endX - startX
  const dy = endY - startY
  const { px, ratio } = limitsFor(!panelOpen && input.startedInEditor)
  const isHorizontalEnough = Math.abs(dx) >= ratio * Math.abs(dy)

  if (panelOpen) {
    if (!startedInPanel) return null
    return dx >= px && isHorizontalEnough ? 'close' : null
  }

  if (startedInScrollableRight) return null
  return dx <= -px && isHorizontalEnough ? 'open' : null
}
