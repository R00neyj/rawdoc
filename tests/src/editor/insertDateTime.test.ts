import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { insertTextAtSelection, DATETIME_USER_EVENT } from '../../../src/editor/insertDateTime'
import { nextUndoGroup } from '../../../src/editor/undoGroup'

const TEXT = '2026-09-23'

function run(state: EditorState) {
  const trs: Transaction[] = []
  const dispatch = vi.fn((tr: Transaction) => trs.push(tr))
  const handled = insertTextAtSelection(TEXT)({ state, dispatch })
  return { handled, dispatch, trs }
}

describe('insertTextAtSelection — U4', () => {
  it('빈 커서 — 그 자리에 끼우고 커서는 글 끝', () => {
    const { handled, dispatch, trs } = run(EditorState.create({ doc: '가나다', selection: { anchor: 2 } }))
    expect(handled).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const next = trs[0].state
    expect(next.doc.toString()).toBe('가나2026-09-23다')
    expect(next.selection.main.head).toBe(12)
    expect(trs[0].annotation(Transaction.userEvent)).toBe(DATETIME_USER_EVENT)
    expect(DATETIME_USER_EVENT).toBe('input.datetime')
  })

  it('선택 — 바꾸고 빈 커서', () => {
    const { trs } = run(EditorState.create({ doc: '가나다', selection: { anchor: 1, head: 2 } }))
    const next = trs[0].state
    expect(next.doc.toString()).toBe('가2026-09-23다')
    expect(next.selection.main.empty).toBe(true)
    expect(next.selection.main.head).toBe(11)
  })

  it('여러 범위 — 각자 넣은 글 끝', () => {
    const state = EditorState.create({
      doc: '가나다',
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    const { dispatch, trs } = run(state)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const next = trs[0].state
    expect(next.doc.toString()).toBe('가2026-09-23나다2026-09-23')
    expect(next.selection.ranges.map((r) => r.head)).toEqual([11, 23])
  })

  it('읽기 전용 — false, dispatch 0회', () => {
    const { handled, dispatch } = run(EditorState.create({ doc: '가', extensions: [EditorState.readOnly.of(true)] }))
    expect(handled).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('U5 — 직전 입력과 합쳐지지 않는다', () => {
  it('input.type 바로 뒤 날짜 넣기는 새 묶음', () => {
    const s0 = EditorState.create({ doc: '가나', selection: { anchor: 2 } })
    const typed = s0.update({ changes: { from: 2, insert: '다' }, selection: { anchor: 3 }, userEvent: 'input.type' })
    const a = nextUndoGroup(null, typed)
    const { trs } = run(typed.state)
    expect(nextUndoGroup(a.state, trs[0]).startNew).toBe(true)
  })
})
