// 문서 검색 — 쿼리 파싱·매칭·발췌 순수 함수. 입력이 이미 NFC 로 정규화됐다고 믿는다(검색어는 parseSearchQuery 가, 문서는 F-286 이 한다) (specs/features/F-285.md, import 문 0개)

// ── 상수 (F-284 4.3) ──────────────────────────────────────
export const SNIPPET_BEFORE = 30
export const SNIPPET_AFTER = 70
export const RESULT_LIMIT = 200

// ── 정규화 ────────────────────────────────────────────────

export function normalizeForSearch(text: string): string {
  return text.normalize('NFC')
}

// toLowerCase() 로 길이가 달라지는 글자('İ' 등, 5.1)는 원래 글자를 그대로 둬 위치가 밀리지 않게 한다
export function foldCase(text: string): string {
  const fast = text.toLowerCase()
  if (fast.length === text.length) return fast

  let out = ''
  for (const ch of text) {
    const lower = ch.toLowerCase()
    out += lower.length === ch.length ? lower : ch
  }
  return out
}

// ── 쿼리 파싱 (4장) ──────────────────────────────────────

export type QueryFilter = { key: string; value: string }
export type ParsedQuery = {
  raw: string
  terms: string[]
  filters: QueryFilter[]
  isEmpty: boolean
}

const SEPARATOR_RE = /\s/
const KEY_RE = /^[A-Za-z0-9가-힣_-]+$/

type RawToken = { text: string; quotedAtStart: boolean }

// 한 글자씩 훑는 스캐너. 정규식으로 쪼개지 않는다 — 따옴표 상태를 들고 있어야 한다 (4.1)
function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = []
  const n = input.length
  let i = 0

  while (i < n) {
    while (i < n && SEPARATOR_RE.test(input[i])) i++
    if (i >= n) break

    const quotedAtStart = input[i] === '"'
    let text = ''
    let inQuotes = false

    while (i < n) {
      const ch = input[i]
      if (ch === '"') {
        inQuotes = !inQuotes
        i++
        continue
      }
      if (!inQuotes && SEPARATOR_RE.test(ch)) break
      text += ch
      i++
    }

    if (text !== '') tokens.push({ text, quotedAtStart })
  }

  return tokens
}

// quotedAtStart 가 아닌 토큰만 후보다. 첫 ':' 앞을 키, 뒤 전부를 값으로 본다 (4.2)
function tryParseFilter(text: string): { key: string; value: string } | null {
  const colonIdx = text.indexOf(':')
  if (colonIdx <= 0) return null
  const key = text.slice(0, colonIdx)
  const value = text.slice(colonIdx + 1)
  if (!KEY_RE.test(key)) return null
  if (value.startsWith('//')) return null
  return { key, value }
}

export function parseSearchQuery(raw: string): ParsedQuery {
  const normalized = normalizeForSearch(raw)
  const tokens = tokenize(normalized)

  const terms: string[] = []
  const filters: QueryFilter[] = []
  const seenTerms = new Set<string>()
  const seenFilters = new Set<string>()

  for (const { text, quotedAtStart } of tokens) {
    const filter = quotedAtStart ? null : tryParseFilter(text)
    if (filter) {
      const key = foldCase(filter.key).trim()
      const value = foldCase(filter.value).trim()
      const dedupeKey = `${key}\u0000${value}`
      if (!seenFilters.has(dedupeKey)) {
        seenFilters.add(dedupeKey)
        filters.push({ key, value })
      }
      continue
    }

    const term = foldCase(text)
    if (!seenTerms.has(term)) {
      seenTerms.add(term)
      terms.push(term)
    }
  }

  return { raw, terms, filters, isEmpty: terms.length === 0 && filters.length === 0 }
}

// ── 속성 매칭 (6장) ──────────────────────────────────────

export type SearchProperty = { key: string; value: string | string[] }
export type SearchDocInput = {
  id: string
  title: string
  body: string
  properties: readonly SearchProperty[] | null
  updatedAt: number
}

// frontmatter.ts 76~83행 stripQuotes 와 같은 규칙. 그 함수는 export 되어 있지 않고 이 모듈은 import 를 하나도 두지 않으므로 6줄을 그대로 둔다
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1)
  }
  return value
}

// 값이 '[' 로 시작하고 ']' 로 끝나는 문자열이면 인라인 배열로 보고 원소를 뽑는다 (6.3)
function inlineArrayElements(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed.length < 2 || trimmed[0] !== '[' || trimmed[trimmed.length - 1] !== ']') return []
  const inner = trimmed.slice(1, -1)
  if (inner === '') return []
  return inner.split(',').map((part) => foldCase(stripQuotes(part.trim())).trim())
}

function matchesScalarValue(value: string, filterValue: string): boolean {
  const folded = foldCase(value).trim()
  if (folded === filterValue) return true
  return inlineArrayElements(value).includes(filterValue)
}

function matchesOneFilter(properties: readonly SearchProperty[], filter: QueryFilter): boolean {
  for (const prop of properties) {
    const key = foldCase(prop.key).trim()
    if (key !== filter.key) continue
    if (filter.value === '') return true // 존재 검사
    if (Array.isArray(prop.value)) {
      if (prop.value.some((v) => foldCase(v).trim() === filter.value)) return true
    } else if (matchesScalarValue(prop.value, filter.value)) {
      return true
    }
  }
  return false
}

export function matchesFilters(
  properties: readonly SearchProperty[] | null,
  filters: readonly QueryFilter[],
): boolean {
  if (filters.length === 0) return true
  if (properties === null) return false
  return filters.every((f) => matchesOneFilter(properties, f))
}

export function hasPropertyKey(properties: readonly SearchProperty[] | null, key: string): boolean {
  if (properties === null) return false
  return properties.some((p) => foldCase(p.key).trim() === key)
}

// ── 본문 매칭·정렬 (7장) ─────────────────────────────────

export type DocMatch = { titleMatched: boolean; bodyHit: number }

export function matchDoc(doc: SearchDocInput, query: ParsedQuery): DocMatch | null {
  if (query.isEmpty) return null
  if (!matchesFilters(doc.properties, query.filters)) return null
  if (query.terms.length === 0) return { titleMatched: false, bodyHit: -1 }

  const foldedTitle = foldCase(doc.title)
  const foldedBody = foldCase(doc.body)

  let titleMatched = true
  let bodyHit = -1

  for (const term of query.terms) {
    const inTitle = foldedTitle.includes(term)
    const inBody = foldedBody.includes(term)
    if (!inTitle && !inBody) return null // 첫 실패에서 끊는다
    if (!inTitle) titleMatched = false
    if (inBody) {
      const idx = foldedBody.indexOf(term)
      if (bodyHit === -1 || idx < bodyHit) bodyHit = idx
    }
  }

  return { titleMatched, bodyHit }
}

export type SearchHit = DocMatch & { id: string }
export type SearchOutcome = {
  hits: SearchHit[]
  total: number
  truncated: boolean
  unreadableProperties: number
  missingFilterKeys: string[]
}

export function searchDocs(
  docs: readonly SearchDocInput[],
  query: ParsedQuery,
  options?: { limit?: number },
): SearchOutcome {
  if (query.isEmpty) {
    return { hits: [], total: 0, truncated: false, unreadableProperties: 0, missingFilterKeys: [] }
  }

  const limit = options?.limit ?? RESULT_LIMIT
  const matched: (DocMatch & { id: string; updatedAt: number })[] = []
  let unreadableProperties = 0
  const missingKeys = new Set(query.filters.map((f) => f.key))

  for (const doc of docs) {
    if (query.filters.length > 0 && doc.properties === null) unreadableProperties++

    if (missingKeys.size > 0 && doc.properties !== null) {
      for (const key of missingKeys) {
        if (hasPropertyKey(doc.properties, key)) missingKeys.delete(key)
      }
    }

    const match = matchDoc(doc, query)
    if (match) matched.push({ ...match, id: doc.id, updatedAt: doc.updatedAt })
  }

  matched.sort((a, b) => {
    if (a.titleMatched !== b.titleMatched) return a.titleMatched ? -1 : 1
    return b.updatedAt - a.updatedAt
  })

  const total = matched.length
  const hits: SearchHit[] = matched
    .slice(0, limit)
    .map((m) => ({ titleMatched: m.titleMatched, bodyHit: m.bodyHit, id: m.id }))

  return {
    hits,
    total,
    truncated: total > limit,
    unreadableProperties,
    missingFilterKeys: Array.from(missingKeys),
  }
}

// ── 발췌·강조 (8장) ──────────────────────────────────────

export type SnippetPart = { text: string; hit: boolean }
type Range = { start: number; end: number }

// term 마다 모든 등장 위치를 찾고, 겹치거나 맞닿은 범위를 하나로 합친다 (8.2)
function findMatchRanges(text: string, terms: readonly string[]): Range[] {
  if (terms.length === 0) return []
  const folded = foldCase(text)
  const ranges: Range[] = []

  for (const term of terms) {
    if (term === '') continue
    let idx = folded.indexOf(term)
    while (idx !== -1) {
      ranges.push({ start: idx, end: idx + term.length })
      idx = folded.indexOf(term, idx + 1)
    }
  }

  ranges.sort((a, b) => a.start - b.start || a.end - b.end)

  const merged: Range[] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

function rawPartsFromRanges(text: string, ranges: Range[]): SnippetPart[] {
  const parts: SnippetPart[] = []
  let pos = 0
  for (const r of ranges) {
    if (r.start > pos) parts.push({ text: text.slice(pos, r.start), hit: false })
    parts.push({ text: text.slice(r.start, r.end), hit: true })
    pos = r.end
  }
  if (pos < text.length) parts.push({ text: text.slice(pos, text.length), hit: false })
  return parts
}

type CharTag = { ch: string; hit: boolean }

function flatten(parts: SnippetPart[]): CharTag[] {
  const out: CharTag[] = []
  for (const p of parts) {
    for (const ch of p.text) out.push({ ch, hit: p.hit })
  }
  return out
}

function appendChar(result: SnippetPart[], ch: string, hit: boolean): void {
  const last = result[result.length - 1]
  if (last && last.hit === hit) {
    last.text += ch
  } else {
    result.push({ text: ch, hit })
  }
}

// 공백(줄바꿈 포함)의 연속은 하나로 접고, 접힌 공백은 hit:false 쪽에 붙인다 (8.4 1~3)
function foldWhitespace(chars: CharTag[]): SnippetPart[] {
  const result: SnippetPart[] = []
  let i = 0
  while (i < chars.length) {
    const c = chars[i]
    if (SEPARATOR_RE.test(c.ch)) {
      let j = i
      while (j < chars.length && SEPARATOR_RE.test(chars[j].ch)) j++
      appendChar(result, ' ', false)
      i = j
      continue
    }
    appendChar(result, c.ch, c.hit)
    i++
  }
  return result
}

// 맨 앞·맨 뒤 공백을 떼고, 접은 뒤 빈 조각을 버린다 (8.4 4~5)
function trimParts(parts: SnippetPart[]): SnippetPart[] {
  const out = parts.map((p) => ({ ...p }))
  if (out.length > 0 && out[0].hit === false) out[0].text = out[0].text.replace(/^ /, '')
  if (out.length > 0 && out[out.length - 1].hit === false) {
    const lastIdx = out.length - 1
    out[lastIdx].text = out[lastIdx].text.replace(/ $/, '')
  }
  return out.filter((p) => p.text !== '')
}

function buildParts(source: string, terms: readonly string[]): SnippetPart[] {
  const ranges = findMatchRanges(source, terms)
  const raw = rawPartsFromRanges(source, ranges)
  return trimParts(foldWhitespace(flatten(raw)))
}

export function highlightParts(source: string, query: ParsedQuery): SnippetPart[] {
  if (source === '') return []
  return buildParts(source, query.terms)
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function prependEllipsis(parts: SnippetPart[]): SnippetPart[] {
  if (parts.length > 0 && parts[0].hit === false) {
    return [{ text: '…' + parts[0].text, hit: false }, ...parts.slice(1)]
  }
  return [{ text: '…', hit: false }, ...parts]
}

function appendEllipsis(parts: SnippetPart[]): SnippetPart[] {
  if (parts.length > 0 && parts[parts.length - 1].hit === false) {
    const last = parts[parts.length - 1]
    return [...parts.slice(0, -1), { text: last.text + '…', hit: false }]
  }
  return [...parts, { text: '…', hit: false }]
}

export function buildSnippet(source: string, query: ParsedQuery): SnippetPart[] {
  if (source === '') return []

  const foldedSource = foldCase(source)
  let firstMatchStart = -1
  let firstMatchEnd = -1

  for (const term of query.terms) {
    if (term === '') continue
    const idx = foldedSource.indexOf(term)
    if (idx === -1) continue
    if (firstMatchStart === -1 || idx < firstMatchStart) {
      firstMatchStart = idx
      firstMatchEnd = idx + term.length
    }
  }

  let start: number
  let end: number
  if (firstMatchStart === -1) {
    start = 0
    end = Math.min(source.length, 100)
  } else {
    start = Math.max(0, firstMatchStart - SNIPPET_BEFORE)
    end = Math.min(source.length, firstMatchEnd + SNIPPET_AFTER)
  }

  // 서로게이트 쌍 보호 (8.3 4)
  if (isLowSurrogate(source.charCodeAt(start))) start += 1
  if (end < source.length && isHighSurrogate(source.charCodeAt(end - 1))) end -= 1

  const windowSource = source.slice(start, end)
  let parts = buildParts(windowSource, query.terms)

  if (start > 0) parts = prependEllipsis(parts)
  if (end < source.length) parts = appendEllipsis(parts)

  return parts
}
