// /v1/search 의 매칭 줄 추출 — 대소문자는 SQLite lower() 처럼 영문만 접는다
export const SEARCH_MAX_QUERY_CHARS = 200
export const SEARCH_MAX_DOCS = 200
export const SEARCH_LINE_MAX_CHARS = 200
export const SEARCH_LINES_PER_DOC = 5

export type SearchLine = { line: number; text: string }

const ELLIPSIS = '…'

// 영문 대문자만 소문자로 — 길이가 그대로라 접은 문자열의 위치가 원문 위치다
export function foldAscii(value: string): string {
  return value.replace(/[A-Z]+/g, (run) => run.toLowerCase())
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff

// 첫 매칭을 가운데 두고 … 까지 합쳐 max 자 안쪽으로 자른다
function clipAround(line: string, index: number, queryLength: number, max: number): string {
  if (line.length <= max) return line
  const inner = max - 2 * ELLIPSIS.length
  let start = Math.max(0, index - Math.max(0, Math.floor((inner - queryLength) / 2)))
  let end = Math.min(line.length, start + inner)
  start = Math.max(0, end - inner)
  if (start > 0 && isLowSurrogate(line.charCodeAt(start))) start++
  if (end < line.length && isHighSurrogate(line.charCodeAt(end - 1))) end--
  return `${start > 0 ? ELLIPSIS : ''}${line.slice(start, end)}${end < line.length ? ELLIPSIS : ''}`
}

export function findMatchingLines(content: string, query: string): { lines: SearchLine[]; matchedLines: number } {
  const needle = foldAscii(query)
  const lines: SearchLine[] = []
  let matchedLines = 0
  const rows = content.split('\n')
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].endsWith('\r') ? rows[i].slice(0, -1) : rows[i]
    const index = foldAscii(row).indexOf(needle)
    if (index === -1) continue
    matchedLines++
    if (lines.length < SEARCH_LINES_PER_DOC) {
      lines.push({ line: i + 1, text: clipAround(row, index, needle.length, SEARCH_LINE_MAX_CHARS) })
    }
  }
  return { lines, matchedLines }
}
