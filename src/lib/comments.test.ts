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

  // 리뷰 L1 — 줄 첫 칸 펜스만 보던 스캐너가 목록·인용 안 펜스를 놓쳐 뒤쪽 주석을 통째로 남겼다
  it('목록 안 펜스 뒤의 주석을 지운다 (리뷰 L1)', () => {
    const text = '- ```sh\n  npm i\n\n  npm run dev\n  ```\n\n본문 %%작성자 비밀 메모%% 끝\n'
    expect(stripComments(text)).toBe('- ```sh\n  npm i\n\n  npm run dev\n  ```\n\n본문  끝\n')
  })

  it('목록 안 펜스 속 주석 문법은 그대로 둔다 (리뷰 L1)', () => {
    const text = '- ```\n  %%코드%%\n  ```\n'
    expect(stripComments(text)).toBe(text)
  })

  it('닫는 줄 없이 목록이 끝난 펜스 뒤의 주석을 지운다 (리뷰 L1)', () => {
    expect(stripComments('- ```\n  코드\n\n본문 %%비밀%% 끝')).toBe('- ```\n  코드\n\n본문  끝')
  })

  it('인용 안 펜스가 인용과 함께 끝나면 뒤 주석을 지운다 (리뷰 L1)', () => {
    expect(stripComments('> ```\n> 코드\n\n본문 %%비밀%% 끝')).toBe('> ```\n> 코드\n\n본문  끝')
  })

  it('들여쓴 코드블록의 닫는 펜스 모양 줄을 여는 펜스로 보지 않는다 (리뷰 L1)', () => {
    expect(stripComments('    ```\n\n본문 %%비밀%% 끝')).toBe('    ```\n\n본문  끝')
  })

  it('제목 줄의 짝 없는 백틱이 다음 줄 백틱과 짝지어 주석을 살리지 않는다 (리뷰 L1)', () => {
    expect(stripComments('# 제목 `\n%%비밀%% `x')).toBe('# 제목 `\n `x')
  })

  it('주석을 지워 펜스가 사라지면 그 뒤 주석도 지운다 (리뷰 L1)', () => {
    expect(stripComments('%%\n```\n%%\n%%비밀%%\n')).toBe('\n\n\n\n')
  })

  it('프론트매터 안 주석도 지운다', () => {
    expect(stripComments('---\ntitle: a %%비밀%%\n---\n본문')).toBe('---\ntitle: a \n---\n본문')
  })

  it('CRLF 문서의 목록 안 펜스도 같게 다룬다 (리뷰 L1)', () => {
    const text = '- ```\r\n  %%코드%%\r\n  ```\r\n\r\n본문 %%비밀%%\r\n'
    expect(stripComments(text)).toBe('- ```\r\n  %%코드%%\r\n  ```\r\n\r\n본문 \r\n')
  })

  // 리뷰 L2 — 역슬래시로 이스케이프한 백틱·백틱 든 정보 문자열
  it('이스케이프한 백틱을 코드 시작으로 보지 않는다 (리뷰 L2)', () => {
    expect(stripComments('가격 \\`%%비밀 메모%%` 끝')).toBe('가격 \\`` 끝')
  })

  it('정보 문자열에 백틱이 든 줄은 펜스가 아니다 (리뷰 L2)', () => {
    expect(stripComments('```foo`bar\n\n본문 %%비밀%% 끝')).toBe('```foo`bar\n\n본문  끝')
  })

  it('역슬래시 두 개 뒤 백틱은 코드 시작이다', () => {
    const text = '경로 \\\\`%%코드%%` 끝'
    expect(stripComments(text)).toBe(text)
  })
})
