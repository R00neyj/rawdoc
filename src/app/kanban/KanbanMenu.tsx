// 칸반 보드 우클릭·`⋯` 메뉴 — 카드·칸 머리·빈 자리마다 항목을 고르고 FolderMenu 로 그린다
import FolderMenu, { type FolderMenuItem } from '../sidebar/FolderMenu'
import { IconAdd, IconCheck, IconDelete, IconEdit, IconMove, IconRaw, IconRemoveCheck, IconSettings } from '../icons'
import type { KanbanLane } from '../../lib/kanban/kanban'

export type KanbanMenuTarget = { kind: 'card'; lane: number; card: number } | { kind: 'lane'; lane: number } | { kind: 'board' }
export type KanbanMenuState = { target: KanbanMenuTarget; x: number; y: number; returnFocus: HTMLElement | null }

export type KanbanMenuActions = {
  editCard: (lane: number, card: number) => void
  toggleCheck: (lane: number, card: number) => void
  removeCheck: (lane: number, card: number) => void
  moveCardTo: (lane: number, card: number, toLane: number) => void
  showSource: (lane: number, card: number) => void
  removeCard: (lane: number, card: number) => void
  renameLane: (lane: number) => void
  moveLane: (lane: number, dir: 'left' | 'right') => void
  removeLane: (lane: number) => void
  addLane: () => void
  openSettings: () => void
}

type KanbanMenuProps = {
  menu: KanbanMenuState
  lanes: KanbanLane[]
  unnamed: string
  actions: KanbanMenuActions
  onClose: () => void
}

function menuItems(target: KanbanMenuTarget, lanes: KanbanLane[], unnamed: string, a: KanbanMenuActions): FolderMenuItem[] | null {
  if (target.kind === 'board') {
    return [
      { key: 'add-lane', label: '칸 추가', icon: IconAdd, onSelect: a.addLane },
      { key: 'settings', label: '칸반 설정…', icon: IconSettings, onSelect: a.openSettings },
    ]
  }
  const { lane } = target
  if (!lanes[lane]) return null
  if (target.kind === 'lane') {
    // 끝 칸이면 moveLane 이 아무것도 하지 않는다
    return [
      { key: 'rename', label: '이름 바꾸기', icon: IconEdit, onSelect: () => a.renameLane(lane) },
      { key: 'left', label: '왼쪽으로 옮기기', disabled: lane === 0, onSelect: () => a.moveLane(lane, 'left') },
      { key: 'right', label: '오른쪽으로 옮기기', disabled: lane === lanes.length - 1, onSelect: () => a.moveLane(lane, 'right') },
      { key: 'remove', label: '칸 삭제', icon: IconDelete, danger: true, onSelect: () => a.removeLane(lane) },
    ]
  }
  const { card } = target
  const found = lanes[lane].cards[card]
  if (!found) return null
  const check = found.done === null ? '체크 칸 달기' : found.done ? '완료 해제' : '완료로 표시'
  return [
    { key: 'edit', label: '고치기', icon: IconEdit, onSelect: () => a.editCard(lane, card) },
    { key: 'check', label: check, icon: IconCheck, onSelect: () => a.toggleCheck(lane, card) },
    ...(found.done === null ? [] : [{ key: 'uncheck', label: '체크 칸 떼기', icon: IconRemoveCheck, onSelect: () => a.removeCheck(lane, card) }]),
    ...lanes.flatMap((l, i): FolderMenuItem[] =>
      i === lane ? [] : [{ key: `move-${i}`, label: `옮기기: ${l.title || unnamed}`, icon: IconMove, onSelect: () => a.moveCardTo(lane, card, i) }],
    ),
    { key: 'source', label: '원문에서 보기', icon: IconRaw, onSelect: () => a.showSource(lane, card) },
    { key: 'remove', label: '카드 삭제', icon: IconDelete, danger: true, onSelect: () => a.removeCard(lane, card) },
  ]
}

export default function KanbanMenu({ menu, lanes, unnamed, actions, onClose }: KanbanMenuProps) {
  const items = menuItems(menu.target, lanes, unnamed, actions)
  if (!items) return null
  const label = menu.target.kind === 'card' ? '카드' : menu.target.kind === 'lane' ? lanes[menu.target.lane].title || unnamed : '보드'
  return (
    <FolderMenu
      label={label}
      hideTrigger
      open
      anchorPoint={{ x: menu.x, y: menu.y }}
      onOpenChange={(open) => open || onClose()}
      items={items}
    />
  )
}
