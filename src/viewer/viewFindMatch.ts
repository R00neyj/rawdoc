// 보기 모드 찾기 순수 함수 — DOM·React 를 모른다 (F-2087 3.1, 5·6장)
export type ViewFindQuery = { search: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean }
export type ViewFindMatch = { block: number; from: number; to: number }
export const VIEW_FIND_LIMIT = 1000

const WORD_CHAR = /[\p{Alphabetic}\p{Number}_]/u

export function normalizeBlockText(text: string, pre: boolean): string {
  return pre ? text : text.replace(/[\n\t]/g, ' ')
}

function isWordChar(ch: string | null): boolean {
  return ch !== null && WORD_CHAR.test(ch)
}

function charBefore(text: string, i: number): string | null {
  if (i <= 0) return null
  const lo = text.charCodeAt(i - 1)
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = text.charCodeAt(i - 2)
    if (hi >= 0xd800 && hi <= 0xdbff) return text.slice(i - 2, i)
  }
  return text[i - 1]
}

function charAt(text: string, i: number): string | null {
  if (i < 0 || i >= text.length) return null
  return String.fromCodePoint(text.codePointAt(i) as number)
}

function wordBoundaryOk(text: string, from: number, to: number): boolean {
  const startOk = !isWordChar(charBefore(text, from)) || !isWordChar(charAt(text, from))
  const endOk = !isWordChar(charAt(text, to)) || !isWordChar(charBefore(text, to))
  return startOk && endOk
}

// 소문자로 바꾸면 길이가 달라지는 글자는 그대로 둔다 — 오프셋이 원문과 1:1 이어야 한다
export function foldLength(text: string): string {
  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

function unescapeSearch(search: string): string {
  return search.replace(/\\([nrt\\])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : '\\'))
}

function scanBlock(text: string, hay: string, block: number, query: ViewFindQuery, out: ViewFindMatch[], max: number, re: RegExp | null, needle: string): void {
  let pos = 0
  while (out.length < max) {
    let from: number
    let to: number
    if (re) {
      re.lastIndex = pos
      const m = re.exec(text)
      if (!m) return
      from = m.index
      to = from + m[0].length
      if (to === from) {
        pos = from + 1
        continue
      }
    } else {
      from = hay.indexOf(needle, pos)
      if (from < 0) return
      to = from + needle.length
    }
    if (query.wholeWord && !wordBoundaryOk(text, from, to)) {
      pos = from + 1
      continue
    }
    out.push({ block, from, to })
    pos = to
  }
}

export function findViewMatches(
  blocks: readonly string[], query: ViewFindQuery, limit: number = VIEW_FIND_LIMIT, folded?: readonly string[],
): { matches: ViewFindMatch[]; truncated: boolean } {
  if (query.search === '') return { matches: [], truncated: false }
  let re: RegExp | null = null
  let needle = ''
  if (query.regexp) {
    try {
      re = new RegExp(query.search, 'gmu' + (query.caseSensitive ? '' : 'i'))
    } catch {
      return { matches: [], truncated: false }
    }
  } else {
    const raw = unescapeSearch(query.search)
    needle = query.caseSensitive ? raw : foldLength(raw)
    if (needle === '') return { matches: [], truncated: false }
  }
  const out: ViewFindMatch[] = []
  const hayOf = (b: number) => (re || query.caseSensitive ? blocks[b] : (folded?.[b] ?? foldLength(blocks[b])))
  for (let b = 0; b < blocks.length && out.length <= limit; b++) scanBlock(blocks[b], hayOf(b), b, query, out, limit + 1, re, needle)
  const truncated = out.length > limit
  return { matches: truncated ? out.slice(0, limit) : out, truncated }
}

// starts 는 글자 노드마다 블록 안 시작 오프셋. 끝 쪽은 노드 경계면 앞 노드 끝을 고른다
export function locateOffset(starts: readonly number[], offset: number, side: 'start' | 'end'): { node: number; offset: number } {
  let node = 0
  for (let i = 0; i < starts.length; i++) {
    if (side === 'start' ? starts[i] <= offset : starts[i] < offset) node = i
    else break
  }
  return { node, offset: offset - (starts[node] ?? 0) }
}

export function pickStartIndex(tops: readonly number[], visibleTop: number): number {
  const i = tops.findIndex((t) => t >= visibleTop)
  return i < 0 ? 0 : i
}

export function formatFindCount(searchEmpty: boolean, current: number, total: number, truncated: boolean): string {
  if (searchEmpty) return ''
  if (total === 0) return '결과 없음'
  return `${current + 1}/${total}${truncated ? '+' : ''}`
}

export function scrollTopToReveal(input: {
  matchTop: number; matchBottom: number; viewTop: number; viewBottom: number; cover: number; scrollTop: number
}): number | null {
  const visibleTop = input.viewTop + input.cover
  if (input.matchTop >= visibleTop && input.matchBottom <= input.viewBottom) return null
  const matchMid = (input.matchTop + input.matchBottom) / 2
  const regionMid = (visibleTop + input.viewBottom) / 2
  return Math.max(0, input.scrollTop + matchMid - regionMid)
}
