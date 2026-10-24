// CSS Syntax 3 전처리·토큰화 — 주석도 토큰으로 내고 오프셋을 붙인다 (F-2094 3.1)

export type CssTokenType =
  | 'whitespace' | 'comment' | 'string' | 'bad-string' | 'url' | 'bad-url' | 'function' | 'ident'
  | 'at-keyword' | 'hash' | 'delim' | 'number' | 'percentage' | 'dimension' | 'cdo' | 'cdc'
  | 'colon' | 'semicolon' | 'comma' | '[' | ']' | '(' | ')' | '{' | '}'
export type CssToken = {
  type: CssTokenType
  start: number
  end: number
  value: string
}
export type CssTokenizeResult = { tokens: CssToken[]; openAtEnd: 'comment' | '"' | "'" | 'url' | null }

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

export function preprocessCss(text: string): string {
  const out = text.replace(/\r\n?|\f/g, '\n').replace(/\0/g, '�')
  return /[\uD800-\uDFFF]/.test(out) ? out.replace(LONE_SURROGATE, '�') : out
}

const isDigit = (c: number) => c >= 48 && c <= 57
const isHex = (c: number) => isDigit(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102)
const isIdentStart = (c: number) => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c >= 0x80
const isIdentChar = (c: number) => isIdentStart(c) || isDigit(c) || c === 45
const isWhitespace = (c: number) => c === 32 || c === 10 || c === 9
const isNonPrintable = (c: number) => (c >= 0 && c <= 8) || c === 11 || (c >= 14 && c <= 31) || c === 127

const PUNCTUATION: Record<number, CssTokenType> = {
  40: '(', 41: ')', 44: 'comma', 58: 'colon', 59: 'semicolon', 91: '[', 93: ']', 123: '{', 125: '}',
}

export function tokenizeCss(preprocessed: string): CssTokenizeResult {
  const s = preprocessed
  const n = s.length
  const tokens: CssToken[] = []
  let openAtEnd: CssTokenizeResult['openAtEnd'] = null
  let i = 0

  const at = (k: number) => (k < n ? s.charCodeAt(k) : -1)
  // 명세대로 `\` 뒤가 텍스트 끝이어도 유효한 이스케이프다(값은 U+FFFD)
  const validEscape = (k: number) => at(k) === 92 && at(k + 1) !== 10
  const startsIdent = (k: number) => {
    const c = at(k)
    if (c === 45) return isIdentStart(at(k + 1)) || at(k + 1) === 45 || validEscape(k + 1)
    return isIdentStart(c) || validEscape(k)
  }
  const startsNumber = (k: number) => {
    const c = at(k)
    if (c === 43 || c === 45) return isDigit(at(k + 1)) || (at(k + 1) === 46 && isDigit(at(k + 2)))
    if (c === 46) return isDigit(at(k + 1))
    return isDigit(c)
  }
  const push = (type: CssTokenType, start: number, value = '') => { tokens.push({ type, start, end: i, value }) }

  const consumeEscape = (): string => {
    const c = at(i)
    if (c === -1) return '�'
    if (isHex(c)) {
      const from = i
      while (i - from < 6 && isHex(at(i))) i++
      const code = parseInt(s.slice(from, i), 16)
      if (isWhitespace(at(i))) i++
      return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff ? '�' : String.fromCodePoint(code)
    }
    const code = s.codePointAt(i) as number
    i += code > 0xffff ? 2 : 1
    return String.fromCodePoint(code)
  }

  const consumeName = (): string => {
    let out = ''
    let run = i
    for (;;) {
      const c = at(i)
      if (isIdentChar(c)) i++
      else if (validEscape(i)) {
        out += s.slice(run, i)
        i++
        out += consumeEscape()
        run = i
      } else return out + s.slice(run, i)
    }
  }

  const consumeNumber = () => {
    if (at(i) === 43 || at(i) === 45) i++
    while (isDigit(at(i))) i++
    if (at(i) === 46 && isDigit(at(i + 1))) {
      i += 2
      while (isDigit(at(i))) i++
    }
    const e = at(i)
    if ((e === 69 || e === 101) && (isDigit(at(i + 1)) || ((at(i + 1) === 43 || at(i + 1) === 45) && isDigit(at(i + 2))))) {
      i += 2
      while (isDigit(at(i))) i++
    }
  }

  const numeric = (start: number) => {
    consumeNumber()
    if (startsIdent(i)) {
      consumeName()
      push('dimension', start)
    } else if (at(i) === 37) {
      i++
      push('percentage', start)
    } else push('number', start)
  }

  const badUrlRemnants = () => {
    for (;;) {
      const c = at(i)
      if (c === -1) {
        openAtEnd = 'url'
        return
      }
      if (c === 41) {
        i++
        return
      }
      if (validEscape(i)) {
        i++
        consumeEscape()
      } else i++
    }
  }

  const consumeUrl = (start: number) => {
    while (isWhitespace(at(i))) i++
    let out = ''
    let run = i
    for (;;) {
      const c = at(i)
      if (c === 41 || c === -1) {
        out += s.slice(run, i)
        if (c === 41) i++
        else openAtEnd = 'url'
        return push('url', start, out)
      }
      if (isWhitespace(c)) {
        out += s.slice(run, i)
        while (isWhitespace(at(i))) i++
        if (at(i) === 41 || at(i) === -1) {
          if (at(i) === 41) i++
          else openAtEnd = 'url'
          return push('url', start, out)
        }
        badUrlRemnants()
        return push('bad-url', start)
      }
      if (c === 34 || c === 39 || c === 40 || isNonPrintable(c) || (c === 92 && !validEscape(i))) {
        badUrlRemnants()
        return push('bad-url', start)
      }
      if (c === 92) {
        out += s.slice(run, i)
        i++
        out += consumeEscape()
        run = i
      } else i++
    }
  }

  const identLike = (start: number) => {
    const name = consumeName()
    if (at(i) !== 40) return push('ident', start, name)
    i++
    if (/^url$/i.test(name)) {
      while (isWhitespace(at(i)) && isWhitespace(at(i + 1))) i++
      const c = at(i)
      const quote = (q: number) => q === 34 || q === 39
      if (!quote(c) && !(isWhitespace(c) && quote(at(i + 1)))) return consumeUrl(start)
    }
    push('function', start, name)
  }

  const consumeString = (start: number, quote: number) => {
    i++
    let out = ''
    let run = i
    for (;;) {
      const c = at(i)
      if (c === quote || c === -1) {
        out += s.slice(run, i)
        if (c === quote) i++
        else openAtEnd = quote === 34 ? '"' : "'"
        return push('string', start, out)
      }
      if (c === 10) return push('bad-string', start)
      if (c === 92) {
        out += s.slice(run, i)
        i++
        if (at(i) === 10) i++
        else if (at(i) !== -1) out += consumeEscape()
        run = i
      } else i++
    }
  }

  while (i < n) {
    const start = i
    const c = s.charCodeAt(i)
    if (c === 47 && at(i + 1) === 42) {
      const close = s.indexOf('*/', i + 2)
      if (close < 0) {
        i = n
        openAtEnd = 'comment'
      } else i = close + 2
      push('comment', start)
    } else if (isWhitespace(c)) {
      while (isWhitespace(at(i))) i++
      push('whitespace', start)
    } else if (c === 34 || c === 39) {
      consumeString(start, c)
    } else if (PUNCTUATION[c] !== undefined) {
      i++
      push(PUNCTUATION[c], start)
    } else if (c === 35 && (isIdentChar(at(i + 1)) || validEscape(i + 1))) {
      i++
      push('hash', start, consumeName())
    } else if ((c === 43 || c === 45 || c === 46) && startsNumber(i)) {
      numeric(start)
    } else if (c === 45 && at(i + 1) === 45 && at(i + 2) === 62) {
      i += 3
      push('cdc', start)
    } else if (c === 45 && startsIdent(i)) {
      identLike(start)
    } else if (c === 60 && at(i + 1) === 33 && at(i + 2) === 45 && at(i + 3) === 45) {
      i += 4
      push('cdo', start)
    } else if (c === 64 && startsIdent(i + 1)) {
      i++
      push('at-keyword', start, consumeName())
    } else if (c === 92 && validEscape(i)) {
      identLike(start)
    } else if (isDigit(c)) {
      numeric(start)
    } else if (isIdentStart(c)) {
      identLike(start)
    } else {
      i++
      push('delim', start, s[start])
    }
  }
  return { tokens, openAtEnd }
}
