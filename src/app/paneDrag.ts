// 탭을 칸 가장자리·다른 칸 탭 줄로 끌 때 놓을 자리와 결과 배치, 칸 경계 위치 — 순수 함수 (F-2165 2장)
import { closeTabs, MAX_TABS, pinTab, type DocTab } from './docTabs'
import { clampRatios, setPaneTabs, splitPane, totalTabs, type SplitLayout, type SplitState } from './splitLayout'

export type DropSide = 'left' | 'right' | 'up' | 'down'
export type Box = { left: number; top: number; width: number; height: number }
export type Divider = { index: number; axis: 'x' | 'y'; at: number; from: number; to: number }

export const EDGE_BAND = 1 / 3

export function pickDropSide(box: Box, x: number, y: number): DropSide | null {
  const { left, top, width, height } = box
  if (width <= 0 || height <= 0) return null
  if (x < left || x > left + width || y < top || y > top + height) return null
  const gaps: Array<[DropSide, number]> = [
    ['left', (x - left) / width],
    ['right', (left + width - x) / width],
    ['up', (y - top) / height],
    ['down', (top + height - y) / height],
  ]
  let best = gaps[0]
  for (const gap of gaps) if (gap[1] < best[1]) best = gap
  return best[1] < EDGE_BAND ? best[0] : null
}

export function dropPreview(box: Box, side: DropSide): Box {
  const halfW = box.width / 2
  const halfH = box.height / 2
  if (side === 'left') return { ...box, width: halfW }
  if (side === 'right') return { ...box, left: box.left + halfW, width: halfW }
  if (side === 'up') return { ...box, height: halfH }
  return { ...box, top: box.top + halfH, height: halfH }
}

// left·up 은 같은 축으로 나눈 뒤 대상 칸과 새 칸 자리만 맞바꾼다 — 경계 자리가 같아 ratios 는 그대로
export function splitPaneAt(s: SplitState, pane: number, side: DropSide, tab: DocTab): SplitState | null {
  const after = side === 'right' || side === 'down'
  const next = splitPane(s, pane, side === 'left' || side === 'right' ? 'right' : 'down', tab)
  if (!next || after) return next
  const target = next.panes.indexOf(s.panes[pane])
  const panes = next.panes.slice()
  panes[target] = next.panes[next.focus]
  panes[next.focus] = next.panes[target]
  return { ...next, panes, focus: target }
}

// 놓기 첫 단계 — 끈 칸에서 빼기 전이라 칸 하나씩만 바뀌어 칸 key·편집기가 이어진다
export function dragSplitStep(s: SplitState, from: number, key: string, to: number, side: DropSide): SplitState | null {
  const source = s.panes[from]
  const tab = source?.tabs.find((t) => t.key === key)
  if (!tab || (from === to && source.tabs.length === 1)) return null
  const next = splitPaneAt(s, to, side, tab)
  if (!next) return null
  // 탭 pointerdown 은 칸 포커스를 옮기지 않아 splitPane 이 쓴 포커스 칸 값 대신 끈 칸 값을 쓴다
  return { ...next, panes: next.panes.map((p, i) => (i === next.focus ? { ...p, viewMode: source.viewMode } : p)) }
}

function takeTab(step: SplitState, source: SplitState['panes'][number], key: string): SplitState {
  const at = step.panes.indexOf(source)
  return setPaneTabs(step, at, closeTabs(step.panes[at], [key]))
}

export function dragSplit(s: SplitState, from: number, key: string, to: number, side: DropSide): SplitState | null {
  const step = dragSplitStep(s, from, key, to, side)
  return step && takeTab(step, s.panes[from], key)
}

// 사이드바 문서를 칸 가장자리에 놓기 — 끈 칸이 없어 탭이 하나 늘어 상한을 본다
export function docSplit(s: SplitState, to: number, side: DropSide, tab: DocTab): SplitState | null {
  return totalTabs(s) >= MAX_TABS ? null : splitPaneAt(s, to, side, tab)
}

export function moveInStep(s: SplitState, from: number, key: string, to: number, index: number): SplitState | null {
  const target = s.panes[to]
  const tab = s.panes[from]?.tabs.find((t) => t.key === key)
  if (from === to || !target || !tab) return null
  // 고정으로 옮긴다 — openTab 은 첫 임시 탭만 바꿔 대상 칸에 임시 탭이 둘 생기지 않게
  const at = Math.max(0, Math.min(index, target.tabs.length))
  const tabs = target.tabs.some((t) => t.key === key)
    ? pinTab(target, key).tabs
    : [...target.tabs.slice(0, at), { ...tab, pinned: true }, ...target.tabs.slice(at)]
  return { ...setPaneTabs(s, to, { tabs, active: key }), focus: to }
}

export function moveTabToPane(s: SplitState, from: number, key: string, to: number, index: number): SplitState | null {
  const step = moveInStep(s, from, key, to, index)
  return step && takeTab(step, s.panes[from], key)
}

// 비율 자리 → 경계 막대. index 1 은 index 0 경계로 나뉜 한쪽만 가로지른다
const SECOND: Partial<Record<SplitLayout, { axis: 'x' | 'y'; span: 'after' | 'before' | 'full' }>> = {
  'three-left': { axis: 'y', span: 'after' },
  'three-right': { axis: 'y', span: 'before' },
  'three-top': { axis: 'x', span: 'after' },
  'three-bottom': { axis: 'x', span: 'before' },
  grid: { axis: 'y', span: 'full' },
}
const FIRST_AXIS: Record<SplitLayout, 'x' | 'y' | null> = {
  single: null, cols: 'x', rows: 'y', grid: 'x', 'three-left': 'x', 'three-right': 'x', 'three-top': 'y', 'three-bottom': 'y',
}

export function dividers(layout: SplitLayout, ratios: readonly number[]): Divider[] {
  const axis = FIRST_AXIS[layout]
  if (axis === null) return []
  const r0 = ratios[0] ?? 0.5
  const out: Divider[] = [{ index: 0, axis, at: r0, from: 0, to: 1 }]
  const second = SECOND[layout]
  if (second) {
    const [from, to] = second.span === 'after' ? [r0, 1] : second.span === 'before' ? [0, r0] : [0, 1]
    out.push({ index: 1, axis: second.axis, at: ratios[1] ?? 0.5, from, to })
  }
  return out
}

export function setRatio(layout: SplitLayout, ratios: readonly number[], index: number, value: number, size: { width: number; height: number }): number[] {
  const next = ratios.slice()
  if (Number.isInteger(index) && index >= 0 && index < dividers(layout, ratios).length) next[index] = value
  return clampRatios(layout, next, size)
}
