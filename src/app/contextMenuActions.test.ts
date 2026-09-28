import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'

import {
  contextMenuCommentOption,
  contextMenuSelectionText,
  entersTableAfterCommand,
  pickClipboardPaste,
  replaceSelectionChanges,
} from './contextMenuActions'

function makeState(doc: string, ranges: [number, number][]) {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(ranges.map(([a, h]) => EditorSelection.range(a, h))),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  })
}

describe('contextMenuCommentOption (F-2061 A3)', () => {
  it('U1 댓글 값이 없으면 항목이 없다', () => {
    expect(contextMenuCommentOption(null, 'editor')).toBeUndefined()
    expect(contextMenuCommentOption(undefined, 'editor')).toBeUndefined()
  })

  it('U2 access none 이면 항목이 없다', () => {
    expect(contextMenuCommentOption({ access: { kind: 'none' }, canWrite: true }, 'editor')).toBeUndefined()
  })

  it('U3 none 이 아니고 쓸 수 있으면 활성', () => {
    expect(contextMenuCommentOption({ access: { kind: 'read' }, canWrite: true }, 'editor')).toEqual({ disabled: false })
  })

  it('U4 쓸 수 없거나 칸이면 비활성', () => {
    expect(contextMenuCommentOption({ access: { kind: 'read' }, canWrite: false }, 'editor')).toEqual({ disabled: true })
    expect(contextMenuCommentOption({ access: { kind: 'read' }, canWrite: true }, 'cell')).toEqual({ disabled: true })
  })
})

describe('contextMenuSelectionText (F-2061 A3)', () => {
  it('U5 선택 범위 글자를 \\n 으로 잇는다', () => {
    expect(contextMenuSelectionText(makeState('ab cd', [[0, 2]]))).toBe('ab')
    expect(contextMenuSelectionText(makeState('ab cd', [[0, 2], [3, 5]]))).toBe('ab\ncd')
    expect(contextMenuSelectionText(makeState('ab cd', [[1, 1]]))).toBe('')
  })
})

describe('replaceSelectionChanges (F-2061 A3)', () => {
  it('U6 범위 순서대로 insert 값 그대로', () => {
    const state = makeState('ab cd', [[0, 2], [3, 5]])
    expect(replaceSelectionChanges(state, 'X')).toEqual([
      { from: 0, to: 2, insert: 'X' },
      { from: 3, to: 5, insert: 'X' },
    ])
    expect(replaceSelectionChanges(state, '')).toEqual([
      { from: 0, to: 2, insert: '' },
      { from: 3, to: 5, insert: '' },
    ])
  })
})

describe('pickClipboardPaste (F-2061 A3)', () => {
  it('U7 글자가 이미지보다 우선', () => {
    expect(pickClipboardPaste([['image/png'], ['text/html', 'text/plain']], 'editor')).toEqual({ kind: 'text', index: 1 })
  })

  it('U8 편집 모드는 첫 이미지 항목의 첫 이미지 타입', () => {
    expect(pickClipboardPaste([['text/html'], ['image/webp', 'image/png']], 'editor')).toEqual({
      kind: 'image',
      index: 1,
      type: 'image/webp',
      fileName: 'pasted.webp',
    })
  })

  it('U9 칸·보기는 이미지만 있으면 null', () => {
    expect(pickClipboardPaste([['image/png']], 'cell')).toBeNull()
    expect(pickClipboardPaste([['image/png']], 'view')).toBeNull()
  })

  it('U10 쓸 것이 없으면 null', () => {
    expect(pickClipboardPaste([], 'editor')).toBeNull()
    expect(pickClipboardPaste([['text/html']], 'editor')).toBeNull()
  })
})

describe('entersTableAfterCommand (F-2061 A3)', () => {
  it('U11 표 삽입·편집·live 면 true', () => {
    expect(entersTableAfterCommand({ isInsertTable: true, place: 'editor', dataView: 'live' })).toBe(true)
  })

  it('U12 하나라도 다르면 false', () => {
    expect(entersTableAfterCommand({ isInsertTable: false, place: 'editor', dataView: 'live' })).toBe(false)
    expect(entersTableAfterCommand({ isInsertTable: true, place: 'cell', dataView: 'live' })).toBe(false)
    expect(entersTableAfterCommand({ isInsertTable: true, place: 'editor', dataView: 'source' })).toBe(false)
    expect(entersTableAfterCommand({ isInsertTable: true, place: 'editor', dataView: undefined })).toBe(false)
  })
})
