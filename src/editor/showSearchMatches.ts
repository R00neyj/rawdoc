// 검색 결과로 연 문서에 검색어 넘기기 — CM6 찾기 패널을 열고 검색어를 넣는다. @codemirror/search 를 아는 코드는 이 파일에 모은다 (specs/features/F-294.md 5.2)
import { findNext, openSearchPanel, SearchQuery, setSearchQuery } from '@codemirror/search'
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
