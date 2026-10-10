// 오른쪽 패널 칸 — 보기 목록 중 지금 보기 고르기·‹ › 넘기기·설정으로 거르기·기기별 저장값, 순수 함수 (small 2026-10-11)
export type PanelSlot<V extends string = string> = { id: string; views: readonly V[] }
export type SlotViews = Record<string, string>

// 설정 `표시할 항목` — 그날 문서는 달력 보기 안의 목록이라 보기가 아니다
export const PANEL_ITEM_IDS = ['calendar', 'dayDocs', 'graph', 'links', 'todos'] as const
export type PanelItemId = (typeof PANEL_ITEM_IDS)[number]
export type PanelItems = Record<PanelItemId, boolean>

export function slotView<V extends string>(slot: PanelSlot<V>, stored: SlotViews): V {
  const value = stored[slot.id]
  return slot.views.find((v) => v === value) ?? slot.views[0]
}

export function cycleSlotView<V extends string>(slot: PanelSlot<V>, current: V, step: 1 | -1): V {
  const n = slot.views.length
  const index = Math.max(0, slot.views.indexOf(current))
  return slot.views[(index + step + n) % n]
}

// 끈 보기를 빼고, 보기가 남지 않은 칸은 칸째 뺀다
export function filterSlots<V extends string>(slots: readonly PanelSlot<V>[], enabled: (view: V) => boolean): PanelSlot<V>[] {
  return slots.map((slot) => ({ id: slot.id, views: slot.views.filter(enabled) })).filter((slot) => slot.views.length > 0)
}

function parseObject(raw: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
}

export function parseSlotViews(raw: string): SlotViews {
  const result: SlotViews = {}
  for (const [key, value] of Object.entries(parseObject(raw))) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

export function parseFlags(raw: string): Record<string, boolean> {
  const result: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(parseObject(raw))) {
    if (typeof value === 'boolean') result[key] = value
  }
  return result
}

// 저장하지 않은 항목은 켬
export function readPanelItems(raw: string): PanelItems {
  const flags = parseFlags(raw)
  const items = {} as PanelItems
  for (const id of PANEL_ITEM_IDS) items[id] = flags[id] ?? true
  return items
}
