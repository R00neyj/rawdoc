// 오른쪽 패널(R-1) 열림·칸별 보기 — 넓은 창 고정 열·좁은 창 겹침·휴대폰 밀기 패널이 함께 쓴다 (small 2026-10-10, 2026-10-11)
import { useCallback, useState } from 'react'
import { getPref, setPref } from './prefs'
import { cycleSlotView, parseSlotViews, slotView, type PanelSlot, type SlotViews } from '../lib/panelSlots'

export type PanelViewId = 'calendar' | 'links'

export const PANEL_VIEW_LABELS: Record<PanelViewId, string> = { calendar: '달력', links: '링크' }

// 넓은 창은 위에서부터 최대 세 칸, 휴대폰은 위 칸 하나(아래 목차는 고정). 보기를 더할 때는 이 목록에만 넣는다
const WIDE_SLOTS: PanelSlot<PanelViewId>[] = [
  { id: 'wide1', views: ['calendar'] },
  { id: 'wide2', views: ['links'] },
]
const PHONE_TOP_SLOT: PanelSlot<PanelViewId> = { id: 'phoneTop', views: ['calendar', 'links'] }

export type PanelSlotState = { id: string; views: readonly PanelViewId[]; view: PanelViewId; onCycle: (step: 1 | -1) => void }

export type UseRightPanelResult = {
  open: boolean
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  closeIfNarrow: () => void
  wideSlots: PanelSlotState[]
  phoneTop: PanelSlotState
  linksVisible: boolean
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
  const open = narrow ? narrowOpen : widePref === 'open'

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
  const slotState = (slot: PanelSlot<PanelViewId>): PanelSlotState => {
    const view = slotView(slot, stored)
    return {
      id: slot.id,
      views: slot.views,
      view,
      onCycle: (step) => {
        const next = { ...stored, [slot.id]: cycleSlotView(slot, view, step) }
        setStored(next)
        setPref('md.rightPanelViews', JSON.stringify(next))
      },
    }
  }
  const wideSlots = WIDE_SLOTS.map(slotState)
  const phoneTop = slotState(PHONE_TOP_SLOT)

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
    linksVisible: open && (phone ? [phoneTop] : wideSlots).some((s) => s.view === 'links'),
  }
}
