import { afterEach, describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { arrowReplace, arrowReplaceBackspace, arrowReplaceInput, setArrowReplace } from '../../../src/editor/arrowReplace'
import { frontmatterExtension } from '../../../src/editor/frontmatter'

function makeState(doc: string, pos = doc.length) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(pos),
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }), arrowReplace()],
  })
}

function typeChar(state: EditorState, ch: string): EditorState {
  const { from, to } = state.selection.main
  const spec = arrowReplaceInput(state, from, to, ch)
  if (spec) return state.update(spec).state
  return state.update({ changes: { from, to, insert: ch }, selection: EditorSelection.cursor(from + ch.length), userEvent: 'input.type' }).state
}

afterEach(() => setArrowReplace(true))

describe('-> 를 → 로 바꾸기', () => {
  it('- 뒤에 > 를 치면 → 한 글자가 되고 커서는 그 뒤', () => {
    const state = typeChar(makeState('a -'), '>')
    expect(state.doc.toString()).toBe('a →')
    expect(state.selection.main.head).toBe(3)
  })

  it('앞 글자가 - 가 아니면, 또는 --> 이면 그대로', () => {
    expect(typeChar(makeState('a '), '>').doc.toString()).toBe('a >')
    expect(typeChar(makeState('<!-- a --'), '>').doc.toString()).toBe('<!-- a -->')
  })

  it('인라인 코드·코드 블록·프론트매터 안에서는 바꾸지 않는다', () => {
    expect(typeChar(makeState('`a -`', 4), '>').doc.toString()).toBe('`a ->`')
    expect(typeChar(makeState('```\na -\n```', 7), '>').doc.toString()).toBe('```\na ->\n```')
    expect(typeChar(makeState('---\na: -\n---\n', 8), '>').doc.toString()).toBe('---\na: ->\n---\n')
  })

  it('선택 범위가 있거나 여러 커서면 그대로', () => {
    const selected = EditorState.create({ doc: 'a -x', selection: EditorSelection.single(3, 4), extensions: [markdown(), arrowReplace()] })
    expect(arrowReplaceInput(selected, 3, 4, '>')).toBeNull()
    const multi = EditorState.create({
      doc: '-\n-',
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
      extensions: [EditorState.allowMultipleSelections.of(true), markdown(), arrowReplace()],
    })
    expect(arrowReplaceInput(multi, 1, 1, '>')).toBeNull()
  })

  it('설정을 끄면 바꾸지 않는다', () => {
    setArrowReplace(false)
    expect(typeChar(makeState('a -'), '>').doc.toString()).toBe('a ->')
  })

  it('바꾼 바로 뒤 Backspace 는 -> 로 되돌린다', () => {
    const replaced = typeChar(makeState('a -'), '>')
    const spec = arrowReplaceBackspace(replaced)
    expect(spec).not.toBeNull()
    const back = replaced.update(spec!).state
    expect(back.doc.toString()).toBe('a ->')
    expect(back.selection.main.head).toBe(4)
  })

  it('다른 글자를 치거나 커서를 옮긴 뒤 Backspace 는 기본 삭제', () => {
    const typed = typeChar(typeChar(makeState('a -'), '>'), ' ')
    expect(arrowReplaceBackspace(typed)).toBeNull()
    const replaced = typeChar(makeState('a -'), '>')
    const moved = replaced.update({ selection: EditorSelection.cursor(0) }).state.update({ selection: EditorSelection.cursor(3) }).state
    expect(arrowReplaceBackspace(moved)).toBeNull()
    expect(arrowReplaceBackspace(makeState('a →'))).toBeNull()
  })
})
