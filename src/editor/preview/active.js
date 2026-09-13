// 커서·선택이 걸친 줄 번호 집합 (F-104 2.2, F-105 활성 줄 판정 — 판정 단위는 줄)
// DOM 없이 EditorState 만으로 계산한다. inline.js·lines.js 가 함께 쓴다

/**
 * 선택 범위가 여러 줄에 걸치면 걸친 줄 전부를 "활성 줄" 로 본다.
 * @param {import('@codemirror/state').EditorState} state
 * @returns {Set<number>} 1부터 시작하는 줄 번호 집합
 */
export function activeLines(state) {
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
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
export function selectionTouches(state, from, to) {
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true
  }
  return false
}
