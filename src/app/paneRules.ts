// 화면 분할 칸 배선 규칙 — 열 칸 고르기·묶음 입력·React key 잇기·나누기 판정, 순수 함수 (F-2163 2장)
import { MAX_TABS, openTabCapped, type DocTab, type OpenMode } from './docTabs'
import { MAX_PANES, cycleSplit, paneTabLimit, setPaneTabs, splitPane, totalTabs, type SplitDir, type SplitState } from './splitLayout'
import { MAX_DOC_UNITS, docUnitIds, type PaneDoc } from './docUnit'
import type { DocMeta } from './docMeta'

export const TABS_FULL = `탭은 ${MAX_TABS}개까지 열 수 있습니다. 안 쓰는 탭을 닫아 주세요.`
export const PANES_FULL = `화면은 ${MAX_PANES}칸까지 나눌 수 있습니다.`

// 문서가 있는 칸: prefer → 포커스 칸 → 최근 포커스 순, 어디에도 없으면 포커스 칸 (흐름 3)
export function routeOpen(
  s: SplitState,
  entry: DocTab,
  mode: OpenMode,
  order: readonly number[],
  prefer: number | null,
  max = MAX_TABS,
): { split: SplitState; capped: boolean } {
  const has = (i: number) => s.panes[i]?.tabs.some((t) => t.key === entry.key) ?? false
  const others = [...order, ...s.panes.keys()].filter((i) => i !== s.focus && has(i))
  const pane = prefer !== null && has(prefer) ? prefer : has(s.focus) ? s.focus : (others[0] ?? s.focus)
  const at = s.panes[pane]
  const opened = openTabCapped(at, entry, mode, paneTabLimit(s, pane) - (MAX_TABS - max))
  if (pane === s.focus && opened.state.tabs === at.tabs && opened.state.active === at.active) return { split: s, capped: false }
  return { split: { ...setPaneTabs(s, pane, opened.state), focus: pane }, capped: opened.capped }
}

// 묶음 입력 — selectDoc 이 currentDocId 를 먼저 바꾸는 한 렌더 동안 남은 칸 묶음이 빠지지 않게 덧붙인다
export function unitPanes(s: SplitState, currentDocId: string | null): PaneDoc[] {
  const panes = s.panes.map((p) => ({ docId: p.active }))
  if (currentDocId === null || panes.some((p) => p.docId === currentDocId)) return panes
  if (docUnitIds(panes).length < MAX_DOC_UNITS) return [...panes, { docId: currentDocId }]
  return panes.map((p, i) => (i === s.focus ? { docId: currentDocId } : p))
}

// 같은 칸 객체는 옛 키, 바뀐 칸이 하나뿐이면 남은 옛 키 하나를 잇고, 나머지(나누기의 새 칸)만 새 키
export function carryPaneKeys(prev: SplitState, prevKeys: readonly string[], next: SplitState, fresh: () => string): string[] {
  const used = new Set<string>()
  const keys = next.panes.map((p) => {
    const key = prevKeys[prev.panes.indexOf(p)]
    if (key === undefined || used.has(key)) return null
    used.add(key)
    return key
  })
  const changed = keys.flatMap((k, i) => (k === null ? [i] : []))
  const unused = prevKeys.filter((k) => !used.has(k))
  if (changed.length === 1 && unused.length === 1) keys[changed[0]] = unused[0]
  return keys.map((k) => k ?? fresh())
}

export type SplitAction = { kind: 'split'; next: SplitState } | { kind: 'notice'; message: string } | null

// null 이면 메뉴·팔레트 항목을 숨긴다 — 4칸이면 항목은 보이고 누르면 알림
export function splitAction(s: SplitState, pane: number, dir: SplitDir | 'cycle', tab: DocTab): SplitAction {
  if (totalTabs(s) >= MAX_TABS) return { kind: 'notice', message: TABS_FULL }
  if (s.panes.length === MAX_PANES) return { kind: 'notice', message: PANES_FULL }
  const next = dir === 'cycle' ? cycleSplit(s, tab) : splitPane(s, pane, dir, tab)
  return next ? { kind: 'split', next } : null
}

export function docReadOnly(i: {
  roleReadOnly: boolean
  claimReadOnly: boolean
  deleted: boolean
  liveStopped: boolean
  offlineView: boolean
  converting: boolean
  liveReadOnly: boolean
}): boolean {
  return i.roleReadOnly || i.claimReadOnly || i.deleted || i.liveStopped || i.offlineView || i.converting || i.liveReadOnly
}

// 금고 잠그기가 flush·내릴 묶음 — 칸에 뜬 열린 금고 문서 전부 (F-2163 7장)
export function openE2eeIds(units: readonly { docId: string | null; meta: DocMeta | null }[]): string[] {
  return units.flatMap((u) => (u.docId !== null && u.meta?.e2ee === 'open' ? [u.docId] : []))
}
