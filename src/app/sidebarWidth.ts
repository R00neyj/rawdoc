// 사이드바 너비 범위 계산·저장값 해석 (순수 함수, specs/features/F-159.md 2.5)
export const MIN_SIDEBAR_WIDTH = 200
export const MAX_SIDEBAR_WIDTH_CAP = 480
export const MAX_SIDEBAR_WIDTH_MARGIN = 560
export const DEFAULT_SIDEBAR_WIDTH = 224
export const ARROW_KEY_STEP = 16
export const NARROW_OVERLAY_MARGIN = 48

// 최대 너비 = min(480, 창 폭 - 560) (F-159 2.5)
export function maxSidebarWidth(windowWidth: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH_CAP, windowWidth - MAX_SIDEBAR_WIDTH_MARGIN)
}

// 끌기·키보드로 정할 수 있는 값의 범위로 자른다
export function clampSidebarWidth(width: number, windowWidth: number): number {
  const max = maxSidebarWidth(windowWidth)
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), Math.max(max, MIN_SIDEBAR_WIDTH))
}

// localStorage 저장값 해석: 숫자가 아니거나 절대 범위(200~480) 밖이면 기본값으로 고친다
export function resolveStoredSidebarWidth(stored: string | null | undefined): number {
  if (stored === null || stored === undefined || stored === '') return DEFAULT_SIDEBAR_WIDTH
  const n = Number(stored)
  if (!Number.isInteger(n) || n < MIN_SIDEBAR_WIDTH || n > MAX_SIDEBAR_WIDTH_CAP) {
    return DEFAULT_SIDEBAR_WIDTH
  }
  return n
}

// 좁은 창에 겹쳐 열린 사이드바 폭 = 저장된 너비, 단 창 폭 - 48px 이하 (F-159 2.4)
export function overlaySidebarWidth(width: number, windowWidth: number): number {
  return Math.min(width, windowWidth - NARROW_OVERLAY_MARGIN)
}
