// 오른쪽 패널 칸 — 보기 목록 중 지금 보기 고르기·‹ › 넘기기·기기별 저장값, 순수 함수 (small 2026-10-11)
export type PanelSlot<V extends string = string> = { id: string; views: readonly V[] }
export type SlotViews = Record<string, string>

export function slotView<V extends string>(slot: PanelSlot<V>, stored: SlotViews): V {
  const value = stored[slot.id]
  return slot.views.find((v) => v === value) ?? slot.views[0]
}

export function cycleSlotView<V extends string>(slot: PanelSlot<V>, current: V, step: 1 | -1): V {
  const n = slot.views.length
  const index = Math.max(0, slot.views.indexOf(current))
  return slot.views[(index + step + n) % n]
}

export function parseSlotViews(raw: string): SlotViews {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const result: SlotViews = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

