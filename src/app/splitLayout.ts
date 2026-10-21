// 화면 분할 배치 상태 기계·저장 — 순수 함수 (F-2162, F-2159 3·5장)
import { EMPTY_TABS, MAX_TABS, parseStoredTabs, parseTabsEntry, readMap, type DocTab, type DocTabsState } from './docTabs'
import type { ViewMode } from './ViewModeMenu'

export type SplitLayout = 'single' | 'cols' | 'rows' | 'grid' | 'three-left' | 'three-right' | 'three-top' | 'three-bottom'
export type PaneTabs = DocTabsState & { viewMode: ViewMode }
export type SplitState = { layout: SplitLayout; ratios: number[]; focus: number; panes: PaneTabs[] }
export type SplitDir = 'right' | 'down'

export const MAX_PANES = 4
export const RATIO_MIN = 0.2
export const RATIO_MAX = 0.8
export const MIN_PANE_PX = { width: 280, height: 160 }

const PANE_COUNT: Record<SplitLayout, number> = {
  single: 1, cols: 2, rows: 2, grid: 4, 'three-left': 3, 'three-right': 3, 'three-top': 3, 'three-bottom': 3,
}
const LAYOUTS = Object.keys(PANE_COUNT) as SplitLayout[]
const VIEW_MODES: readonly string[] = ['live', 'raw', 'view']

// 칸 번호(왼쪽 위 꼭짓점 순) → panes 자리
const NUMBER_ORDER: Record<SplitLayout, number[]> = {
  single: [0], cols: [0, 1], rows: [0, 1], grid: [0, 1, 2, 3],
  'three-left': [0, 1, 2], 'three-top': [0, 1, 2], 'three-right': [1, 0, 2], 'three-bottom': [1, 2, 0],
}

// 비율 자리의 축 — x 는 세로 경계(너비), y 는 가로 경계(높이)
const RATIO_AXES: Record<SplitLayout, Array<'x' | 'y'>> = {
  single: [], cols: ['x'], rows: ['y'], grid: ['x', 'y'],
  'three-left': ['x', 'y'], 'three-right': ['x', 'y'], 'three-top': ['y', 'x'], 'three-bottom': ['y', 'x'],
}

export function singleSplit(tabs: DocTabsState, viewMode: ViewMode): SplitState {
  return { layout: 'single', ratios: [], focus: 0, panes: [{ tabs: tabs.tabs, active: tabs.active, viewMode }] }
}

function made(layout: SplitLayout, panes: PaneTabs[], ratios: number[], focus: number): SplitState {
  return { layout, panes, ratios, focus }
}

export function splitPane(s: SplitState, pane: number, dir: SplitDir, tab: DocTab): SplitState | null {
  const at = s.panes[pane]
  if (!at) return null
  const n: PaneTabs = { tabs: [{ ...tab, pinned: true }], active: tab.key, viewMode: s.panes[s.focus].viewMode }
  const [a, b, c] = s.panes
  const [r0, r1] = s.ratios
  switch (s.layout) {
    case 'single':
      return made(dir === 'right' ? 'cols' : 'rows', [a, n], [0.5], 1)
    case 'cols':
      if (dir !== 'down') return null
      return pane === 0 ? made('three-right', [b, a, n], [r0, 0.5], 2) : made('three-left', [a, b, n], [r0, 0.5], 2)
    case 'rows':
      if (dir !== 'right') return null
      return pane === 0 ? made('three-bottom', [b, a, n], [r0, 0.5], 2) : made('three-top', [a, b, n], [r0, 0.5], 2)
    case 'three-left':
      return pane === 0 && dir === 'down' ? made('grid', [a, b, n, c], [r0, r1], 2) : null
    case 'three-right':
      return pane === 0 && dir === 'down' ? made('grid', [b, a, c, n], [r0, r1], 3) : null
    case 'three-top':
      return pane === 0 && dir === 'right' ? made('grid', [a, n, b, c], [r1, r0], 1) : null
    case 'three-bottom':
      return pane === 0 && dir === 'right' ? made('grid', [b, c, a, n], [r1, r0], 3) : null
    default:
      return null
  }
}

export function cycleSplit(s: SplitState, tab: DocTab): SplitState | null {
  const tries: Array<[number, SplitDir]> = [[s.focus, 'right'], [s.focus, 'down'], [0, 'right'], [0, 'down']]
  for (const [pane, dir] of tries) {
    const next = splitPane(s, pane, dir, tab)
    if (next) return next
  }
  return null
}

type CloseRule = { layout: SplitLayout; kept: number[]; ratios: number[]; grown: number }
const one = (kept: number, ratios: number[] = []) => ({ kept: [kept], ratios })

// 닫는 칸별 결과 — kept = 남는 칸의 옛 자리(새 순서), ratios = 옛 ratios 자리, grown = 늘어난 칸의 옛 자리
const CLOSE_RULES: Record<SplitLayout, CloseRule[]> = {
  single: [],
  cols: [{ layout: 'single', ...one(1), grown: 1 }, { layout: 'single', ...one(0), grown: 0 }],
  rows: [{ layout: 'single', ...one(1), grown: 1 }, { layout: 'single', ...one(0), grown: 0 }],
  'three-left': [
    { layout: 'rows', kept: [1, 2], ratios: [1], grown: 1 },
    { layout: 'cols', kept: [0, 2], ratios: [0], grown: 2 },
    { layout: 'cols', kept: [0, 1], ratios: [0], grown: 1 },
  ],
  'three-right': [
    { layout: 'rows', kept: [1, 2], ratios: [1], grown: 1 },
    { layout: 'cols', kept: [2, 0], ratios: [0], grown: 2 },
    { layout: 'cols', kept: [1, 0], ratios: [0], grown: 1 },
  ],
  'three-top': [
    { layout: 'cols', kept: [1, 2], ratios: [1], grown: 1 },
    { layout: 'rows', kept: [0, 2], ratios: [0], grown: 2 },
    { layout: 'rows', kept: [0, 1], ratios: [0], grown: 1 },
  ],
  'three-bottom': [
    { layout: 'cols', kept: [1, 2], ratios: [1], grown: 1 },
    { layout: 'rows', kept: [2, 0], ratios: [0], grown: 2 },
    { layout: 'rows', kept: [1, 0], ratios: [0], grown: 1 },
  ],
  grid: [
    { layout: 'three-left', kept: [2, 1, 3], ratios: [0, 1], grown: 2 },
    { layout: 'three-right', kept: [3, 0, 2], ratios: [0, 1], grown: 3 },
    { layout: 'three-left', kept: [0, 1, 3], ratios: [0, 1], grown: 0 },
    { layout: 'three-right', kept: [1, 0, 2], ratios: [0, 1], grown: 1 },
  ],
}

export function closePane(s: SplitState, pane: number): SplitState | null {
  const rule = CLOSE_RULES[s.layout][pane]
  if (!rule) return null
  const focusOld = pane === s.focus ? rule.grown : s.focus
  return {
    layout: rule.layout,
    ratios: rule.ratios.map((i) => s.ratios[i]),
    focus: rule.kept.indexOf(focusOld),
    panes: rule.kept.map((i) => s.panes[i]),
  }
}

export function setPaneTabs(s: SplitState, pane: number, tabs: DocTabsState): SplitState {
  const next = { ...s, panes: s.panes.map((p, i) => (i === pane ? { ...p, tabs: tabs.tabs, active: tabs.active } : p)) }
  if (tabs.tabs.length === 0 && next.panes.length >= 2) return closePane(next, pane) ?? next
  return next
}

export function prunePanes(s: SplitState): SplitState {
  let cur = s
  while (cur.panes.length > 1) {
    const empty = cur.panes.findLastIndex((p) => p.tabs.length === 0)
    if (empty < 0) break
    cur = closePane(cur, empty) ?? cur
  }
  return cur
}

export function paneForNumber(s: SplitState, n: number): number | null {
  return NUMBER_ORDER[s.layout][n - 1] ?? null
}

export function clampRatios(layout: SplitLayout, ratios: readonly number[], size?: { width: number; height: number }): number[] {
  const axes = RATIO_AXES[layout]
  if (ratios.length !== axes.length) return axes.map(() => 0.5)
  return axes.map((axis, i) => {
    let lo = RATIO_MIN
    let hi = RATIO_MAX
    if (size) {
      const min = axis === 'x' ? MIN_PANE_PX.width / size.width : MIN_PANE_PX.height / size.height
      lo = Math.max(lo, min)
      hi = Math.min(hi, 1 - min)
      if (lo > hi) return 0.5
    }
    const v = Number.isFinite(ratios[i]) ? ratios[i] : 0.5
    return Math.min(hi, Math.max(lo, v))
  })
}

export function totalTabs(s: SplitState): number {
  return s.panes.reduce((sum, p) => sum + p.tabs.length, 0)
}

export function paneTabLimit(s: SplitState, pane: number): number {
  return MAX_TABS - (totalTabs(s) - s.panes[pane].tabs.length)
}

export function parseStoredSplit(raw: string, scope: string, viewMode: ViewMode): SplitState | null {
  const mirror = parseStoredTabs(raw, scope)
  if (!mirror) return null
  const split = (readMap(raw)?.[scope] as { split?: unknown }).split as
    | { layout?: unknown; panes?: unknown; focus?: unknown; ratios?: unknown }
    | null
    | undefined
  const fallback = singleSplit(mirror, viewMode)
  if (!split || typeof split !== 'object') return fallback
  const layout = LAYOUTS.find((l) => l === split.layout)
  const { panes, focus } = split
  if (!layout || !Array.isArray(panes) || panes.length !== PANE_COUNT[layout]) return fallback
  if (typeof focus !== 'number' || !Number.isInteger(focus) || focus < 0 || focus >= panes.length) return fallback
  const parsed: PaneTabs[] = panes.map((p: { viewMode?: unknown } | null, i) => {
    const tabs = i === focus ? mirror : (parseTabsEntry(p) ?? EMPTY_TABS)
    const mode = p && typeof p.viewMode === 'string' && VIEW_MODES.includes(p.viewMode) ? (p.viewMode as ViewMode) : viewMode
    return { tabs: tabs.tabs, active: tabs.active, viewMode: mode }
  })
  const ratios = clampRatios(layout, Array.isArray(split.ratios) ? (split.ratios as number[]) : [])
  return prunePanes({ layout, ratios, focus, panes: parsed })
}

export function storeSplit(raw: string, scope: string, s: SplitState): string {
  const mirror = s.panes[s.focus]
  const entry =
    s.layout === 'single'
      ? { tabs: mirror.tabs, active: mirror.active }
      : {
          tabs: mirror.tabs,
          active: mirror.active,
          split: {
            layout: s.layout,
            ratios: s.ratios,
            focus: s.focus,
            panes: s.panes.map((p) => ({ tabs: p.tabs, active: p.active, viewMode: p.viewMode })),
          },
        }
  return JSON.stringify({ ...(readMap(raw) ?? {}), [scope]: entry })
}
