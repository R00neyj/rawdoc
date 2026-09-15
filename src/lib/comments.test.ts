import { describe, it, expect } from 'vitest'
import { stripComments } from './comments'

describe('stripComments', () => {
  it('한 줄 %%…%% 를 지운다', () => {
    expect(stripComments('본문 %%비밀%% 끝')).toBe('본문  끝')
  })

  it('여러 줄에 걸친 %%…%% 는 줄 수를 유지하며 지운다', () => {
    const text = '앞\n%%\n비밀\n%%\n뒤'
    const result = stripComments(text)
    expect(result).toBe('앞\n\n\n\n뒤')
    expect(result.split('\n').length).toBe(text.split('\n').length)
  })

  it('<!-- --> 주석을 지운다', () => {
    expect(stripComments('본문 <!-- 비밀 --> 끝')).toBe('본문  끝')
  })

  it('여러 줄 <!-- --> 도 줄 수를 유지한다', () => {
    const text = '앞\n<!--\n비밀\n-->\n뒤'
    const result = stripComments(text)
    expect(result).toBe('앞\n\n\n\n뒤')
    expect(result.split('\n').length).toBe(text.split('\n').length)
  })

  it('닫는 기호가 없으면 그대로 둔다', () => {
    expect(stripComments('본문 %%닫히지 않음')).toBe('본문 %%닫히지 않음')
    expect(stripComments('본문 <!-- 닫히지 않음')).toBe('본문 <!-- 닫히지 않음')
  })

  it('펜스 코드블록 안은 지우지 않는다', () => {
    const text = '```\n%%코드처럼 보이는 것%%\n```'
    expect(stripComments(text)).toBe(text)
  })

  it('~~~ 펜스도 지우지 않는다', () => {
    const text = '~~~\n<!-- 안 지워짐 -->\n~~~'
    expect(stripComments(text)).toBe(text)
  })

  it('인라인코드 안은 지우지 않는다', () => {
    const text = '본문 `%%코드%%` 끝'
    expect(stripComments(text)).toBe(text)
  })

  it('짝 없는 백틱이 빈 줄 너머 백틱과 짝지어 주석을 살리지 않는다', () => {
    expect(stripComments('오타 `\n\n본문 %%비밀%% 끝 `x`')).toBe('오타 `\n\n본문  끝 `x`')
    expect(stripComments('오타 `\r\n\r\n%%비밀%% `x`')).toBe('오타 `\r\n\r\n `x`')
  })

  it('CRLF 를 그대로 유지한다', () => {
    const text = '앞\r\n%%\r\n비밀\r\n%%\r\n뒤'
    const result = stripComments(text)
    expect(result).toBe('앞\r\n\r\n\r\n\r\n뒤')
  })
})
