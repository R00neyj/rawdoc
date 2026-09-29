// 휴대폰 폭 하단 알약의 순수 판정 — 찾기 흐림·포커스 숨김·방문 기록 위치 (F-2086 3.1)
import type { TopBarScreen } from './topBarMore'
import type { ViewMode } from './ViewModeMenu'

export function phoneNavFindDisabled(input: { screen: TopBarScreen; viewMode: ViewMode; vaultLocked: boolean }): boolean {
  if (input.screen !== 'doc') return true
  if (input.vaultLocked) return true
  if (input.viewMode === 'view') return true
  return false
}

export type FocusInfo = {
  tag: string
  type: string | null
  editable: boolean
  readOnly: boolean
  inToolbarRow: boolean
  inModal: boolean
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'])

export function focusHidesPhoneNav(focus: FocusInfo | null): boolean {
  if (!focus) return false
  if (focus.inModal) return false
  if (focus.inToolbarRow) return true
  if (focus.editable) return true
  if (focus.readOnly) return false
  if (focus.tag === 'TEXTAREA') return true
  if (focus.tag === 'INPUT') return TEXT_INPUT_TYPES.has((focus.type ?? '').toLowerCase())
  return false
}

export type NavPos = { idx: number; max: number }

export function readNavIdx(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null
  if (!Object.prototype.hasOwnProperty.call(state, 'navIdx')) return null
  const v = (state as { navIdx: unknown }).navIdx
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null
}

export function parseNavMax(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

export function navAtStart(stateIdx: number | null, storedMax: number | null): NavPos {
  if (stateIdx === null) return { idx: 0, max: 0 }
  return { idx: stateIdx, max: Math.max(stateIdx, storedMax ?? stateIdx) }
}

export function navOnPush(pos: NavPos): NavPos {
  return { idx: pos.idx + 1, max: pos.idx + 1 }
}

export function navOnSettle(pos: NavPos, stateIdx: number | null): { pos: NavPos; stamp: number | null } {
  if (stateIdx !== null) return { pos: { idx: stateIdx, max: Math.max(pos.max, stateIdx) }, stamp: null }
  const idx = pos.idx + 1
  return { pos: { idx, max: idx }, stamp: idx }
}

export function navButtons(pos: NavPos): { canBack: boolean; canForward: boolean } {
  return { canBack: pos.idx > 0, canForward: pos.idx < pos.max }
}
