import { describe, expect, it } from 'vitest'
import { ChangeSet, EditorSelection, EditorState, StateEffect, Transaction } from '@codemirror/state'
import type { SelectionRange } from '@codemirror/state'
import type { ChangeSpec } from '@codemirror/state'
import { history, undo, undoDepth } from '@codemirror/commands'
import * as Y from 'yjs'
import { ySyncAnnotation, YSyncConfig } from 'y-codemirror.next'

import { nextUndoGroup } from './undoGroup'
import type { UndoGroupState } from './undoGroup'

type Step = {
  wait: number
  changes?: ChangeSpec
  selection?: EditorSelection | SelectionRange
  userEvent?: string
}

type Scenario = { name: string; doc: string; steps: Step[] }

function typeChars(chars: string, from: number, wait: number): Step[] {
  return [...chars].map((ch, i) => ({
    wait,
    changes: { from: from + i, insert: ch },
    selection: EditorSelection.cursor(from + i + 1),
    userEvent: 'input.type',
  }))
}

// 4.2 의 S1~S7 과 11.1 A3 의 추가 셋
const scenarios: Scenario[] = [
  { name: 'S1 abc 연속 입력', doc: '', steps: typeChars('abc', 0, 30) },
  {
    name: 'S2 abc → 커서만 맨 앞 → X',
    doc: '',
    steps: [
      ...typeChars('abc', 0, 30),
      { wait: 30, selection: EditorSelection.cursor(0), userEvent: 'select' },
      ...typeChars('X', 0, 30),
    ],
  },
  {
    name: 'S3 abc → 붙여넣기 PP',
    doc: '',
    steps: [
      ...typeChars('abc', 0, 30),
      { wait: 30, changes: { from: 3, insert: 'PP' }, selection: EditorSelection.cursor(5), userEvent: 'input.paste' },
    ],
  },
  {
    name: 'S4 표 칸 a → <br>',
    doc: '| 1 | 2 |',
    steps: [
      { wait: 30, changes: { from: 3, insert: 'a' }, userEvent: 'input.table' },
      { wait: 50, changes: { from: 4, insert: '<br>' }, userEvent: 'input.table' },
    ],
  },
  {
    name: 'S5 한글 조합 3단계 700ms',
    doc: '',
    steps: [
      { wait: 30, changes: { from: 0, insert: 'ㅎ' }, selection: EditorSelection.cursor(1), userEvent: 'input.type.compose' },
      { wait: 700, changes: { from: 0, to: 1, insert: '하' }, selection: EditorSelection.cursor(1), userEvent: 'input.type.compose' },
      { wait: 700, changes: { from: 0, to: 1, insert: '한' }, selection: EditorSelection.cursor(1), userEvent: 'input.type.compose' },
    ],
  },
  { name: 'S6 ab → 600ms → cd', doc: '', steps: [...typeChars('ab', 0, 30), ...typeChars('cd', 2, 600).map((s, i) => (i === 0 ? s : { ...s, wait: 30 }))] },
  {
    name: 'S7 abc → 떨어진 맨 앞에 X',
    doc: '0123456789',
    steps: [
      ...typeChars('abc', 10, 30),
      { wait: 50, changes: { from: 0, insert: 'X' }, userEvent: 'input.type' },
    ],
  },
  {
    name: '① delete.backward 연속',
    doc: 'abcdef',
    steps: [5, 4, 3].map((from) => ({
      wait: 30,
      changes: { from, to: from + 1 },
      selection: EditorSelection.cursor(from),
      userEvent: 'delete.backward',
    })),
  },
  {
    name: '② compose.start 뒤 compose 700ms',
    doc: '',
    steps: [
      ...typeChars('ab', 0, 30),
      { wait: 700, changes: { from: 2, insert: 'ㄱ' }, selection: EditorSelection.cursor(3), userEvent: 'input.type.compose.start' },
      { wait: 700, changes: { from: 2, to: 3, insert: '가' }, selection: EditorSelection.cursor(3), userEvent: 'input.type.compose' },
    ],
  },
  {
    name: '③ 붙여넣기 뒤 바로 delete.backward',
    doc: 'x',
    steps: [
      { wait: 30, changes: { from: 1, insert: 'PP' }, selection: EditorSelection.cursor(3), userEvent: 'input.paste' },
      { wait: 30, changes: { from: 2, to: 3 }, selection: EditorSelection.cursor(2), userEvent: 'delete.backward' },
    ],
  },
]

// 시나리오를 history() 가 붙은 state 에 차례로 넣으며 트랜잭션마다 콜백을 부른다
function runWithHistory(scenario: Scenario, onTransaction: (tr: Transaction, depthGrew: boolean) => void) {
  let state = EditorState.create({ doc: scenario.doc, extensions: [history()] })
  let time = 1_000_000
  for (const step of scenario.steps) {
    time += step.wait
    const tr = state.update({
      changes: step.changes,
      selection: step.selection,
      annotations: [Transaction.time.of(time), ...(step.userEvent ? [Transaction.userEvent.of(step.userEvent)] : [])],
    })
    const before = undoDepth(state)
    state = tr.state
    onTransaction(tr, undoDepth(state) > before)
  }
  return state
}

function undoWithHistory(state: EditorState): string {
  let result = state
  undo({ state, dispatch: (tr) => (result = tr.state) })
  return result.doc.toString()
}

// y-sync.js YSyncPluginValue.update 의 iterChanges 규칙을 옮겨 적은 것 — ySync 는 ViewPlugin 이라 node 에서 못 돌린다
function applyLikeYSync(ytext: Y.Text, changes: ChangeSet, origin: unknown) {
  ytext.doc!.transact(() => {
    let adj = 0
    changes.iterChanges((fromA, toA, _fromB, _toB, insert) => {
      const insertText = insert.sliceString(0, insert.length, '\n')
      if (fromA !== toA) ytext.delete(fromA + adj, toA - fromA)
      if (insertText.length > 0) ytext.insert(fromA + adj, insertText)
      adj += insertText.length - (toA - fromA)
    })
  }, origin)
}

describe('F-302 A3 nextUndoGroup 의 startNew 가 history() 의 묶음 경계와 같다', () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      let group: UndoGroupState = null
      const got: boolean[] = []
      const want: boolean[] = []
      runWithHistory(scenario, (tr, depthGrew) => {
        const next = nextUndoGroup(group, tr)
        group = next.state
        if (tr.docChanged) {
          got.push(next.startNew)
          want.push(depthGrew)
        } else {
          expect(next.startNew).toBe(false)
        }
      })
      expect(got).toEqual(want)
    })
  }
})

describe('F-302 A3b Y.UndoManager + nextUndoGroup 의 Ctrl+Z 1회 결과가 history() 와 같다', () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const ydoc = new Y.Doc()
      const ytext = ydoc.getText('content')
      if (scenario.doc) ytext.insert(0, scenario.doc)
      const origin = new YSyncConfig(ytext, null)
      const undoManager = new Y.UndoManager(ytext, {
        trackedOrigins: new Set([origin]),
        captureTimeout: Number.POSITIVE_INFINITY,
      })
      let group: UndoGroupState = null
      const finalState = runWithHistory(scenario, (tr) => {
        const next = nextUndoGroup(group, tr)
        group = next.state
        if (next.startNew) undoManager.stopCapturing()
        if (tr.docChanged) applyLikeYSync(ytext, tr.changes, origin)
      })
      expect(ytext.toString()).toBe(finalState.doc.toString())
      undoManager.undo()
      expect(ytext.toString()).toBe(undoWithHistory(finalState))
      ydoc.destroy()
    })
  }
})

describe('F-302 A7 되돌리기 결과·효과만 있는 트랜잭션', () => {
  const syncConf = new YSyncConfig(new Y.Doc().getText('content'), null)
  const forceRecalcLike = StateEffect.define<null>()

  it('ySyncAnnotation 이 붙은 트랜잭션 뒤 state 는 null, 다음 로컬 변경은 새 묶음', () => {
    let state = EditorState.create({ doc: '' })
    const typed = state.update({ changes: { from: 0, insert: 'a' }, userEvent: 'input.type' })
    let group = nextUndoGroup(null, typed).state
    state = typed.state
    expect(group).not.toBeNull()

    const remote = state.update({ changes: { from: 1, insert: 'b' }, annotations: ySyncAnnotation.of(syncConf) })
    const afterRemote = nextUndoGroup(group, remote)
    expect(afterRemote).toEqual({ state: null, startNew: false })
    group = afterRemote.state
    state = remote.state

    const next = nextUndoGroup(group, state.update({ changes: { from: 2, insert: 'c' }, userEvent: 'input.type' }))
    expect(next.startNew).toBe(true)
  })

  it('효과만 있는 트랜잭션은 상태를 바꾸지 않는다', () => {
    const state = EditorState.create({ doc: '' })
    const typed = state.update({ changes: { from: 0, insert: 'a' }, userEvent: 'input.type' })
    const group = nextUndoGroup(null, typed).state
    const effectOnly = typed.state.update({ effects: forceRecalcLike.of(null) })
    expect(nextUndoGroup(group, effectOnly)).toEqual({ state: group, startNew: false })
    expect(nextUndoGroup(null, effectOnly)).toEqual({ state: null, startNew: false })
  })
})
