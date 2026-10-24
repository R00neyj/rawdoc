// F-2155 A1 — encodeMarkdown 은 decodeMarkdown 의 짝: 섞이지 않은 원본은 바이트 그대로 돌아온다
import { describe, expect, it } from 'vitest'
import { encodeMarkdown } from '../../../../src/lib/markdown/encodeMarkdown'
import { decodeMarkdown } from '../../../../src/lib/markdown/decodeMarkdown'
import { fromEditorText, toEditorText } from '../../../../src/lib/markdown/lineEnding'

const BOM = [0xef, 0xbb, 0xbf]
const utf8 = (s: string) => Array.from(new TextEncoder().encode(s))

// 열고 편집기에 올렸다가(LF) 파일 줄바꿈으로 되돌려 쓰는 길 그대로
function roundTrip(bytes: Uint8Array): Uint8Array {
  const d = decodeMarkdown(bytes)
  return encodeMarkdown(fromEditorText(toEditorText(d.text), d.lineEnding), { hadBom: d.hadBom })
}

describe('F-2155 U1 encodeMarkdown', () => {
  it('BOM 없음 → UTF-8 바이트만', () => {
    expect(Array.from(encodeMarkdown('가a', { hadBom: false }))).toEqual(utf8('가a'))
  })

  it('BOM 있음 → EF BB BF 다음 UTF-8', () => {
    expect(Array.from(encodeMarkdown('가a', { hadBom: true }))).toEqual([...BOM, ...utf8('가a')])
  })

  it('빈 본문 + BOM → BOM 세 바이트', () => {
    expect(Array.from(encodeMarkdown('', { hadBom: true }))).toEqual(BOM)
  })

  it.each([
    ['LF', '# 제목\n본문\n'],
    ['CRLF', '# 제목\r\n본문\r\n'],
    ['줄바꿈 없음', '한 줄짜리'],
    ['빈 파일', ''],
  ])('%s 원본은 열고 다시 써도 바이트가 같다', (_, text) => {
    const plain = new Uint8Array(utf8(text))
    expect(Array.from(roundTrip(plain))).toEqual(Array.from(plain))
    const withBom = new Uint8Array([...BOM, ...utf8(text)])
    expect(Array.from(roundTrip(withBom))).toEqual(Array.from(withBom))
  })

  it('섞인 줄바꿈 원본은 CRLF 로 통일된다', () => {
    const mixed = new Uint8Array(utf8('a\r\nb\nc\r\n'))
    expect(Array.from(roundTrip(mixed))).toEqual(utf8('a\r\nb\r\nc\r\n'))
  })
})
