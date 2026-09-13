// A2 줄바꿈 보존 (specs/features/F-103.md 3.1·4장)
// createEditor() 는 EditorView(DOM) 를 만들어 jsdom 없는 환경(vitest environment: node)에서
// 직접 실행할 수 없다. 이 테스트는 createEditor.js 의 getText() 가 기대는 전제 —
// EditorState.lineSeparator 를 지정하지 않으면 CM6 가 \r\n·\r·\n 을 모두 줄 구분으로
// 읽고, sliceString(0, len, sep) 으로 원하는 구분자로 다시 이을 수 있다는 것 — 을 확인한다
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'

describe('줄바꿈 보존', () => {
  it('CRLF 원문 → CRLF 로 이으면 원문과 바이트가 같다', () => {
    const original = 'a\r\nb\r\n'
    const state = EditorState.create({ doc: original })
    expect(state.doc.sliceString(0, state.doc.length, '\r\n')).toBe(original)
  })

  it('LF 원문 → LF 로 이으면 원문과 바이트가 같다', () => {
    const original = 'a\nb'
    const state = EditorState.create({ doc: original })
    expect(state.doc.sliceString(0, state.doc.length, '\n')).toBe(original)
  })
})
