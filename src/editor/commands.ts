// 단축키 명령 (specs/features/F-109.md)
// StateCommand(`({state,dispatch}) => boolean`) 로 만들어 DOM 없이 테스트한다.
// 서식 적용이 아니라 텍스트 삽입이다. 명령 1회 = dispatch 1회 = 실행 취소 1단계
import { EditorSelection } from '@codemirror/state'
import type { EditorState, StateCommand } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'

import { isComposing } from './composition'

// state.sliceDoc 인데 범위가 문서 밖으로 나가도 던지지 않는다
function sliceSafe(state: EditorState, from: number, to: number): string {
  const len = state.doc.length
  return state.sliceDoc(Math.max(0, from), Math.min(len, to))
}

// Mod-b: 굵게. 선택 양옆이 ** 면 제거, 아니면 **선택** 으로 감싼다
export const toggleStrong: StateCommand = ({ state, dispatch }) => {
  const tr = state.update(state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: '****' },
        range: EditorSelection.cursor(range.from + 2),
      }
    }
    const before = sliceSafe(state, range.from - 2, range.from)
    const after = sliceSafe(state, range.to, range.to + 2)
    if (before === '**' && after === '**') {
      return {
        changes: [
          { from: range.from - 2, to: range.from },
          { from: range.to, to: range.to + 2 },
        ],
        range: EditorSelection.range(range.from - 2, range.to - 2),
      }
    }
    const text = state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `**${text}**` },
      range: EditorSelection.range(range.from + 2, range.from + 2 + text.length),
    }
  }))
  dispatch(tr)
  return true
}

// Mod-i: 기울임. 양옆이 * 이고 그 바깥이 * 가 아니면(** 의 일부가 아니면) 제거,
// 아니면 *선택* 으로 감싼다 — **a** 안쪽 a 를 선택하면 바깥의 * 은 ** 의
// 일부라 제거 대상이 아니라서 ***a*** 가 된다
export const toggleEmphasis: StateCommand = ({ state, dispatch }) => {
  const tr = state.update(state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: '**' },
        range: EditorSelection.cursor(range.from + 1),
      }
    }
    const left1 = sliceSafe(state, range.from - 1, range.from)
    const right1 = sliceSafe(state, range.to, range.to + 1)
    const left2 = sliceSafe(state, range.from - 2, range.from - 1)
    const right2 = sliceSafe(state, range.to + 1, range.to + 2)
    const canRemove = left1 === '*' && right1 === '*' && left2 !== '*' && right2 !== '*'
    if (canRemove) {
      return {
        changes: [
          { from: range.from - 1, to: range.from },
          { from: range.to, to: range.to + 1 },
        ],
        range: EditorSelection.range(range.from - 1, range.to - 1),
      }
    }
    const text = state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `*${text}*` },
      range: EditorSelection.range(range.from + 1, range.from + 1 + text.length),
    }
  }))
  dispatch(tr)
  return true
}

// Mod-k: 링크. [선택]() 로 바꾸고 커서를 ( 와 ) 사이에 둔다
export const insertLink: StateCommand = ({ state, dispatch }) => {
  const tr = state.update(state.changeByRange((range) => {
    if (range.empty) {
      return {
        changes: { from: range.from, insert: '[]()' },
        range: EditorSelection.cursor(range.from + 1),
      }
    }
    const text = state.sliceDoc(range.from, range.to)
    return {
      changes: { from: range.from, to: range.to, insert: `[${text}]()` },
      range: EditorSelection.cursor(range.from + text.length + 3),
    }
  }))
  dispatch(tr)
  return true
}

// StateCommand → keymap 의 run(view) 으로. 조합 중이면 실행하지 않는다
function guardComposing(command: StateCommand): KeyBinding['run'] {
  return (view) => {
    if (isComposing(view)) return false
    return command(view)
  }
}

// createEditor.ts 가 defaultKeymap 보다 앞(Prec.high)에 넣는 단축키
export const shortcutKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: guardComposing(toggleStrong) },
  { key: 'Mod-i', run: guardComposing(toggleEmphasis) },
  { key: 'Mod-k', run: guardComposing(insertLink) },
]
