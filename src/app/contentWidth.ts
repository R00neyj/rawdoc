// 본문 최대 너비 범위 계산·저장값 해석 (순수 함수, import 없음 — F-2015 1장과 같은 이유, specs/features/F-2043.md 2.2)
export const MIN_CONTENT_WIDTH = 600
export const MAX_CONTENT_WIDTH = 1600
export const CONTENT_WIDTH_STEP = 20
export const DEFAULT_CONTENT_WIDTH = 800
export const CONTENT_WIDTH_VAR = '--content-width'

// 저장값 해석 — 정확한 값(정수·범위 안·20의 배수)만 받고 나머지는 기본값
export function resolveStoredContentWidth(stored: string | null | undefined): number {
  if (stored === null || stored === undefined || stored === '') return DEFAULT_CONTENT_WIDTH
  const n = Number(stored)
  if (
    !Number.isInteger(n) ||
    n < MIN_CONTENT_WIDTH ||
    n > MAX_CONTENT_WIDTH ||
    n % CONTENT_WIDTH_STEP !== 0
  ) {
    return DEFAULT_CONTENT_WIDTH
  }
  return n
}

// 숫자를 범위 안·20 단위로 맞춘다 (정확히 가운데면 올림)
export function normalizeContentWidth(n: number): number {
  const rounded = Math.round(n / CONTENT_WIDTH_STEP) * CONTENT_WIDTH_STEP
  return Math.min(MAX_CONTENT_WIDTH, Math.max(MIN_CONTENT_WIDTH, rounded))
}

// 숫자 입력 확정(blur·Enter) — 빈 값·숫자 아님·무한대는 null(되돌림), 나머지는 맞춘 값
export function parseContentWidthInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return null
  return normalizeContentWidth(n)
}

// 숫자 입력 치는 중 — 이미 정확한 값일 때만 그 수, 아니면 null(아직 반영하지 않음)
export function exactContentWidthInput(raw: string): number | null {
  const parsed = parseContentWidthInput(raw)
  if (parsed === null) return null
  return parsed === Number(raw.trim()) ? parsed : null
}
