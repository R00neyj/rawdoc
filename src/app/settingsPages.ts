// 휴대폰 폭 설정 전체화면 1·2뎁스 — 순수 함수 (specs/features/F-2114.md 2.7)
import type { SettingsTabId } from './settingsTabs'

export type SettingsPage = 'list' | SettingsTabId

export type SettingsPopAction =
  | { kind: 'none' }
  | { kind: 'open'; page: SettingsPage }
  | { kind: 'show'; page: SettingsPage }
  | { kind: 'close' }
  | { kind: 'restore'; delta: number }

const TAB_IDS: readonly string[] = ['screen', 'editor', 'css', 'data', 'e2ee', 'account']

export function settingsPagesMode(phone: boolean, tabCount: number): boolean {
  return phone && tabCount >= 2
}

export function readSettingsPage(state: unknown, tabs: readonly SettingsTabId[]): SettingsPage | null {
  if (typeof state !== 'object' || state === null) return null
  const value = (state as { settings?: unknown }).settings
  if (value === 'list') return 'list'
  if (typeof value !== 'string' || !TAB_IDS.includes(value)) return null
  return tabs.includes(value as SettingsTabId) ? (value as SettingsTabId) : 'list'
}

export function settingsPageDepth(page: SettingsPage | null): 0 | 1 | 2 {
  if (page === null) return 0
  return page === 'list' ? 1 : 2
}

export function decideSettingsPop(input: {
  open: boolean
  page: SettingsPage | null
  shownIdx: number | null
  nextIdx: number | null
  nestedOpen: boolean
}): SettingsPopAction {
  const { open, page, shownIdx, nextIdx, nestedOpen } = input
  if (!open) return page ? { kind: 'open', page } : { kind: 'none' }
  if (nestedOpen && shownIdx !== null && nextIdx !== null && shownIdx !== nextIdx) return { kind: 'restore', delta: shownIdx - nextIdx }
  if (!page) return { kind: 'close' }
  return { kind: 'show', page }
}
