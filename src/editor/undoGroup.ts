// 되돌리기 묶음 경계 판정 — @codemirror/commands history() 의 HistoryState.addChanges 규칙을 그대로 옮긴다 (specs/features/F-302.md 4.4)
import { Transaction } from '@codemirror/state'
import type { ChangeSet } from '@codemirror/state'
import { ySyncAnnotation } from 'y-codemirror.next'

export const UNDO_GROUP_DELAY_MS = 500

export type UndoGroupState = {
  changes: ChangeSet
  time: number
  selectionMoved: boolean
} | null

const JOINABLE_USER_EVENT = /^(input\.type|delete)($|\.)/

// @codemirror/commands isAdjacent 와 같은 부등식 — 묶음 쪽은 바뀐 뒤 좌표, 새 변경은 바뀌기 전 좌표
function touches(group: ChangeSet, next: ChangeSet): boolean {
  const ranges: number[] = []
  group.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push(fromB, toB))
  let adjacent = false
  next.iterChangedRanges((from, to) => {
    for (let i = 0; i < ranges.length; i += 2) {
      if (to >= ranges[i] && from <= ranges[i + 1]) adjacent = true
    }
  })
  return adjacent
}

export function nextUndoGroup(prev: UndoGroupState, tr: Transaction): { state: UndoGroupState; startNew: boolean } {
  if (tr.annotation(ySyncAnnotation) !== undefined) return { state: null, startNew: false }

  if (tr.changes.empty) {
    const state = prev && tr.selection ? { ...prev, selectionMoved: true } : prev
    return { state, startNew: false }
  }

  const userEvent = tr.annotation(Transaction.userEvent)
  const time = tr.annotation(Transaction.time) ?? Date.now()
  // 묶음 길이가 이 트랜잭션 시작 문서와 어긋나면 compose 가 던지므로 새 묶음으로 연다
  const group = prev && prev.changes.newLength === tr.changes.length ? prev : null
  const join =
    group !== null &&
    (!userEvent || JOINABLE_USER_EVENT.test(userEvent)) &&
    ((!group.selectionMoved && time - group.time < UNDO_GROUP_DELAY_MS && touches(group.changes, tr.changes)) ||
      userEvent === 'input.type.compose')

  return {
    state: { changes: join && group ? group.changes.compose(tr.changes) : tr.changes, time, selectionMoved: false },
    startNew: !join,
  }
}
