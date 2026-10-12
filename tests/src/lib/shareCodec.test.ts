import { describe, it, expect } from 'vitest'
import { encodeShare, decodeShare, decompress, type ShareDoc } from '../../../src/lib/shareCodec'

// deflate-raw 로 압축한 바이트를 만든다 (decompress 테스트용)
async function compressBytes(bytes: Uint8Array<ArrayBuffer>) {
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  writer.write(bytes)
  writer.close()
  return new Uint8Array(await new Response(cs.readable).arrayBuffer())
}

describe('encodeShare/decodeShare 왕복', () => {
  it('한글·이모지 본문(LF)이 바이트 그대로 돌아온다', async () => {
    const doc: ShareDoc = { title: '제목 한글', content: '한글 이모지 😀 본문\n둘째 줄', lineEnding: 'lf' }
    const fragment = await encodeShare(doc)
    const result = await decodeShare(fragment)
    expect(result).toEqual(doc)
  })

  it('CRLF 문서가 바이트 그대로 돌아온다', async () => {
    const doc: ShareDoc = { title: 'CRLF 문서', content: '첫 줄\r\n둘째 줄\r\n', lineEnding: 'crlf' }
    const fragment = await encodeShare(doc)
    const result = await decodeShare(fragment)
    expect(result).toEqual(doc)
  })

  it('빈 문서가 바이트 그대로 돌아온다', async () => {
    const doc: ShareDoc = { title: '', content: '', lineEnding: 'crlf' }
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

describe('decompress 압축 해제 크기 상한 (F-138 3.6)', () => {
  it('풀린 바이트가 상한을 넘으면 거부한다(작은 상한으로 빠르게 확인)', async () => {
    const original = new Uint8Array(2000).fill(65) // 압축이 잘 되는 반복 데이터
    const compressed = await compressBytes(original)
    await expect(decompress(compressed, 1000)).rejects.toThrow()
  })

  it('풀린 바이트가 상한 아래면 성공한다', async () => {
    const original = new Uint8Array(500).fill(65)
    const compressed = await compressBytes(original)
    const result = await decompress(compressed, 1000)
    expect(result).toEqual(original)
  })

  it('경계값(정확히 상한과 같음)은 성공한다', async () => {
    const original = new Uint8Array(1000).fill(66)
    const compressed = await compressBytes(original)
    const result = await decompress(compressed, 1000)
    expect(result).toEqual(original)
  })

  it('decodeShare 는 기본 상한(20MB)을 쓰고, 그 아래 문서는 정상 왕복한다', async () => {
    const doc: ShareDoc = { title: '작은 문서', content: '평범한 본문', lineEnding: 'lf' }
    const fragment = await encodeShare(doc)
    await expect(decodeShare(fragment)).resolves.toEqual(doc)
  })
})

describe('조각 키 r — 요청 토큰 (F-2137 2장)', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43자

  async function fragmentOf(json: object) {
    const compressed = await compressBytes(new TextEncoder().encode(JSON.stringify(json)))
    let binary = ''
    for (const b of compressed) binary += String.fromCharCode(b)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  it('U1 requestToken 이 있는 왕복은 같은 값을 돌려준다', async () => {
    const doc: ShareDoc = { title: '제목', content: '본문', lineEnding: 'lf', requestToken: TOKEN }
    await expect(decodeShare(await encodeShare(doc))).resolves.toEqual(doc)
  })

  it('U1 requestToken 이 없으면 결과에 키가 없다', async () => {
    const result = await decodeShare(await encodeShare({ title: '제목', content: '본문', lineEnding: 'lf' }))
    expect('requestToken' in result).toBe(false)
  })

  it('U1 r 이 43자 base64url 이 아니면(42자·! 포함·숫자) 키 없이 연다', async () => {
    for (const r of [TOKEN.slice(1), `${TOKEN.slice(1)}!`, 12345]) {
      const result = await decodeShare(await fragmentOf({ v: 1, t: 't', c: 'c', e: 'lf', r }))
      expect('requestToken' in result).toBe(false)
      expect(result.content).toBe('c')
    }
  })

  it('U1 r 이 없는 옛 조각은 그대로 열린다', async () => {
    await expect(decodeShare(await fragmentOf({ v: 1, t: 't', c: 'c', e: 'lf' }))).resolves.toEqual({ title: 't', content: 'c', lineEnding: 'lf' })
  })
})
