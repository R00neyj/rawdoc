// active.js 단위 테스트 (specs/features/F-104.md 2.2, specs/features/F-129.md 3.4)
import { describe, expect, it } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import { activeLines, selectionTouches } from './active.js'

function stateWithSelection(doc, anchor, head) {
  return EditorState.create({ doc, selection: { anchor, head } })
}

describe('activeLines', () => {
  it('커서 하나는 그 줄 번호만 담는다', () => {
    const state = stateWithSelection('one\ntwo\nthree', 5, 5)
    expect(activeLines(state)).toEqual(new Set([2]))
  })

  it('같은 줄 안의 선택은 그 줄 번호만 담는다', () => {
    const state = stateWithSelection('one\ntwo\nthree', 4, 6)
    expect(activeLines(state)).toEqual(new Set([2]))
  })

  it('여러 줄에 걸친 선택은 걸친 줄 전부를 담는다', () => {
    const state = stateWithSelection('one\ntwo\nthree', 1, 6)
    expect(activeLines(state)).toEqual(new Set([1, 2]))
  })

  it('여러 개의 선택 범위는 모두 합쳐진다', () => {
    const state = EditorState.create({
      doc: 'one\ntwo\nthree',
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(9)], 0),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    expect(activeLines(state)).toEqual(new Set([1, 3]))
  })
})

describe('selectionTouches', () => {
  it('커서가 범위 안에 있으면 닿은 것으로 본다', () => {
    const state = stateWithSelection('0123456789', 5, 5)
    expect(selectionTouches(state, 2, 8)).toBe(true)
  })

  it('커서가 범위의 시작 위치(from)에 있어도 닿은 것으로 본다', () => {
    const state = stateWithSelection('0123456789', 2, 2)
    expect(selectionTouches(state, 2, 8)).toBe(true)
  })

  it('커서가 범위의 끝 위치(to)에 있어도 닿은 것으로 본다 (예: `)` 바로 뒤)', () => {
    const state = stateWithSelection('0123456789', 8, 8)
    expect(selectionTouches(state, 2, 8)).toBe(true)
  })

  it('선택이 범위와 겹치면 닿은 것으로 본다', () => {
    const state = stateWithSelection('0123456789', 0, 4)
    expect(selectionTouches(state, 2, 8)).toBe(true)
  })

  it('범위 밖의 커서는 닿지 않은 것으로 본다', () => {
    const state = stateWithSelection('0123456789', 9, 9)
    expect(selectionTouches(state, 2, 8)).toBe(false)
  })

  it('여러 선택 범위 중 하나만 닿아도 true 다', () => {
    const state = EditorState.create({
      doc: '0123456789',
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)], 0),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    })
    expect(selectionTouches(state, 2, 8)).toBe(true)
  })
})
