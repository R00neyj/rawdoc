// active.js 단위 테스트 (specs/features/F-104.md 2.2, specs/features/F-129.md 3.4)
import { describe, expect, it } from 'vitest'
import { EditorState, EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { activeLines, isEditorFocused, selectionTouches } from './active'

function stateWithSelection(doc: string, anchor: number, head: number) {
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

  it('편집기 포커스가 없으면(hasFocus=false) 커서가 있어도 활성 줄이 빈 집합이다 (F-146 3.2)', () => {
    const state = stateWithSelection('one\ntwo\nthree', 5, 5)
    expect(activeLines(state, false)).toEqual(new Set())
  })

  it('편집기 포커스가 있으면(hasFocus=true) 지금 결과와 같다 (F-146 3.2)', () => {
    const state = stateWithSelection('one\ntwo\nthree', 5, 5)
    expect(activeLines(state, true)).toEqual(new Set([2]))
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

  it('편집기 포커스가 없으면(hasFocus=false) 닿는 커서여도 false 다 (F-146 3.2)', () => {
    const state = stateWithSelection('0123456789', 5, 5)
    expect(selectionTouches(state, 2, 8, false)).toBe(false)
  })

  it('편집기 포커스가 있으면(hasFocus=true) 지금 결과와 같다 (F-146 3.2)', () => {
    const state = stateWithSelection('0123456789', 5, 5)
    expect(selectionTouches(state, 2, 8, true)).toBe(true)
  })
})

describe('isEditorFocused', () => {
  it('view 가 없으면 false 다', () => {
    expect(isEditorFocused(null)).toBe(false)
    expect(isEditorFocused(undefined)).toBe(false)
  })

  it('view.dom 이 root.activeElement 를 담고 있으면 true 다', () => {
    const active = {}
    const view = { dom: { contains: (el: unknown) => el === active }, root: { activeElement: active } } as unknown as EditorView
    expect(isEditorFocused(view)).toBe(true)
  })

  it('view.dom 이 root.activeElement 를 담고 있지 않으면 false 다', () => {
    const view = { dom: { contains: () => false }, root: { activeElement: {} } } as unknown as EditorView
    expect(isEditorFocused(view)).toBe(false)
  })
})
