// 검색 결과로 연 문서에 검색어 넘기기 — CM6 찾기 패널을 열고 검색어를 넣는다. @codemirror/search 를 아는 코드는 이 파일에 모은다 (specs/features/F-294.md 5.2)
import { closeSearchPanel, findNext, getSearchQuery, openSearchPanel, SearchQuery, searchPanelOpen, setSearchQuery } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'

// 찾기 패널을 열고 검색어를 넣어 매치를 강조한 뒤 첫 매치로 옮긴다. 포커스는 본문으로 되돌리고, 매치를 찾았으면 true (F-294.md 4.4)
export function showSearchMatches(view: EditorView, term: string): boolean {
  if (term === '') return false

  openSearchPanel(view) // 패널을 먼저 연다 — 없으면 강조가 안 그려진다 (3.1)
  view.dispatch({
    effects: setSearchQuery.of(new SearchQuery({ search: term, caseSensitive: false, literal: true })),
  }) // openSearchPanel 의 defaultQuery 와 순서가 겹치지 않게 별도 dispatch (3.3)
  const found = findNext(view)
  view.focus() // 패널 입력이 아니라 본문으로 포커스를 되돌린다 (F-287 A8·A9 회귀 보호)
  return found
}

type ViewFindQueryLike = { search: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }

// 패널이 열려 있으면 지금 질의, 닫혀 있으면 null — 보기 모드 찾기가 이어받는다 (F-2087 7장)
export function readSearchPanel(view: EditorView): ViewFindQueryLike | null {
  if (!searchPanelOpen(view.state)) return null
  const { search, caseSensitive, regexp, wholeWord } = getSearchQuery(view.state)
  return { search, caseSensitive, regexp, wholeWord }
}

// 질의로 패널을 열고 맞추거나(null 이면 닫는다). 선택·스크롤·포커스는 옮기지 않고 치환어는 그대로 둔다 (F-2087 3.5)
export function syncSearchPanel(view: EditorView, query: ViewFindQueryLike | null): void {
  if (query === null) {
    closeSearchPanel(view)
    return
  }
  const wasOpen = searchPanelOpen(view.state)
  const prevFocus = typeof document === 'undefined' ? null : document.activeElement
  if (!wasOpen) openSearchPanel(view)
  if (!wasOpen && prevFocus && document.activeElement !== prevFocus) (prevFocus as HTMLElement).focus() // 새 패널이 가져간 포커스를 돌린다
  const replace = getSearchQuery(view.state).replace
  view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ ...query, replace })) })
}
