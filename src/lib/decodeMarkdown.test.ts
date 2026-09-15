import { describe, it, expect } from 'vitest'
import { decodeMarkdown } from './decodeMarkdown'

function bytesOf(str: string) {
  return new TextEncoder().encode(str)
}

describe('decodeMarkdown', () => {
  it('CRLF 원문은 그대로 해독하고 lineEnding crlf', () => {
    const original = '# 제목\r\n\r\n본문\r\n'
    const result = decodeMarkdown(bytesOf(original))
    expect(result).toEqual({ text: original, lineEnding: 'crlf', mixed: false, hadBom: false })
  })

  it('LF 원문은 그대로 해독하고 lineEnding lf', () => {
    const original = '# 제목\n\n본문\n'
    const result = decodeMarkdown(bytesOf(original))
    expect(result).toEqual({ text: original, lineEnding: 'lf', mixed: false, hadBom: false })
  })

  it('줄바꿈이 섞이면 CRLF 로 통일하고 mixed:true', () => {
    const original = 'a\r\nb\nc'
    const result = decodeMarkdown(bytesOf(original))
    expect(result.text).toBe('a\r\nb\r\nc')
    expect(result.lineEnding).toBe('crlf')
    expect(result.mixed).toBe(true)
  })

  it('UTF-8 BOM 은 떼어 내고 hadBom:true', () => {
    const withoutBom = '# 제목\r\n'
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesOf(withoutBom)])
    const result = decodeMarkdown(withBom)
    expect(result.hadBom).toBe(true)
    expect(result.text).toBe(withoutBom)
  })

  it('잘못된 UTF-8 바이트(0xFF)는 not-utf8 에러를 던진다', () => {
    const invalid = new Uint8Array([0x41, 0xff, 0x42])
    expect(() => decodeMarkdown(invalid)).toThrow('not-utf8')
  })
})
