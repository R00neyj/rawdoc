import { highlightTree, tagHighlighter, tags as t, type Highlighter } from '@lezer/highlight'
import type { Parser } from '@lezer/common'
import { codeLangId, languageTokenOfCodeTag, type CodeLangId } from './codeLang'

export const CODE_TOKEN_KINDS = ['keyword', 'string', 'comment', 'number', 'function', 'type', 'property', 'tag'] as const
export type CodeTokenKind = (typeof CODE_TOKEN_KINDS)[number]
export type CodeSegment = { text: string; kind: CodeTokenKind | null }

export const CODE_HIGHLIGHT_LIMITS = { blockChars: 20_000, totalChars: 100_000 }

const CACHE_SIZE = 200

// 태그 → 종류 (F-2122 1.3). scope 는 편집기 쪽이 감싸서 준다
export const codeTokenHighlighter: Highlighter = tagHighlighter([
  { tag: [t.keyword, t.self, t.modifier], class: 'code-keyword' },
  { tag: [t.string, t.regexp, t.attributeValue], class: 'code-string' },
  { tag: t.comment, class: 'code-comment' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.color], class: 'code-number' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'code-function' },
  { tag: [t.typeName, t.className, t.namespace], class: 'code-type' },
  { tag: [t.propertyName, t.attributeName], class: 'code-property' },
  { tag: t.tagName, class: 'code-tag' },
])

const parserIds = new WeakMap<Parser, number>()
let nextParserId = 0
const cache = new Map<string, CodeSegment[][]>()

function cacheKey(parser: Parser, code: string): string {
  let id = parserIds.get(parser)
  if (id === undefined) {
    id = nextParserId++
    parserIds.set(parser, id)
  }
  return `${id}:${code}`
}

function plainLines(code: string): CodeSegment[][] {
  return code.split('\n').map((line) => (line ? [{ text: line, kind: null }] : []))
}

function paint(code: string, parser: Parser): CodeSegment[][] {
  const lines: CodeSegment[][] = [[]]
  const push = (from: number, to: number, kind: CodeTokenKind | null) => {
    let start = from
    while (start < to) {
      const nl = code.indexOf('\n', start)
      const end = nl < 0 || nl >= to ? to : nl
      if (end > start) lines[lines.length - 1].push({ text: code.slice(start, end), kind })
      if (end < to) {
        lines.push([])
        start = end + 1
      } else start = end
    }
  }
  let pos = 0
  highlightTree(parser.parse(code), codeTokenHighlighter, (from, to, classes) => {
    if (from > pos) push(pos, from, null)
    push(from, to, classes.split(' ')[0].slice('code-'.length) as CodeTokenKind)
    pos = to
  })
  if (pos < code.length) push(pos, code.length, null)
  return lines
}

// 줄마다 (글자, 종류) 조각. 돌려준 배열은 캐시와 같은 객체라 고치지 않는다 (F-2123 3.3)
export function highlightCodeLines(code: string, parser: Parser): CodeSegment[][] {
  if (code.length > CODE_HIGHLIGHT_LIMITS.blockChars) return plainLines(code)
  const key = cacheKey(parser, code)
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const result = paint(code, parser)
  cache.set(key, result)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return result
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"' }
const CHAR: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

// markdown-it escapeHtml 이 바꾸는 네 글자만, 한 번에 (&amp;lt; → &lt;)
const unescapeHtml = (s: string) => s.replace(/&(amp|lt|gt|quot);/g, (_, name: string) => ENTITY[name])
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => CHAR[ch])

const CODE_BLOCK = /(<pre(?=[\s>])[^>]*><code(?=[\s>])[^>]*>)([\s\S]*?)<\/code><\/pre>/g

function renderLines(lines: CodeSegment[][]): string {
  return lines
    .map((segs) =>
      segs.map((s) => (s.kind ? `<span class="code-${s.kind}">${escapeHtml(s.text)}</span>` : escapeHtml(s.text))).join(''),
    )
    .join('\n')
}

// <pre><code class="language-x"> 안쪽만 칠한다. 태그·속성은 바이트 그대로 (F-2123 3.3)
export function highlightHtmlCodeBlocks(html: string, parserFor: (id: CodeLangId) => Parser | null): string {
  let total = 0
  let stopped = false
  let changed = false
  const out = html.replace(CODE_BLOCK, (whole: string, head: string, inner: string) => {
    if (stopped) return whole
    const lang = languageTokenOfCodeTag(head.slice(head.lastIndexOf('<code')))
    const id = lang === null ? null : codeLangId(lang)
    const parser = id ? parserFor(id) : null
    if (!parser) return whole
    const code = unescapeHtml(inner)
    if (code.length > CODE_HIGHLIGHT_LIMITS.blockChars) return whole
    if (total + code.length > CODE_HIGHLIGHT_LIMITS.totalChars) {
      stopped = true
      return whole
    }
    total += code.length
    changed = true
    return `${head}${renderLines(highlightCodeLines(code, parser))}</code></pre>`
  })
  return changed ? out : html
}
