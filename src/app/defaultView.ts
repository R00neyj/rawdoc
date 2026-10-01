// 설정 "기본 뷰" — 부팅 때 쓸 보기 모드 판정 (F-2112 2.1)
import type { ViewMode } from './ViewModeMenu'
import { getPref } from './prefs'

export type DefaultView = 'remember' | ViewMode

export const DEFAULT_VIEW_OPTIONS: readonly { value: DefaultView; label: string }[] = [
  { value: 'remember', label: '기억' },
  { value: 'live', label: '편집' },
  { value: 'raw', label: '원문' },
  { value: 'view', label: '보기' },
]

const MODES: readonly string[] = ['live', 'raw', 'view']

export function resolveDefaultView(stored: string): DefaultView {
  return stored === 'live' || stored === 'raw' || stored === 'view' ? stored : 'remember'
}

export function resolveInitialViewMode(defaultView: string, lastViewMode: string): ViewMode {
  const fixed = resolveDefaultView(defaultView)
  if (fixed !== 'remember') return fixed
  return MODES.includes(lastViewMode) ? (lastViewMode as ViewMode) : 'live'
}

export function readInitialViewMode(): ViewMode {
  return resolveInitialViewMode(getPref('md.defaultView', 'remember'), getPref('md.viewMode', 'live'))
}
