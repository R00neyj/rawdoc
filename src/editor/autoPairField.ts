// 한 줄 입력칸을 EditorState 로 비춰 편집기 자동 짝 규칙(F-127 autoPairInput/Backspace)을 그대로 쓴다. 조합 중 판단은 부르는 쪽
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { autoPairBackspace, autoPairInput, trackedClosers } from './autoPair'

// 입력칸에 할 일 하나 — [from, to) 를 insert 로 바꾸고 선택을 옮긴다
export type FieldEdit = { from: number; to: number; insert: string; selStart: number; selEnd: number }
export type FieldPair = { state: EditorState; edit: FieldEdit }

// 인라인 코드 안 판정에 문법 나무가 필요하다
const extensions = [markdown({ base: markdownLanguage }), trackedClosers]

// 입력칸 값·선택을 이전 상태에 달라진 만큼만 반영한다 — 짝 추적 위치가 사이에 친 글자를 따라간다
export function syncField(prev: EditorState | null, value: string, selStart: number, selEnd: number): EditorState {
  const selection = EditorSelection.single(selStart, selEnd)
  if (!prev) return EditorState.create({ doc: value, selection, extensions })
  const old = prev.doc.toString()
  if (old === value) return prev.update({ selection }).state
  const max = Math.min(old.length, value.length)
  let head = 0
  while (head < max && old[head] === value[head]) head++
  let tail = 0
  while (tail < max - head && old[old.length - 1 - tail] === value[value.length - 1 - tail]) tail++
  return prev.update({ changes: { from: head, to: old.length - tail, insert: value.slice(head, value.length - tail) }, selection }).state
}

// 편집기 규칙의 결과를 입력칸 한 번 바꾸기로 줄인다 — 감싸기는 두 군데라 그 사이를 통째로 바꾼다
function toFieldPair(state: EditorState, spec: TransactionSpec | null): FieldPair | null {
  if (!spec) return null
  const tr = state.update(spec)
  const cursor = state.selection.main.from
  let from = -1
  let to = cursor
  let fromB = cursor
  let toB = cursor
  tr.changes.iterChanges((fromA, toA, startB, endB) => {
    if (from < 0) {
      from = fromA
      fromB = startB
    }
    to = toA
    toB = endB
  })
  const sel = tr.state.selection.main
  return { state: tr.state, edit: { from: from < 0 ? cursor : from, to, insert: tr.state.sliceDoc(fromB, toB), selStart: sel.from, selEnd: sel.to } }
}

export function fieldPairInput(state: EditorState, text: string): FieldPair | null {
  const { from, to } = state.selection.main
  return toFieldPair(state, autoPairInput(state, from, to, text))
}

export function fieldPairBackspace(state: EditorState): FieldPair | null {
  return toFieldPair(state, autoPairBackspace(state))
}
