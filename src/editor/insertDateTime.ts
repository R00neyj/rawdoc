// 선택 자리에 글 넣기 — 트랜잭션 1개, 새 되돌리기 묶음 (specs/features/F-2088.md 3.2)
import { EditorSelection, type StateCommand } from '@codemirror/state'

export const DATETIME_USER_EVENT = 'input.datetime'

export function insertTextAtSelection(text: string): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    const tr = state.changeByRange((range) => ({
      changes: { from: range.from, to: range.to, insert: text },
      range: EditorSelection.cursor(range.from + text.length),
    }))
    dispatch(state.update(tr, { userEvent: DATETIME_USER_EVENT, scrollIntoView: true }))
    return true
  }
}
