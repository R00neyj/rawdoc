// 줄·열·글자·단어 수 — 순수 함수 (specs/features/F-113.md 2.1)
// CM6 EditorState 나 문자열만 받는다. DOM 을 다루지 않는다

/**
 * 주 선택의 head 기준 줄·열. col 은 줄 시작부터 head 까지의 코드포인트 수 + 1.
 * head 는 CM6 내부에서 UTF-16 코드 유닛 offset 이라 이모지 등 서로게이트 쌍을
 * 코드포인트 1개로 세려면 스프레드로 순회해야 한다
 * @param {import('@codemirror/state').EditorState} state
 * @returns {{line:number, col:number}}
 */
export function cursorInfo(state) {
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const before = line.text.slice(0, head - line.from)
  const col = [...before].length + 1
  return { line: line.number, col }
}

/** 줄바꿈 문자(\r \n)를 뺀 코드포인트 수. 공백 포함 */
export function countChars(text) {
  return [...text.replace(/[\r\n]/g, '')].length
}

/** 공백류(\s)로 나눈 비어 있지 않은 덩어리 수 */
export function countWords(text) {
  return text.split(/\s+/).filter((chunk) => chunk.length > 0).length
}
