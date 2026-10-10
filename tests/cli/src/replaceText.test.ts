// CLI replace 의 본문 바꾸기 순수 함수
import { describe, expect, it } from 'vitest'
import { REPLACE_LINE_MAX_CHARS, REPLACE_PREVIEW_LINES, replaceLiteral } from '../../../cli/src/replaceText'

describe('replaceLiteral', () => {
  it('모든 곳을 글자 그대로 바꾸고 곳 수를 센다', () => {
    const r = replaceLiteral('foo bar foo\nfoo', 'foo', 'baz')
    expect(r.content).toBe('baz bar baz\nbaz')
    expect(r.count).toBe(3)
  })

  it('대소문자를 구분한다', () => {
    const r = replaceLiteral('Foo foo FOO', 'foo', 'x')
    expect(r.content).toBe('Foo x FOO')
    expect(r.count).toBe(1)
    expect(replaceLiteral('Foo', 'foo', 'x')).toMatchObject({ content: 'Foo', count: 0, lines: [], changedLines: 0 })
  })

  it('정규식·치환 패턴이 아니다', () => {
    expect(replaceLiteral('a.c abc', 'a.c', '$&$1').content).toBe('$&$1 abc')
    expect(replaceLiteral('x(y)', '(y)', '$$').content).toBe('x$$')
  })

  it('CRLF 를 그대로 둔다', () => {
    const r = replaceLiteral('one\r\ntwo one\r\n', 'one', '1')
    expect(r.content).toBe('1\r\ntwo 1\r\n')
    expect(r.lines).toEqual([
      { line: 1, before: 'one', after: '1' },
      { line: 2, before: 'two one', after: 'two 1' },
    ])
  })

  it('빈 바꿀 말은 지운다', () => {
    expect(replaceLiteral('a-b-c', '-', '')).toMatchObject({ content: 'abc', count: 2 })
  })

  it('겹치는 패턴은 왼쪽부터 겹치지 않게 바꾼다', () => {
    expect(replaceLiteral('aaaa', 'aa', 'a')).toMatchObject({ content: 'aa', count: 2 })
    expect(replaceLiteral('aaa', 'aa', 'b')).toMatchObject({ content: 'ba', count: 1 })
  })

  it('바뀜 줄은 앞에서부터 몇 줄만, 전체 줄 수는 따로', () => {
    const content = Array.from({ length: 6 }, (_, i) => `x${i}`).join('\n')
    const r = replaceLiteral(content, 'x', 'y')
    expect(r.changedLines).toBe(6)
    expect(r.lines).toHaveLength(REPLACE_PREVIEW_LINES)
    expect(r.lines[0]).toEqual({ line: 1, before: 'x0', after: 'y0' })
  })

  it('긴 줄은 첫 매칭 둘레만 잘라 보여 준다', () => {
    const line = `${'a'.repeat(500)}needle${'b'.repeat(500)}`
    const r = replaceLiteral(line, 'needle', 'pin')
    const [{ before, after }] = r.lines
    expect(before.length).toBeLessThanOrEqual(REPLACE_LINE_MAX_CHARS + 2)
    expect(before).toContain('needle')
    expect(before.startsWith('…') && before.endsWith('…')).toBe(true)
    expect(after).toContain('pin')
    expect(after.length).toBeLessThanOrEqual(REPLACE_LINE_MAX_CHARS + 2)
  })
})
