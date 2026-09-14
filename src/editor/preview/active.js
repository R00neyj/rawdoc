// 커서·선택이 걸친 줄 번호 집합 (F-104 2.2, F-105 활성 줄 판정 — 판정 단위는 줄)
// DOM 없이 EditorState 만으로 계산한다. inline.js·lines.js 가 함께 쓴다

// 편집기 포커스 판정(F-146 3.2) — 표 칸 하위 EditorView 는 위젯 DOM 이라 물리적으로 주 view.dom 안에 있고, 위키링크 자동완성은 DOM 포커스를 옮기지 않아 "view.dom 안에 activeElement 가 있는가" 하나로 둘 다 포커스 있음으로 본다
export function isEditorFocused(view) {
  return !!view && view.dom.contains(view.root.activeElement)
}

/**
 * 선택 범위가 여러 줄에 걸치면 걸친 줄 전부를 "활성 줄" 로 본다.
 * 편집기 포커스가 없으면 활성 줄이 없는 것으로 본다(F-146 3.2) — 커서·선택이 남아있는
 * 줄도 숨긴 프리뷰로 보인다. hasFocus 기본값 true 는 포커스를 다루지 않는 기존
 * 호출부(테스트 등)의 동작을 그대로 유지한다.
 * @param {import('@codemirror/state').EditorState} state
 * @param {boolean} [hasFocus]
 * @returns {Set<number>} 1부터 시작하는 줄 번호 집합
 */
export function activeLines(state, hasFocus = true) {
  if (!hasFocus) return new Set()
  const lines = new Set()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

/**
 * 선택 범위 중 하나라도 [from, to] 에 닿는가 (F-129 3.2·3.4).
 * 줄이 아니라 임의의 범위(주로 Link 노드 [from, to]) 단위 판정이다.
 * 끝 위치 포함 — 커서가 정확히 `to` 에 있어도(예: `)` 바로 뒤) 닿은 것으로 본다.
 * 편집기 포커스가 없으면 닿지 않은 것으로 본다(F-146 3.2). hasFocus 기본값은
 * activeLines 와 같은 이유다.
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} from
 * @param {number} to
 * @param {boolean} [hasFocus]
 * @returns {boolean}
 */
export function selectionTouches(state, from, to, hasFocus = true) {
  if (!hasFocus) return false
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true
  }
  return false
}
