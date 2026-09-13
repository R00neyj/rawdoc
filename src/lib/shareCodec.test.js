import { describe, it, expect } from 'vitest'
import { encodeShare, decodeShare } from './shareCodec.js'

describe('encodeShare/decodeShare 왕복', () => {
  it('한글·이모지 본문(LF)이 바이트 그대로 돌아온다', async () => {
    const doc = { title: '제목 한글', content: '한글 이모지 😀 본문\n둘째 줄', lineEnding: 'lf' }
    const fragment = await encodeShare(doc)
    const result = await decodeShare(fragment)
    expect(result).toEqual(doc)
  })

  it('CRLF 문서가 바이트 그대로 돌아온다', async () => {
    const doc = { title: 'CRLF 문서', content: '첫 줄\r\n둘째 줄\r\n', lineEnding: 'crlf' }
    const fragment = await encodeShare(doc)
    const result = await decodeShare(fragment)
    expect(result).toEqual(doc)
  })

  it('빈 문서가 바이트 그대로 돌아온다', async () => {
    const doc = { title: '', content: '', lineEnding: 'crlf' }
    const fragment = await encodeShare(doc)
    const result = await decodeShare(fragment)
    expect(result).toEqual(doc)
  })

  it('조각은 base64url 문자(A-Za-z0-9-_)만으로 되어 있고 패딩(=)이 없다', async () => {
    const fragment = await encodeShare({ title: 't', content: 'c', lineEnding: 'lf' })
    expect(fragment).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('decodeShare 거부', () => {
  it('잘린 조각은 reject 한다', async () => {
    const fragment = await encodeShare({ title: '제목', content: '본문 내용입니다', lineEnding: 'lf' })
    const truncated = fragment.slice(0, Math.max(1, fragment.length - 6))
    await expect(decodeShare(truncated)).rejects.toThrow()
  })

  it('v 가 1 이 아니면 reject 한다', async () => {
    const json = { v: 2, t: '제목', c: '본문', e: 'lf' }
    const bytes = new TextEncoder().encode(JSON.stringify(json))
    const cs = new CompressionStream('deflate-raw')
    const writer = cs.writable.getWriter()
    writer.write(bytes)
    writer.close()
    const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer())
    let binary = ''
    for (const b of compressed) binary += String.fromCharCode(b)
    const fragment = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    await expect(decodeShare(fragment)).rejects.toThrow()
  })

  it('base64url 이 아닌 글자가 있으면 reject 한다', async () => {
    await expect(decodeShare('abc def!!')).rejects.toThrow()
  })

  it('빈 문자열은 reject 한다', async () => {
    await expect(decodeShare('')).rejects.toThrow()
  })
})
