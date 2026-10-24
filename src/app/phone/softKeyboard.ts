// 가상 키보드 열림 판정 — visualViewport 높이가 폭별 최대값보다 KEYBOARD_MIN_PX 이상 줄면 열림 (F-2091 3.1)
export const KEYBOARD_MIN_PX = 150
const SCALE_EPSILON = 0.01

export type KeyboardSample = { width: number; height: number; scale: number }
export type KeyboardTrack = { baselines: Readonly<Record<string, number>>; open: boolean }
export const INITIAL_KEYBOARD_TRACK: KeyboardTrack = { baselines: {}, open: false }

export function trackKeyboard(prev: KeyboardTrack, sample: KeyboardSample): KeyboardTrack {
  const { width, height, scale } = sample
  if (Math.abs(scale - 1) > SCALE_EPSILON || height <= 0 || width <= 0) return prev
  const key = String(Math.round(width))
  const baseline = Math.max(prev.baselines[key] ?? 0, height)
  const open = baseline - height >= KEYBOARD_MIN_PX
  if (baseline === prev.baselines[key] && open === prev.open) return prev
  return { baselines: { ...prev.baselines, [key]: baseline }, open }
}

export type KeyboardState = 'open' | 'closed' | 'unknown'

export function keyboardState(track: KeyboardTrack, env: { coarse: boolean; supported: boolean }): KeyboardState {
  if (!env.supported || !env.coarse) return 'unknown'
  return track.open ? 'open' : 'closed'
}

export function typingSurface(focused: boolean, keyboard: KeyboardState): boolean {
  return focused && keyboard !== 'closed'
}
