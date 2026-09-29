// CSS Syntax 3 토큰화 A1 (specs/features/F-2094.md 7.1)
import { describe, expect, test } from 'vitest'
import { preprocessCss, tokenizeCss } from '../../../src/lib/cssTokens'
import type { CssToken } from '../../../src/lib/cssTokens'

const pairs = (text: string) => tokenizeCss(preprocessCss(text)).tokens.map((t) => [t.type, t.value])
const first = (text: string): CssToken => tokenizeCss(preprocessCss(text)).tokens[0]

function expectContiguous(text: string) {
  const pre = preprocessCss(text)
  const { tokens } = tokenizeCss(pre)
  let at = 0
  for (const t of tokens) {
    expect(t.start).toBe(at)
    expect(t.end).toBeGreaterThan(t.start)
    at = t.end
  }
  expect(at).toBe(pre.length)
  expect(tokens.map((t) => pre.slice(t.start, t.end)).join('')).toBe(pre)
}

describe('F-2094 A1 전처리', () => {
  test('CRLF·CR·FF → LF, NUL → U+FFFD', () => {
    expect(preprocessCss('a\r\nb\rc\fd\0')).toBe('a\nb\nc\nd\uFFFD')
  })
  test('짝 없는 서러게이트 → U+FFFD, 짝 맞은 것은 그대로', () => {
    expect(preprocessCss('a\uD800b\uDC00c')).toBe('a\uFFFDb\uFFFDc')
    expect(preprocessCss('😀')).toBe('😀')
  })
})

describe('F-2094 A1 토큰 표', () => {
  test('url 토큰과 url 함수', () => {
    expect(pairs('url(http://a/b.png)')).toEqual([['url', 'http://a/b.png']])
    expect(pairs('url( "x" )')).toEqual([
      ['function', 'url'], ['whitespace', ''], ['string', 'x'], ['whitespace', ''], [')', ''],
    ])
    expect(pairs('URL(x)')).toEqual([['url', 'x']])
    expect(pairs('\\75 rl(http://a)')).toEqual([['url', 'http://a']])
    expect(pairs('u\\72 l(x)')).toEqual([['url', 'x']])
    expect(pairs("\\55 RL( 'x')")).toEqual([['function', 'URL'], ['whitespace', ''], ['string', 'x'], [')', '']])
  })

  test('bad-url 과 끝에서 열린 url', () => {
    for (const text of ['url(a b)', 'url(a"b)', 'url(a(b)']) expect(pairs(text)).toEqual([['bad-url', '']])
    const open = tokenizeCss(preprocessCss('url(x'))
    expect(open.tokens.map((t) => [t.type, t.value])).toEqual([['url', 'x']])
    expect(open.openAtEnd).toBe('url')
  })

  test('주석이 이름을 끊는다', () => {
    expect(pairs('u/**/rl(x)')).toEqual([['ident', 'u'], ['comment', ''], ['function', 'rl'], ['ident', 'x'], [')', '']])
  })

  test('함수 이름은 이스케이프를 푼다', () => {
    expect(first('image-set(').type).toBe('function')
    expect(first('image-set(').value).toBe('image-set')
    expect(first('-webkit-image-set(').value).toBe('-webkit-image-set')
    expect([first('\\69mage(').type, first('\\69mage(').value]).toEqual(['function', 'image'])
  })

  test('at-keyword 는 이스케이프를 풀고 대소문자를 보존한다', () => {
    expect(pairs('@\\69mport')).toEqual([['at-keyword', 'import']])
    expect(pairs('@IMPORT')).toEqual([['at-keyword', 'IMPORT']])
  })

  test('문자열', () => {
    expect(pairs('"a\\"b"')).toEqual([['string', 'a"b']])
    expect(pairs("'\\201C'")).toEqual([['string', '\u201C']])
    expect(pairs('"a\\\nb"')).toEqual([['string', 'ab']])
    expect(pairs('"a\n')).toEqual([['bad-string', ''], ['whitespace', '']])
    const open = tokenizeCss(preprocessCss('"abc'))
    expect(open.tokens.map((t) => [t.type, t.value])).toEqual([['string', 'abc']])
    expect(open.openAtEnd).toBe('"')
    expect(tokenizeCss("'abc").openAtEnd).toBe("'")
  })

  test('끝에서 열린 주석', () => {
    const open = tokenizeCss(preprocessCss('/* x'))
    expect(open.tokens.map((t) => t.type)).toEqual(['comment'])
    expect(open.openAtEnd).toBe('comment')
    expect(tokenizeCss('/* x */').openAtEnd).toBeNull()
  })

  test('ident·숫자 종류', () => {
    expect(pairs('--x')).toEqual([['ident', '--x']])
    expect(pairs('-webkit-a')).toEqual([['ident', '-webkit-a']])
    expect(first('-9').type).toBe('number')
    expect(pairs('+.5e3px').map((p) => p[0])).toEqual(['dimension'])
    expect(pairs('50%').map((p) => p[0])).toEqual(['percentage'])
  })

  test('hash·delim·cdo·cdc', () => {
    expect(pairs('#fff')).toEqual([['hash', 'fff']])
    expect(pairs('#')).toEqual([['delim', '#']])
    expect(pairs('<!--').map((p) => p[0])).toEqual(['cdo'])
    expect(pairs('-->').map((p) => p[0])).toEqual(['cdc'])
    expect(pairs('\\\n')).toEqual([['delim', '\\'], ['whitespace', '']])
  })

  test('구두점', () => {
    expect(pairs(':;,[](){}').map((p) => p[0])).toEqual(['colon', 'semicolon', 'comma', '[', ']', '(', ')', '{', '}'])
  })

  test('이스케이프 값 0·범위 밖·서러게이트는 U+FFFD', () => {
    expect(first('a\\0 b').value).toBe('a\uFFFDb')
    expect(first('\\0').value).toBe('\uFFFD')
    expect(first('\\110000').value).toBe('\uFFFD')
    expect(first('\\D800').value).toBe('\uFFFD')
    expect(first('a\\\0').value).toBe('a\uFFFD')
  })

  test('이스케이프 뒤 공백 하나를 먹고 6자리까지만 읽는다', () => {
    expect(first('\\41 B').value).toBe('AB')
    expect(first('\\000041B').value).toBe('AB')
  })
})

describe('F-2094 A1 이음 불변식', () => {
  const samples = [
    '', ' ', 'a', '/* x', '"abc', "'", 'url(', 'url(x', 'url( "x" )', 'url(a b)', '\\', '\\\n', '@', '#', '-', '--', '+', '.', '<', '<!', '<!-',
    '.a { color: red; background: url(data:,x) }', '@media (min-width: 1px) { .b { c: d } }', 'a\\0 b', '😀{x:y}',
    '1e', '1e+', '1.5.5', '-.5', '+-1', 'u\\72 l(a\\29 b)', 'url(\\', 'url(a\\', '"a\\', "u+1?2", '}}}{{{', '((((]]]',
  ]
  for (const text of samples) test(JSON.stringify(text), () => expectContiguous(text))
})
