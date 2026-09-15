// YAML 프론트매터 범위 찾기·단순 속성 해석 (specs/features/F-133.md 3.1·3.3)
// 순수 함수. DOM·CM6·markdown-it 을 다루지 않는다 — editor/frontmatter.js(블록 파서),
// editor/preview/lines.js(줄 클래스), viewer/renderMarkdown.js(속성 표) 가 각자 쓴다.
// YAML 해석 라이브러리는 쓰지 않는다 (F-133 2장) — 여기 규칙이 전부다

const OPEN_RE = /^---[ \t]*$/
const CLOSE_RE = /^(---|\.\.\.)[ \t]*$/

/**
 * 줄 끝(터미네이터) 앞의 실제 내용 끝 위치. lineEnd 는 '\n' 의 위치다.
 * CRLF 면 그 앞 '\r' 도 뗀다.
 */
function lineContentEnd(text, lineEnd) {
  return lineEnd > 0 && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd
}

/**
 * 문서 맨 앞 YAML 프론트매터 범위를 찾는다 (F-133 3.1).
 * - 문서 첫 줄이 정확히 `---` (뒤 공백 허용)
 * - 그 뒤 줄 중 처음으로 정확히 `---` 또는 `...` (뒤 공백 허용)인 줄까지가 프론트매터
 * - 닫는 줄이 없으면 null. 첫 줄 앞 빈 줄이 있으면(=문서가 빈 줄로 시작하면) null
 * - LF·CRLF 모두 지원
 * @param {string} text 문서 원문 그대로 (decodeMarkdown 이 처리한 뒤 — BOM 없음)
 * @returns {{from:number, to:number, contentFrom:number, contentTo:number, closeMark:'---'|'...'} | null}
 *   from: 0. to: 닫는 줄 내용 끝(터미네이터 제외). contentFrom: 여는 줄 다음 줄의 시작.
 *   contentTo: 닫는 줄의 시작(=본문 내용의 끝, 그 직전 줄의 터미네이터 포함)
 */
export function findFrontmatter(text) {
  if (text.length === 0) return null

  const firstBreak = text.indexOf('\n')
  if (firstBreak === -1) return null // 줄바꿈이 없으면 닫는 줄이 있을 수 없다

  const firstLine = text.slice(0, lineContentEnd(text, firstBreak))
  if (!OPEN_RE.test(firstLine)) return null

  const contentFrom = firstBreak + 1
  let pos = contentFrom

  while (pos <= text.length) {
    const nextBreak = text.indexOf('\n', pos)
    const hasNext = nextBreak !== -1
    const rawEnd = hasNext ? nextBreak : text.length
    const contentEnd = hasNext ? lineContentEnd(text, nextBreak) : rawEnd
    const lineText = text.slice(pos, contentEnd)

    const closeMatch = CLOSE_RE.exec(lineText)
    if (closeMatch) {
      return {
        from: 0,
        to: contentEnd,
        contentFrom,
        contentTo: pos,
        closeMark: closeMatch[1],
      }
    }

    if (!hasNext) break // 닫는 줄 없이 문서가 끝났다
    pos = nextBreak + 1
  }

  return null
}

/** [from, to) 바로 뒤에 오는 줄 종결자(\r\n 또는 \n)를 건너뛴 위치. 문서 끝이면 to 그대로 */
function skipLineBreak(text, pos) {
  if (text[pos] === '\r' && text[pos + 1] === '\n') return pos + 2
  if (text[pos] === '\n') return pos + 1
  return pos
}

/**
 * 프론트매터를 뗀 나머지 본문. `findFrontmatter` 가 돌려준 범위를 그대로 받는다.
 * @param {string} text
 * @param {{to:number}} frontmatter findFrontmatter(text) 결과 (null 아님)
 * @returns {string}
 */
export function textAfterFrontmatter(text, frontmatter) {
  return text.slice(skipLineBreak(text, frontmatter.to))
}

const LIST_ITEM_RE = /^[ \t]+-[ \t]+(.*)$/
const KEY_VALUE_RE = /^([^\s:#][^:]*):[ \t]*(.*)$/

/** 앞뒤 공백을 뗀 값의 감싼 따옴표(" 또는 ') 한 쌍을 뗀다 */
function stripQuotes(value) {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
  }
  return value
}

/**
 * 프론트매터 내용을 `키: 값` 목록으로 해석한다 (F-133 3.3). YAML 전체를 해석하지 않는다 —
 * 아래 단순 규칙만 인정하고, 그 밖의 모양(중첩 들여쓰기, 여러 줄 문자열 등)이 하나라도
 * 있으면 실패(null)다.
 * @param {string} content findFrontmatter 의 contentFrom~contentTo 원문
 * @returns {{key:string, value:string|string[]}[] | null} 성공하면 배열(속성이 하나도
 *   없으면 빈 배열 — "빈 프론트매터" 는 이 값으로 구분한다). 구조를 알아볼 수 없으면 null
 */
export function parseSimpleProperties(content) {
  const lines = content.split(/\r\n|\r|\n/)
  const result = []
  let lastEntry = null

  for (const rawLine of lines) {
    if (rawLine.trim() === '') continue // 빈 줄은 검사하지 않는다

    if (/^[ \t]/.test(rawLine)) {
      // 들여쓴 줄 — 바로 앞 키의 목록 항목(`  - 값`)일 때만 허용한다
      const listMatch = LIST_ITEM_RE.exec(rawLine)
      if (!listMatch || !lastEntry) return null
      if (!Array.isArray(lastEntry.value)) lastEntry.value = []
      lastEntry.value.push(stripQuotes(listMatch[1].trim()))
      continue
    }

    if (rawLine.startsWith('#')) continue // 주석 줄

    const match = KEY_VALUE_RE.exec(rawLine)
    if (!match) return null // 키: 값 형식도, 목록 항목도 아니다

    const entry = { key: match[1].trim(), value: stripQuotes(match[2].trim()) }
    result.push(entry)
    lastEntry = entry
  }

  return result
}
