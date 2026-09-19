// A2 줄바꿈 보존 (specs/features/F-103.md 3.1·4장)
// createEditor() 는 EditorView(DOM) 를 만들어 jsdom 없는 환경(vitest environment: node)에서
// 직접 실행할 수 없다. 이 테스트는 createEditor.ts 의 getText() 가 기대는 전제 —
// EditorState.lineSeparator 를 지정하지 않으면 CM6 가 \r\n·\r·\n 을 모두 줄 구분으로
// 읽고, sliceString(0, len, sep) 으로 원하는 구분자로 다시 이을 수 있다는 것 — 을 확인한다
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { replaceAll, search, SearchQuery, setSearchQuery } from '@codemirror/search'

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

// EditorView(DOM) 없이 replaceAll() 을 직접 부를 수 있게 state 만 갖는 최소 view 흉내를 만든다 (F-261 A3)
function fakeView(initial: EditorState) {
  let current = initial
  const view = {
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      current = current.update(tr as never).state
    },
  }
  Object.defineProperty(view, 'state', { get: () => current })
  return { view: view as unknown as EditorView, getState: () => current }
}

describe('찾기·바꾸기 읽기 전용 (F-261 A3)', () => {
  it('읽기 전용 상태에서는 모두 바꾸기가 문서를 바꾸지 않는다', () => {
    const state = EditorState.create({
      doc: 'foo foo',
      extensions: [search(), EditorState.readOnly.of(true)],
    })
    const { view, getState } = fakeView(state)
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'foo', replace: 'bar' })) })

    const changed = replaceAll(view)

    expect(changed).toBe(false)
    expect(getState().doc.toString()).toBe('foo foo')
  })

  it('일반(읽기 전용 아님) 상태에서는 모두 바꾸기가 문서를 바꾼다', () => {
    const state = EditorState.create({
      doc: 'foo foo',
      extensions: [search()],
    })
    const { view, getState } = fakeView(state)
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: 'foo', replace: 'bar' })) })

    const changed = replaceAll(view)

    expect(changed).toBe(true)
    expect(getState().doc.toString()).toBe('bar bar')
  })
})
