import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { YSyncConfig } from 'y-codemirror.next'

import { toEditorText } from '../lib/lineEnding'
import { createYBinding, redoLocal, undoLocal } from './yBinding'
import type { YBinding } from './yBinding'

function stateOf(binding: YBinding, readOnly = false) {
  return EditorState.create({
    doc: binding.ytext.toString(),
    extensions: [binding.extension, EditorState.readOnly.of(readOnly)],
  })
}

function run(command: typeof undoLocal, state: EditorState) {
  return command({ state, dispatch: () => {} })
}

// ySync 가 로컬 편집을 넣는 것과 같은 origin — yUndoManager 플러그인이 하는 addTrackedOrigin 을 대신한다
function typeLocally(binding: YBinding, index: number, text: string) {
  const origin = new YSyncConfig(binding.ytext, null)
  binding.undoManager.addTrackedOrigin(origin)
  binding.ydoc.transact(() => binding.ytext.insert(index, text), origin)
}

const bigDoc = '가나다 abc 라마바\r\n'.repeat(Math.ceil(1_000_000 / 14)).slice(0, 1_000_000)

describe('F-302 A1 씨앗은 LF 만 담는다', () => {
  const inputs = ['', 'a', 'a\nb', 'a\r\nb\r\n', 'a\rb', 'a\r\nb\nc\rd', bigDoc]
  for (const input of inputs) {
    it(JSON.stringify(input.slice(0, 20)) + ` (${input.length}자)`, () => {
      const binding = createYBinding(input)
      const seeded = binding.ytext.toString()
      expect(seeded).toBe(toEditorText(input))
      expect(seeded.includes('\r')).toBe(false)
      expect(EditorState.create({ doc: seeded }).doc.length).toBe(binding.ytext.length)
      binding.destroy()
    })
  }
})

describe('F-302 A2 씨앗은 실행 취소 대상이 아니다', () => {
  it('만든 직후 undoStack 이 비고 undoLocal 이 false, 본문 그대로', () => {
    const binding = createYBinding('본문\r\n둘째 줄')
    expect(binding.undoManager.undoStack.length).toBe(0)
    expect(run(undoLocal, stateOf(binding))).toBe(false)
    expect(binding.ytext.toString()).toBe('본문\n둘째 줄')
    binding.destroy()
  })
})

describe('F-302 A4 읽기 전용', () => {
  it('되돌릴 것이 있어도 undoLocal·redoLocal 이 false 이고 아무것도 바뀌지 않는다', () => {
    const binding = createYBinding('ab')
    typeLocally(binding, 2, 'c')
    binding.undoManager.stopCapturing()
    typeLocally(binding, 3, 'd')
    binding.undoManager.undo()
    expect(binding.ytext.toString()).toBe('abc')
    const undoDepth = binding.undoManager.undoStack.length
    const redoDepth = binding.undoManager.redoStack.length
    expect(undoDepth).toBe(1)
    expect(redoDepth).toBe(1)

    const readOnlyState = stateOf(binding, true)
    expect(run(undoLocal, readOnlyState)).toBe(false)
    expect(run(redoLocal, readOnlyState)).toBe(false)
    expect(binding.ytext.toString()).toBe('abc')
    expect(binding.undoManager.undoStack.length).toBe(undoDepth)
    expect(binding.undoManager.redoStack.length).toBe(redoDepth)
    binding.destroy()
  })
})

describe('F-302 A5 로컬 origin 편집 되돌리기·다시 실행', () => {
  it('한 글자 넣은 뒤 undoLocal 로 씨앗 값, redoLocal 로 한 글자가 돌아온다', () => {
    const binding = createYBinding('본문')
    typeLocally(binding, 2, 'x')
    expect(binding.ytext.toString()).toBe('본문x')

    expect(run(undoLocal, stateOf(binding))).toBe(true)
    expect(binding.ytext.toString()).toBe('본문')
    expect(run(redoLocal, stateOf(binding))).toBe(true)
    expect(binding.ytext.toString()).toBe('본문x')
    binding.destroy()
  })

  it('yBinding 을 안 붙인 state 에서는 둘 다 false', () => {
    const state = EditorState.create({ doc: 'a' })
    expect(run(undoLocal, state)).toBe(false)
    expect(run(redoLocal, state)).toBe(false)
  })
})

describe('F-302 A6 버리기', () => {
  it('destroy 뒤 ydoc.isDestroyed, 두 번 불러도 던지지 않는다', () => {
    const binding = createYBinding('a')
    binding.destroy()
    expect(binding.ydoc.isDestroyed).toBe(true)
    expect(() => binding.destroy()).not.toThrow()
  })
})
