// 칸반 카드 끌기 판정 순수 함수 — 집기·놓을 자리·가장자리 자동 스크롤 (F-2142 2장)
import { MapMode, type ChangeDesc } from '@codemirror/state'
import { DRAG_AXIS_SLOP_PX } from './edgeSwipe'

export const KANBAN_PICKUP_MOUSE_PX = 4
export const KANBAN_LONG_PRESS_MS = 400
export const KANBAN_EDGE_PX = 48
const EDGE_MAX_PX = 12

export type PickupInput = { pointerType: 'mouse' | 'touch' | 'pen'; dx: number; dy: number; elapsedMs: number }

export function pickupState({ pointerType, dx, dy, elapsedMs }: PickupInput): 'wait' | 'pick' | 'cancel' {
  const moved = Math.max(Math.abs(dx), Math.abs(dy))
  if (pointerType === 'mouse') return moved >= KANBAN_PICKUP_MOUSE_PX ? 'pick' : 'wait'
  if (moved > DRAG_AXIS_SLOP_PX) return 'cancel'
  return elapsedMs >= KANBAN_LONG_PRESS_MS ? 'pick' : 'wait'
}

// 세로 가운데보다 위면 그 카드 앞 — 가운데와 같으면 뒤 (프로토타입 drop 과 같다)
export function dropSlot(cardMids: readonly number[], y: number): number {
  const slot = cardMids.findIndex((mid) => y < mid)
  return slot < 0 ? cardMids.length : slot
}

// slot 은 끄는 카드가 자리에 남은 목록 기준이고 moveCardChanges 의 index 는 뺀 뒤 기준이다
export function moveTarget(from: { lane: number; card: number }, lane: number, slotWithDragged: number): { lane: number; index: number } {
  return { lane, index: lane === from.lane && from.card < slotWithDragged ? slotWithDragged - 1 : slotWithDragged }
}

export type KanbanDir = 'up' | 'down' | 'left' | 'right'

// Alt+방향키 — 같은 칸 한 칸 위·아래, 옆 칸은 같은 자리(길이보다 크면 끝). 맨 끝이면 null
export function keyMoveTarget(from: { lane: number; card: number }, cardCounts: readonly number[], dir: KanbanDir): { lane: number; index: number } | null {
  if (dir === 'up') return from.card > 0 ? { lane: from.lane, index: from.card - 1 } : null
  if (dir === 'down') return from.card < cardCounts[from.lane] - 1 ? { lane: from.lane, index: from.card + 1 } : null
  const lane = from.lane + (dir === 'left' ? -1 : 1)
  return lane >= 0 && lane < cardCounts.length ? { lane, index: Math.min(from.card, cardCounts[lane]) } : null
}

// 방향키 포커스 — 옆 칸은 같은 자리 카드, 빈 칸은 건너뛴다
export function neighborCard(from: { lane: number; card: number }, cardCounts: readonly number[], dir: KanbanDir): { lane: number; card: number } | null {
  if (dir === 'up' || dir === 'down') {
    const card = from.card + (dir === 'up' ? -1 : 1)
    return card >= 0 && card < cardCounts[from.lane] ? { lane: from.lane, card } : null
  }
  const step = dir === 'left' ? -1 : 1
  for (let lane = from.lane + step; lane >= 0 && lane < cardCounts.length; lane += step) {
    if (cardCounts[lane] > 0) return { lane, card: Math.min(from.card, cardCounts[lane] - 1) }
  }
  return null
}

// 띠 안 깊이에 비례하고, 1px 아래로는 스크롤이 멈추지 않게 올림한다
export function edgeScroll(pos: number, start: number, end: number): number {
  if (pos < start + KANBAN_EDGE_PX) return -Math.ceil(EDGE_MAX_PX * Math.min(1, (start + KANBAN_EDGE_PX - pos) / KANBAN_EDGE_PX))
  if (pos > end - KANBAN_EDGE_PX) return Math.ceil(EDGE_MAX_PX * Math.min(1, (pos - end + KANBAN_EDGE_PX) / KANBAN_EDGE_PX))
  return 0
}

// 집은 카드 줄 머리를 변경 너머로 옮긴다 — 줄째 지워졌으면 null (useKanbanView mapTarget 과 같은 규칙)
export function mapCardPos(changes: ChangeDesc, pos: number): number | null {
  const next = changes.mapPos(pos, 1, MapMode.TrackDel)
  return next === null || changes.mapPos(pos + 1, 1, MapMode.TrackDel) === null ? null : next
}
