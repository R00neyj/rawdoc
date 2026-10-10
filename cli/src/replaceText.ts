// replace 의 본문 바꾸기 — 대소문자를 구분하는 글자 그대로, 왼쪽부터 겹치지 않게
export const REPLACE_PREVIEW_LINES = 3
export const REPLACE_LINE_MAX_CHARS = 200
const CONTEXT_BEFORE = 40
const ELLIPSIS = '…'

export type ReplaceLine = { line: number; before: string; after: string }
export type ReplaceResult = { content: string; count: number; lines: ReplaceLine[]; changedLines: number }

function clipAt(text: string, index: number): string {
  if (text.length <= REPLACE_LINE_MAX_CHARS) return text
  let start = Math.max(0, Math.min(index - CONTEXT_BEFORE, text.length - REPLACE_LINE_MAX_CHARS))
  let end = start + REPLACE_LINE_MAX_CHARS
  const first = text.charCodeAt(start)
  const last = text.charCodeAt(end - 1)
  if (start > 0 && first >= 0xdc00 && first <= 0xdfff) start++ // 낮은 서로게이트에서 시작하지 않게
  if (end < text.length && last >= 0xd800 && last <= 0xdbff) end-- // 높은 서로게이트에서 끊지 않게
  return `${start > 0 ? ELLIPSIS : ''}${text.slice(start, end)}${end < text.length ? ELLIPSIS : ''}`
}

// find 에 줄바꿈이 없어 줄 단위 바꾸기가 전체 바꾸기와 같다 — 줄 끝 \r 은 보여 줄 때만 뗀다
export function replaceLiteral(content: string, find: string, replacement: string): ReplaceResult {
  const parts = content.split(find)
  const count = parts.length - 1
  const lines: ReplaceLine[] = []
  let changedLines = 0
  if (count > 0) {
    const rows = content.split('\n')
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i].endsWith('\r') ? rows[i].slice(0, -1) : rows[i]
      const index = row.indexOf(find)
      if (index === -1) continue
      changedLines++
      if (lines.length < REPLACE_PREVIEW_LINES) {
        lines.push({ line: i + 1, before: clipAt(row, index), after: clipAt(row.split(find).join(replacement), index) })
      }
    }
  }
  return { content: parts.join(replacement), count, lines, changedLines }
}
