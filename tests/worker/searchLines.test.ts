// /v1/search 의 매칭 줄 추출 순수 함수 (본문 찾기 small change)
import { describe, expect, it } from 'vitest'
import { SEARCH_LINE_MAX_CHARS, SEARCH_LINES_PER_DOC, findMatchingLines } from '../../worker/searchLines'

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('findMatchingLines', () => {
  it('영문 대소문자를 무시하고 줄 번호는 1부터', () => {
    expect(findMatchingLines('Hello\nworld HELLO\nnope', 'hEllo')).toEqual({
      lines: [
        { line: 1, text: 'Hello' },
        { line: 2, text: 'world HELLO' },
      ],
      matchedLines: 2,
    })
  })

  it('한 줄에 여러 번 맞아도 한 줄로 센다', () => {
    expect(findMatchingLines('aa aa\nb', 'aa')).toEqual({ lines: [{ line: 1, text: 'aa aa' }], matchedLines: 1 })
  })

  it('영문 밖 글자는 접지 않는다 — SQLite lower() 와 같다', () => {
    expect(findMatchingLines('Ärger\n회의록 정리', 'ä').matchedLines).toBe(0)
    expect(findMatchingLines('Ärger\n회의록 정리', '회의').lines).toEqual([{ line: 2, text: '회의록 정리' }])
  })

  it('CRLF 본문은 줄 끝 \\r 을 떼고 줄 번호가 LF 와 같다', () => {
    expect(findMatchingLines('a\r\nfoo\r\nbar FOO\r\n', 'foo')).toEqual({
      lines: [
        { line: 2, text: 'foo' },
        { line: 3, text: 'bar FOO' },
      ],
      matchedLines: 2,
    })
  })

  it('문서당 줄은 최대 5개, matchedLines 는 전체 매칭 줄 수', () => {
    const content = Array.from({ length: 8 }, (_, i) => `x${i} key`).join('\n')
    const result = findMatchingLines(content, 'KEY')
    expect(SEARCH_LINES_PER_DOC).toBe(5)
    expect(result.lines.map((l) => l.line)).toEqual([1, 2, 3, 4, 5])
    expect(result.matchedLines).toBe(8)
  })

  it('맞는 줄이 없으면 빈 목록', () => {
    expect(findMatchingLines('abc\ndef', 'zzz')).toEqual({ lines: [], matchedLines: 0 })
  })

  it('200자 이하 줄은 그대로', () => {
    const line = `${'a'.repeat(190)}needle${'b'.repeat(4)}`
    expect(line).toHaveLength(SEARCH_LINE_MAX_CHARS)
    expect(findMatchingLines(line, 'needle').lines[0].text).toBe(line)
  })

  it('긴 줄은 첫 매칭 주변 200자 안쪽으로 자르고 잘린 쪽에 … 를 붙인다', () => {
    const mid = findMatchingLines(`${'x'.repeat(300)}NEEDLE${'y'.repeat(300)}`, 'needle').lines[0].text
    expect(mid.length).toBeLessThanOrEqual(SEARCH_LINE_MAX_CHARS)
    expect(mid).toContain('NEEDLE')
    expect(mid.startsWith('…x')).toBe(true)
    expect(mid.endsWith('y…')).toBe(true)

    const head = findMatchingLines(`needle${'y'.repeat(300)}`, 'needle').lines[0].text
    expect(head.length).toBeLessThanOrEqual(SEARCH_LINE_MAX_CHARS)
    expect(head.startsWith('needle')).toBe(true)
    expect(head.endsWith('…')).toBe(true)

    const tail = findMatchingLines(`${'x'.repeat(300)}needle`, 'needle').lines[0].text
    expect(tail.length).toBeLessThanOrEqual(SEARCH_LINE_MAX_CHARS)
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.endsWith('needle')).toBe(true)
  })

  it('자른 끝에서 서로게이트 쌍을 가르지 않는다', () => {
    for (let pad = 0; pad < 4; pad++) {
      const text = findMatchingLines(`${'😀'.repeat(150 + pad)}key${'😀'.repeat(150)}`, 'key').lines[0].text
      expect(text).toContain('key')
      expect(text.length).toBeLessThanOrEqual(SEARCH_LINE_MAX_CHARS)
      expect(LONE_SURROGATE.test(text)).toBe(false)
    }
  })
})
