// 커서·선택이 걸친 줄 번호 집합(F-104 2.2, F-105) — DOM 없이 EditorState 만으로 계산, inline.ts·lines.ts 가 함께 쓴다

import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

// 편집기 포커스 판정(F-146 3.2) — 표 칸 하위 EditorView 는 위젯 DOM 이라 물리적으로 주 view.dom 안에 있고, 위키링크 자동완성은 DOM 포커스를 옮기지 않아 "view.dom 안에 activeElement 가 있는가" 하나로 둘 다 포커스 있음으로 본다
export function isEditorFocused(view: EditorView | null | undefined): boolean {
  return !!view && view.dom.contains(view.root.activeElement)
}

// 선택 범위가 걸친 줄 전부를 "활성 줄"로 본다. 포커스 없으면 활성 줄 없음(F-146 3.2) — 커서·선택 남은 줄도 숨긴 프리뷰로 보인다
// hasFocus 기본값 true 는 포커스를 안 다루는 기존 호출부(테스트 등) 동작을 유지한다
export function activeLines(state: EditorState, hasFocus = true): Set<number> {
  if (!hasFocus) return new Set()
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

// 선택 범위 중 하나라도 [from, to] 에 닿는가(F-129 3.2·3.4) — 줄이 아닌 임의 범위(주로 Link 노드) 단위, 끝 위치 포함(커서가 정확히 to 여도 닿은 것으로 봄)
// 포커스 없으면 닿지 않은 것으로 본다(F-146 3.2). hasFocus 기본값은 activeLines 와 같은 이유
export function selectionTouches(state: EditorState, from: number, to: number, hasFocus = true): boolean {
  if (!hasFocus) return false
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true
  }
  return false
}
