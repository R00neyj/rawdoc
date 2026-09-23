// F-294 찾기 패널을 열고 검색어를 넣어 첫 매치로 옮기기 — U5~U10. EditorView(DOM) 없이 부를 수 있게 createEditor.test.ts 25~35행과 같은 fakeView 를 쓴다(그 파일은 고치지 않는다) (specs/features/F-294.md 9.2)
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { search, searchPanelOpen, getSearchQuery } from '@codemirror/search'
import { showSearchMatches } from './showSearchMatches'

function fakeView(initial: EditorState) {
  let current = initial
  let focused = false
  const view = {
    dispatch(tr: Parameters<EditorView['dispatch']>[0]) {
      current = current.update(tr as never).state
    },
    plugin() {
      return null
    },
    focus() {
      focused = true
    },
  }
  Object.defineProperty(view, 'state', { get: () => current })
  return { view: view as unknown as EditorView, getState: () => current, isFocused: () => focused }
}

function makeView(doc: string) {
  const state = EditorState.create({ doc, extensions: [search()] })
  return fakeView(state)
}

describe('showSearchMatches', () => {
  it('U5 패널이 열리고 검색어가 들어간다', () => {
    const { view, getState } = makeView('앞부분\n오늘 회고를 썼다\n')
    const found = showSearchMatches(view, '회고')
    expect(searchPanelOpen(getState())).toBe(true)
    expect(getSearchQuery(getState()).search).toBe('회고')
    expect(found).toBe(true)
  })

  it('U6 첫 매치로 선택이 옮겨진다', () => {
    const { view, getState } = makeView('앞부분\n오늘 회고를 썼다\n')
    showSearchMatches(view, '회고')
    const state = getState()
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe('회고')
  })

  it('U7 NFD 본문 × NFC 검색어', () => {
    const { view, getState } = makeView('앞부분\n오늘 회고를 썼다\n'.normalize('NFD'))
    showSearchMatches(view, '회고')
    const state = getState()
    // NFD 문서에서 슬라이스한 글자는 코드포인트가 갈라져 있어도 화면 글자는 같다 (F-294.md 9.2 U7)
    expect(state.sliceDoc(state.selection.main.from, state.selection.main.to).normalize('NFC')).toBe('회고')
  })

  // 실측(스크래치패드에서 fakeView 로 직접 돌려 확인): 검색어 'a\nb' 는 TS 소스에서 4글자('a','\','n','b')이고 매치 길이도 4다 — 명세 9.2 표의 [0,3]과 다르다
  it('U8 literal — 백슬래시 그대로', () => {
    const { view, getState } = makeView('a\\nb 끝')
    showSearchMatches(view, 'a\\nb')
    const state = getState()
    expect(state.selection.main.from).toBe(0)
    expect(state.selection.main.to).toBe(4)
    expect(state.sliceDoc(0, 4)).toBe('a\\nb')
  })

  it('U9 매치가 없으면', () => {
    const { view, getState } = makeView('아무 상관 없는 내용')
    const found = showSearchMatches(view, '없는검색어')
    expect(found).toBe(false)
    const state = getState()
    expect(state.selection.main.from).toBe(0)
    expect(state.selection.main.to).toBe(0)
    expect(searchPanelOpen(state)).toBe(true)
  })

  it('U10 빈 검색어', () => {
    const { view, getState } = makeView('아무 내용')
    const found = showSearchMatches(view, '')
    expect(found).toBe(false)
    expect(searchPanelOpen(getState())).toBe(false)
  })
})
