import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorStateConfig, Extension, StateCommand, Transaction } from '@codemirror/state'

import { insertLink, toggleEmphasis, toggleStrong } from './commands'

// 문서와 선택으로 상태를 만들고 명령을 실행해 결과 상태를 돌려준다 (DOM 없이)
function run(
  command: StateCommand,
  doc: string,
  selection: EditorStateConfig['selection'],
  extensions: Extension[] = [],
) {
  const state = EditorState.create({ doc, selection, extensions })
  let result = state
  const ran = command({
    state,
    dispatch(tr: Transaction) {
      result = state.update(tr).state
    },
  })
  return { ran, state: result }
}

describe('toggleStrong (Mod-b)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleStrong, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('**ab**')
    const range = state.selection.main
    expect(state.sliceDoc(range.from, range.to)).toBe('ab')
  })

  it('선택 없음 — **** 삽입, 커서는 가운데', () => {
    const { state } = run(toggleStrong, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('****')
    expect(state.selection.main.head).toBe(2)
  })

  it('토글 제거 — **a** 선택 a → a', () => {
    const { state } = run(toggleStrong, '**a**', EditorSelection.single(2, 3))
    expect(state.doc.toString()).toBe('a')
    const range = state.selection.main
    expect(state.sliceDoc(range.from, range.to)).toBe('a')
  })
})

describe('toggleEmphasis (Mod-i)', () => {
  it('선택 있음 — 감싼다', () => {
    const { state } = run(toggleEmphasis, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('*ab*')
    const range = state.selection.main
    expect(state.sliceDoc(range.from, range.to)).toBe('ab')
  })

  it('선택 없음 — ** 삽입, 커서는 가운데', () => {
    const { state } = run(toggleEmphasis, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('**')
    expect(state.selection.main.head).toBe(1)
  })

  it('토글 제거 — *a* 선택 a → a', () => {
    const { state } = run(toggleEmphasis, '*a*', EditorSelection.single(1, 2))
    expect(state.doc.toString()).toBe('a')
    const range = state.selection.main
    expect(state.sliceDoc(range.from, range.to)).toBe('a')
  })

  it('**a** 의 안쪽 a 를 선택하면 바깥 * 은 ** 의 일부라 제거하지 않고 ***a*** 가 된다', () => {
    const { state } = run(toggleEmphasis, '**a**', EditorSelection.single(2, 3))
    expect(state.doc.toString()).toBe('***a***')
    const range = state.selection.main
    expect(state.sliceDoc(range.from, range.to)).toBe('a')
  })
})

describe('insertLink (Mod-k)', () => {
  it('선택 있음 — [선택]() 로 바꾸고 커서는 ( 와 ) 사이', () => {
    const { state } = run(insertLink, 'ab', EditorSelection.single(0, 2))
    expect(state.doc.toString()).toBe('[ab]()')
    expect(state.selection.main.head).toBe(5) // [ab](|)
    expect(state.selection.main.empty).toBe(true)
  })

  it('선택 없음 — []() 삽입, 커서는 [ 와 ] 사이', () => {
    const { state } = run(insertLink, '', EditorSelection.single(0))
    expect(state.doc.toString()).toBe('[]()')
    expect(state.selection.main.head).toBe(1) // [|]()
  })
})

describe('선택 2개 동시 처리', () => {
  it('toggleStrong 을 두 선택에 동시에 적용한다', () => {
    // 여러 선택 영역은 EditorState.allowMultipleSelections 가 켜져 있어야
    // EditorState.create 가 하나로 합치지 않는다 (createEditor.js 의 실제 에디터가
    // 이 확장을 켜는지와는 별개로, 명령 자체는 여러 range 를 changeByRange 로 처리한다)
    const { state } = run(
      toggleStrong,
      'x y',
      EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(2, 3)]),
      [EditorState.allowMultipleSelections.of(true)],
    )
    expect(state.doc.toString()).toBe('**x** **y**')
    expect(state.selection.ranges).toHaveLength(2)
    const [r1, r2] = state.selection.ranges
    expect(state.sliceDoc(r1.from, r1.to)).toBe('x')
    expect(state.sliceDoc(r2.from, r2.to)).toBe('y')
  })
})
