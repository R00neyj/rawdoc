// 사용자 CSS 필터 — 원문을 보존한 채 외부 자원을 부를 수 있는 선언·규칙만 잘라 내고 끝을 닫는다 (F-2094 4장)
import { preprocessCss, tokenizeCss } from './cssTokens'
import type { CssToken } from './cssTokens'
import { USER_CSS_ALLOWED_AT_RULES } from './userCssPolicy'
import type { UserCssRemoval, UserCssRemovalReason } from './userCssPolicy'

export type UserCssFiltered = { css: string; removed: UserCssRemoval[] }

const ALLOWED_AT_RULES = new Set(USER_CSS_ALLOWED_AT_RULES)
const SUBSTITUTION_FUNCTIONS = new Set(['var', 'env', 'attr', 'if', 'inherit'])
const CLOSER: Partial<Record<CssToken['type'], string>> = { '(': ')', function: ')', '[': ']', '{': '}' }

const asciiLower = (text: string) => text.replace(/[A-Z]+/g, (m) => m.toLowerCase())
const isForbiddenFunction = (name: string) => name === 'src' || name === 'image' || name === 'image-set' || name.endsWith('-image-set')

// URL 파서처럼 탭·줄바꿈을 지우고 앞쪽 C0·공백을 자른 뒤 본다 (M13)
function urlArgKind(arg: string | null): 'data' | 'fragment' | 'other' {
  if (arg === null) return 'other'
  const cleaned = arg.replace(/[\t\n\r]/g, '')
  let i = 0
  while (i < cleaned.length && cleaned.charCodeAt(i) <= 0x20) i++
  const head = asciiLower(cleaned.slice(i, i + 5))
  return head === 'data:' ? 'data' : head.startsWith('#') ? 'fragment' : 'other'
}

type Cut = { start: number; end: number; removal: UserCssRemoval | null }
type BlockOwner = { start: number; fontFace: boolean; fontBad: boolean; cutMark: number; head: () => string }
type Frame = { end: number; nested: boolean; font: boolean; head: () => string; owner: BlockOwner | null }

class Parser {
  readonly src: string
  readonly t: CssToken[]
  readonly close: Int32Array
  readonly cuts: Cut[] = []

  constructor(src: string, tokens: CssToken[]) {
    this.src = src
    this.t = tokens.filter((tok) => tok.type !== 'comment')
    this.close = matchBrackets(this.t)
  }

  next(k: number): number {
    const c = this.close[k]
    return c === NOT_OPENER ? k + 1 : c === UNCLOSED ? this.t.length : c + 1
  }

  lastEnd(from: number, to: number): number {
    for (let k = to - 1; k >= from; k--) if (this.t[k].type !== 'whitespace') return this.t[k].end
    return this.t[from].start
  }

  text(from: number, to: number): string {
    let a = from
    let b = to - 1
    while (a <= b && this.t[a].type === 'whitespace') a++
    while (b >= a && this.t[b].type === 'whitespace') b--
    if (a > b) return ''
    return this.src.slice(this.t[a].start, this.t[b].end).replace(/[\t\n ]+/g, ' ')
  }

  headOf(atName: string | null, from: number, to: number): () => string {
    let cached: string | null = null
    return () => {
      if (cached === null) {
        const prelude = this.text(from, to)
        cached = (atName === null ? prelude : `@${atName}${prelude ? ' ' + prelude : ''}`).slice(0, 80)
      }
      return cached
    }
  }

  cut(start: number, end: number, reason: UserCssRemovalReason | null, rule: () => string, property: string | null = null) {
    this.cuts.push({ start, end, removal: reason === null ? null : { reason, rule: rule(), property } })
  }

  preludeHasUrl(from: number, to: number): boolean {
    for (let k = from; k < to; k++) {
      const tok = this.t[k]
      if (tok.type === 'url' || tok.type === 'bad-url') return true
      if (tok.type === 'function') {
        const name = asciiLower(tok.value)
        if (name === 'url' || isForbiddenFunction(name)) return true
      }
    }
    return false
  }

  skipBlock(open: number): { next: number; end: number } {
    const close = this.close[open]
    return close < 0 ? { next: this.t.length, end: this.src.length } : { next: close + 1, end: this.t[close].end }
  }

  run() {
    const frames: Frame[] = [{ end: this.t.length, nested: false, font: false, head: () => '', owner: null }]
    let p = 0
    while (frames.length > 0) {
      const f = frames[frames.length - 1]
      if (p >= f.end) {
        frames.pop()
        if (f.owner) {
          this.finishBlock(f.owner, p)
          if (p < this.t.length) p++
        }
        continue
      }
      const type = this.t[p].type
      if (type === 'whitespace' || (f.nested ? type === 'semicolon' : type === 'cdo' || type === 'cdc')) {
        p++
        continue
      }
      if (type === 'at-keyword') {
        p = this.atRule(p, f, frames)
        continue
      }
      if (f.nested && type === 'ident') {
        const after = this.declaration(p, f)
        if (after >= 0) {
          p = after
          continue
        }
      }
      p = this.qualifiedRule(p, f, frames)
    }
  }

  finishBlock(owner: BlockOwner, closeAt: number) {
    if (!owner.fontFace || !owner.fontBad) return
    this.cuts.length = owner.cutMark
    const end = closeAt < this.t.length ? this.t[closeAt].end : this.src.length
    this.cut(owner.start, end, 'font-src', owner.head)
  }

  atRule(p: number, f: Frame, frames: Frame[]): number {
    const name = asciiLower(this.t[p].value)
    let q = p + 1
    while (q < f.end && this.t[q].type !== 'semicolon' && this.t[q].type !== '{') q = this.next(q)
    const head = this.headOf(name, p + 1, q)
    const reason: UserCssRemovalReason | null = !ALLOWED_AT_RULES.has(name)
      ? (name === 'import' ? 'import' : 'rule-kind')
      : this.preludeHasUrl(p + 1, q) ? 'url' : null
    const start = this.t[p].start
    if (q >= this.t.length) {
      this.cut(start, this.lastEnd(p, q), reason, head)
      return q
    }
    const stop = this.t[q].type
    if (stop === 'semicolon') {
      if (reason) this.cut(start, this.t[q].end, reason, head)
      return q + 1
    }
    if (stop !== '{') {
      if (reason) this.cut(start, this.lastEnd(p, q), reason, head)
      return q
    }
    if (reason) {
      const block = this.skipBlock(q)
      this.cut(start, block.end, reason, head)
      return block.next
    }
    const fontFace = name === 'font-face'
    const owner: BlockOwner = { start, fontFace, fontBad: false, cutMark: this.cuts.length, head }
    frames.push({ end: this.close[q] < 0 ? this.t.length : this.close[q], nested: true, font: fontFace, head, owner })
    return q + 1
  }

  qualifiedRule(p: number, f: Frame, frames: Frame[]): number {
    let q = p
    while (q < f.end && this.t[q].type !== '{' && !(f.nested && this.t[q].type === 'semicolon')) q = this.next(q)
    const head = this.headOf(null, p, q)
    const reason: UserCssRemovalReason | null = this.preludeHasUrl(p, q) ? 'url' : null
    const start = this.t[p].start
    if (q >= this.t.length) {
      this.cut(start, this.lastEnd(p, q), reason, head)
      return q
    }
    const stop = this.t[q].type
    if (stop === 'semicolon') {
      if (reason) this.cut(start, this.t[q].end, reason, head)
      return q + 1
    }
    if (stop !== '{') {
      if (reason) this.cut(start, this.lastEnd(p, q), reason, head)
      return q
    }
    if (reason) {
      const block = this.skipBlock(q)
      this.cut(start, block.end, reason, head)
      return block.next
    }
    const owner: BlockOwner = { start, fontFace: false, fontBad: false, cutMark: this.cuts.length, head }
    frames.push({ end: this.close[q] < 0 ? this.t.length : this.close[q], nested: true, font: false, head, owner })
    return q + 1
  }

  declaration(p: number, f: Frame): number {
    const t = this.t
    let q = p + 1
    while (q < f.end && t[q].type === 'whitespace') q++
    if (q >= f.end || t[q].type !== 'colon') return -1
    const valueStart = q + 1
    q = valueStart
    let block = false
    let other = false
    while (q < f.end && t[q].type !== 'semicolon') {
      if (t[q].type === '{') block = true
      else if (t[q].type !== 'whitespace') other = true
      q = this.next(q)
    }
    const valueEnd = q
    const name = t[p].value
    const custom = name.startsWith('--')
    if (!custom && block && other) return -1
    const terminated = q < f.end
    const reason = this.valueVerdict(valueStart, valueEnd, custom, f.font)
    if (reason !== null) {
      if (f.font && f.owner) f.owner.fontBad = true
      else this.cut(t[p].start, terminated ? t[q].end : this.lastEnd(p, valueEnd), reason, f.head, name)
    }
    return terminated ? q + 1 : q
  }

  valueVerdict(from: number, to: number, custom: boolean, font: boolean): UserCssRemovalReason | null {
    const t = this.t
    let substitution = false
    let forbidden = false
    let anyUrl = false
    let badUrl = false
    for (let k = from; k < to; k++) {
      const tok = t[k]
      let arg: string | null
      if (tok.type === 'url') arg = tok.value
      else if (tok.type === 'bad-url') {
        forbidden = true
        continue
      } else if (tok.type === 'function') {
        const name = asciiLower(tok.value)
        if (SUBSTITUTION_FUNCTIONS.has(name) || name.startsWith('--')) substitution = true
        else if (isForbiddenFunction(name)) forbidden = true
        if (name !== 'url') continue
        let m = k + 1
        while (m < to && t[m].type === 'whitespace') m++
        arg = m < to && t[m].type === 'string' ? t[m].value : null
      } else continue
      anyUrl = true
      const kind = urlArgKind(arg)
      if (kind === 'other' || (kind === 'fragment' && font)) badUrl = true
    }
    const reason = custom ? 'custom-property' : substitution ? 'substitution' : 'url'
    if (forbidden) return reason
    if (!custom && !substitution) return badUrl ? reason : null
    return anyUrl || this.hasRawBackslash(from, to) ? reason : null
  }

  // 정규화되지 않는 값의 원문 `\` 는 보조 검증이 못 보는 자리라 막는다 (결정 4, M16)
  hasRawBackslash(from: number, to: number): boolean {
    for (let k = from; k < to; k++) {
      for (let c = this.t[k].start; c < this.t[k].end; c++) if (this.src.charCodeAt(c) === 92) return true
    }
    return false
  }

  output(): UserCssFiltered {
    const cuts = this.cuts.slice().sort((a, b) => a.start - b.start)
    const removed: UserCssRemoval[] = []
    let css = ''
    let last = 0
    for (const c of cuts) {
      if (c.start < last) {
        last = Math.max(last, c.end)
        continue
      }
      css += this.src.slice(last, c.start)
      last = c.end
      if (c.removal) removed.push(c.removal)
    }
    css += this.src.slice(last)
    return { css, removed }
  }
}

const NOT_OPENER = -2
const UNCLOSED = -1

function matchBrackets(tokens: CssToken[]): Int32Array {
  const close = new Int32Array(tokens.length).fill(NOT_OPENER)
  const open: number[] = []
  for (let k = 0; k < tokens.length; k++) {
    const type = tokens[k].type
    if (CLOSER[type] !== undefined) {
      close[k] = UNCLOSED
      open.push(k)
    } else if ((type === ')' || type === ']' || type === '}') && open.length > 0 && CLOSER[tokens[open[open.length - 1]].type] === type) {
      close[open.pop() as number] = k
    }
  }
  return close
}

// 끝에서 열린 주석·문자열·URL·괄호·블록을 닫는다 — 이어 붙인 다음 텍스트가 검사를 비켜 가지 않게 (4.6)
function closeText(css: string): string {
  let { tokens, openAtEnd } = tokenizeCss(css)
  let backslashes = 0
  while (backslashes < css.length && css.charCodeAt(css.length - 1 - backslashes) === 92) backslashes++
  if (openAtEnd !== 'comment' && backslashes % 2 === 1) {
    css = css.slice(0, -1)
    ;({ tokens, openAtEnd } = tokenizeCss(css))
  }
  let tail = openAtEnd === 'comment' ? '*/' : openAtEnd === 'url' ? ')' : openAtEnd ?? ''
  const open: string[] = []
  for (const tok of tokens) {
    const closer = CLOSER[tok.type]
    if (closer !== undefined) open.push(closer)
    else if (open.length > 0 && open[open.length - 1] === tok.type) open.pop()
  }
  for (let k = open.length - 1; k >= 0; k--) tail += open[k]
  return css + tail
}

export function filterUserCss(source: string): UserCssFiltered {
  const src = preprocessCss(source)
  const { tokens, openAtEnd } = tokenizeCss(src)
  const parser = new Parser(src, tokens)
  parser.run()
  const out = parser.output()
  const balanced = openAtEnd === null && !parser.close.includes(UNCLOSED)
  if (!balanced || out.css.endsWith('\\')) out.css = closeText(out.css)
  return out
}

export function topLevelRuleHeads(css: string): string[] {
  const src = preprocessCss(css)
  const parser = new Parser(src, tokenizeCss(src).tokens)
  const t = parser.t
  const heads: string[] = []
  let p = 0
  while (p < t.length) {
    const type = t[p].type
    if (type === 'whitespace' || type === 'cdo' || type === 'cdc') {
      p++
      continue
    }
    const at = type === 'at-keyword'
    let q = at ? p + 1 : p
    while (q < t.length && t[q].type !== '{' && !(at && t[q].type === 'semicolon')) q = parser.next(q)
    heads.push(parser.headOf(at ? asciiLower(t[p].value) : null, at ? p + 1 : p, q)())
    p = q >= t.length ? q : t[q].type === '{' ? parser.skipBlock(q).next : q + 1
  }
  return heads
}
