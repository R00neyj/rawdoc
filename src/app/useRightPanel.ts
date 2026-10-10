// 오른쪽 패널(R-1) 열림·칸별 보기·표시할 항목·칸 접힘 — 넓은 창 고정 열·좁은 창 겹침·휴대폰 밀기 패널이 함께 쓴다 (small 2026-10-10, 2026-10-11)
import { useCallback, useState } from 'react'
import { getPref, setPref } from './prefs'
import { useTaskFilter, type TaskFilterSettings } from './useTaskFilter'
import type { TaskFilter } from '../lib/docTodos'
import {
  cycleSlotView,
  filterSlots,
  parseFlags,
  parseSlotViews,
  readPanelItems,
  slotView,
  type PanelItemId,
  type PanelItems,
  type PanelSlot,
  type SlotViews,
} from '../lib/panelSlots'

export type PanelViewId = 'calendar' | 'graph' | 'links' | 'todos'

export const PANEL_VIEW_LABELS: Record<PanelViewId, string> = { calendar: '달력', graph: '그래프', links: '링크', todos: '할 일' }

// 넓은 창은 위에서부터 최대 세 칸, 휴대폰은 위 칸 하나(아래 목차는 고정). 보기를 더할 때는 이 목록에만 넣는다
const WIDE_SLOTS: PanelSlot<PanelViewId>[] = [
  { id: 'wide1', views: ['calendar', 'graph'] },
  { id: 'wide2', views: ['links'] },
  { id: 'wide3', views: ['todos'] },
]
const PHONE_TOP_SLOT: PanelSlot<PanelViewId> = { id: 'phoneTop', views: ['calendar', 'graph', 'links', 'todos'] }

export type PanelSlotState = {
  id: string
  views: readonly PanelViewId[]
  view: PanelViewId
  collapsed: boolean
  onCycle: (step: 1 | -1) => void
  onToggleCollapsed: () => void
}

export type RightPanelItemsSettings = { items: PanelItems; onToggleItem: (id: PanelItemId, on: boolean) => void } & TaskFilterSettings

export type UseRightPanelResult = {
  // 표시할 항목이 하나도 없으면 거짓 — 상단바 버튼·팔레트 명령·넓은 창 패널을 그리지 않는다
  available: boolean
  open: boolean
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  closeIfNarrow: () => void
  wideSlots: PanelSlotState[]
  phoneTop: PanelSlotState | null
  shownViews: PanelViewId[]
  dayDocsActive: boolean
  taskFilter: TaskFilter
  settings: RightPanelItemsSettings
}

export function useRightPanel({ narrow, phone }: { narrow: boolean; phone: boolean }): UseRightPanelResult {
  const [widePref, setWidePref] = useState(() => getPref('md.rightPanel', 'open'))
  const [narrowOpen, setNarrowOpen] = useState(false)
  // 넓은 창으로 돌아가면 겹침 열림은 버린다 — 렌더 중 조정
  const [narrowSeen, setNarrowSeen] = useState(narrow)
  if (narrow !== narrowSeen) {
    setNarrowSeen(narrow)
    if (!narrow) setNarrowOpen(false)
  }

  const [items, setItems] = useState(() => readPanelItems(getPref('md.rightPanelItems', '')))
  const tasks = useTaskFilter()
  const enabled = (view: PanelViewId) => items[view]
  const visibleWide = filterSlots(WIDE_SLOTS, enabled)
  const available = visibleWide.length > 0
  const open = (phone || available) && (narrow ? narrowOpen : widePref === 'open')

  // 밀기·Esc 구독이 렌더마다 다시 걸리지 않게 안정 함수로 둔다
  const setPanelOpen = useCallback(
    (next: boolean) => {
      if (narrow) {
        setNarrowOpen(next)
        return
      }
      const value = next ? 'open' : 'closed'
      setWidePref(value)
      setPref('md.rightPanel', value)
    },
    [narrow],
  )
  const openPanel = useCallback(() => setPanelOpen(true), [setPanelOpen])
  const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen])

  const [stored, setStored] = useState<SlotViews>(() => parseSlotViews(getPref('md.rightPanelViews', '')))
  const [collapsed, setCollapsed] = useState(() => parseFlags(getPref('md.rightPanelCollapsed', '')))
  const slotState = (slot: PanelSlot<PanelViewId>): PanelSlotState => {
    const view = slotView(slot, stored)
    return {
      id: slot.id,
      views: slot.views,
      view,
      collapsed: collapsed[slot.id] === true,
      onCycle: (step) => {
        const next = { ...stored, [slot.id]: cycleSlotView(slot, view, step) }
        setStored(next)
        setPref('md.rightPanelViews', JSON.stringify(next))
      },
      onToggleCollapsed: () => {
        const next = { ...collapsed, [slot.id]: collapsed[slot.id] !== true }
        setCollapsed(next)
        setPref('md.rightPanelCollapsed', JSON.stringify(next))
      },
    }
  }
  const wideSlots = visibleWide.map(slotState)
  const [phoneSlot] = filterSlots([PHONE_TOP_SLOT], enabled)
  const phoneTop = phoneSlot ? slotState(phoneSlot) : null
  // 접힌 칸(넓은 창)·끈 보기는 계산하지 않는다. 휴대폰 위 칸 접힘은 usePhoneSidePanel 이 따로 쥔다
  const shownViews = !open ? [] : phone ? (phoneTop ? [phoneTop.view] : []) : wideSlots.filter((s) => !s.collapsed).map((s) => s.view)

  return {
    open,
    togglePanel: () => setPanelOpen(!open),
    openPanel,
    closePanel,
    closeIfNarrow: () => {
      if (narrow) setNarrowOpen(false)
    },
    wideSlots,
    phoneTop,
    shownViews,
    dayDocsActive: items.dayDocs && shownViews.includes('calendar'),
    available,
    taskFilter: tasks.taskFilter,
    settings: {
      items,
      onToggleItem: (id, on) => {
        const next = { ...items, [id]: on }
        setItems(next)
        setPref('md.rightPanelItems', JSON.stringify(next))
      },
      ...tasks.settings,
    },
  }
}
