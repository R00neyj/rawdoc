// 화면 분할을 끌지 정하고, 꺼진 동안 포커스 칸만 남기며 다시 켤 때 칸별 탭을 되살리는 규칙 — 순수 함수 (F-2164 2장)
import { restoreTabs, syncTabMeta, type DocTabsState, type TabMeta } from './docTabs'
import { prunePanes, type SplitState } from './splitLayout'
import { unitPanes } from './paneRules'
import type { PaneDoc } from './docUnit'

export type SplitOnInput = { tabsBar: boolean; publicView: boolean; shares: boolean; help: boolean; trash: boolean }

export function splitOn(i: SplitOnInput): boolean {
  return i.tabsBar && !i.publicView && !i.shares && !i.help && !i.trash
}

// 바뀔 것이 없으면 같은 값 — 칸 객체가 그대로여야 carryPaneKeys 가 편집기를 살린다
export function restoreSplit(s: SplitState, exists: (key: string) => boolean, lookup: (key: string) => TabMeta | undefined): SplitState {
  let changed = false
  const panes = s.panes.map((p) => {
    const t = syncTabMeta(restoreTabs(p, exists), lookup)
    if (t === p) return p
    changed = true
    return { ...p, tabs: t.tabs, active: t.active }
  })
  return prunePanes(changed ? { ...s, panes } : s)
}

export function shownSplit(s: SplitState, on: boolean): SplitState {
  return on ? s : { layout: 'single', ratios: [], focus: 0, panes: [s.panes[s.focus]] }
}

// 빈 칸도 닫지 않는다 — 다시 켤 때 restoreSplit 의 prunePanes 가 한 번에 닫는다 (F-2162 5장)
export function withFocusTabs(s: SplitState, tabs: DocTabsState): SplitState {
  const at = s.panes[s.focus]
  if (at.tabs === tabs.tabs && at.active === tabs.active) return s
  return { ...s, panes: s.panes.map((p, i) => (i === s.focus ? { ...p, tabs: tabs.tabs, active: tabs.active } : p)) }
}

export function splitUnitPanes(s: SplitState, currentDocId: string | null, drained: boolean): PaneDoc[] {
  return drained ? [{ docId: currentDocId }] : unitPanes(s, currentDocId)
}
