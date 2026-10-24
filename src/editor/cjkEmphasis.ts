// 편집기 강조·취소선 여닫기 판정을 보기 모드와 같은 markdown-it-cjk-friendly 의 scanDelims 로 바꾼다 (F-2168 3장)
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { DelimiterType, InlineContext, InlineParser, MarkdownConfig, MarkdownParser } from '@lezer/markdown'
import MarkdownIt from 'markdown-it'
import type { StateInline } from 'markdown-it'
import cjkFriendly from 'markdown-it-cjk-friendly'

// inlineParsers·inlineNames·parts 는 @internal 이라 .d.ts 에 없다 — 여기서만 보강한다
type ParserInternals = { inlineParsers: (InlineParser['parse'] | undefined)[]; inlineNames: string[] }
type ContextInternals = InlineContext & { parts: { type: DelimiterType; from: number; to: number }[] }

const md = new MarkdownIt().use(cjkFriendly)
const UNDERSCORE = 95

let cachedCx: InlineContext | null = null
let cachedState: StateInline | null = null

function stateFor(cx: InlineContext): StateInline {
  if (cachedCx !== cx || !cachedState) {
    cachedCx = cx
    cachedState = new md.inline.State(cx.text, md, {}, [])
  }
  return cachedState
}

// 원래 파서가 붙인 구분자를 떼고 같은 type 으로 판정만 바꿔 다시 붙인다 — 짝짓기(resolveMarkers)는 type 동일성에 기대 그대로 둔다
function withCjkFlanking(name: string): InlineParser {
  const { inlineParsers, inlineNames } = markdownLanguage.parser as unknown as MarkdownParser & ParserInternals
  const original = inlineParsers[inlineNames.indexOf(name)]
  if (!original) throw new Error(`@lezer/markdown inline parser not found: ${name}`)
  return {
    name,
    parse(cx, next, pos) {
      const end = original(cx, next, pos)
      if (end < 0) return end
      const parts = (cx as ContextInternals).parts
      const delim = parts[parts.length - 1]
      const scanned = stateFor(cx).scanDelims(delim.from - cx.offset, next !== UNDERSCORE)
      if (scanned.length !== delim.to - delim.from) return end
      parts.pop()
      return cx.addDelimiter(delim.type, delim.from, delim.to, scanned.can_open, scanned.can_close)
    },
  }
}

export const cjkEmphasis: MarkdownConfig = {
  parseInline: [withCjkFlanking('Emphasis'), withCjkFlanking('Strikethrough')],
}
