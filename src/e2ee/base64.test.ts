// F-403 U1·U2·U17 (specs/features/F-403.md 9.1, 4장)
import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64 } from './base64'

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  for (let offset = 0; offset < n; offset += 65536) {
    crypto.getRandomValues(out.subarray(offset, Math.min(offset + 65536, n)))
  }
  return out
}

describe('F-403 U1 bytesToBase64', () => {
  it('짧은 입력', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('')
    expect(bytesToBase64(new Uint8Array([0]))).toBe('AA==')
    expect(bytesToBase64(new Uint8Array([0, 0]))).toBe('AAA=')
    expect(bytesToBase64(new Uint8Array([0, 0, 0]))).toBe('AAAA')
    expect(bytesToBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=')
    expect(bytesToBase64(new Uint8Array([0xff, 0xff, 0xff]))).toBe('////')
  })

  it('왕복 — [0xfb,0xff], [0xff,0xff,0xff]', () => {
    const a = new Uint8Array([0xfb, 0xff])
    expect(base64ToBytes(bytesToBase64(a))).toEqual(a)
    const b = new Uint8Array([0xff, 0xff, 0xff])
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b)
  })

  it('0~255 전부 한 번씩(256 B) 왕복', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    const encoded = bytesToBase64(bytes)
    expect(base64ToBytes(encoded)).toEqual(bytes)
  })

  it('무작위 749,039 B — 길이 998,720자, 왕복', () => {
    const bytes = randomBytes(749039)
    const encoded = bytesToBase64(bytes)
    expect(encoded.length).toBe(998720)
    expect(base64ToBytes(encoded)).toEqual(bytes)
  })
})

describe('F-403 U2 base64ToBytes', () => {
  it('빈 문자열 → 길이 0 배열', () => {
    expect(base64ToBytes('')).toEqual(new Uint8Array(0))
  })

  it('정상 입력', () => {
    expect(base64ToBytes('QQ==')).toEqual(new Uint8Array([0x41]))
  })

  it.each([
    ['QR=='], // 비정규 끝 비트
    ['AA='], // 길이 4의 배수 아님
    ['A==='], // 패딩 3개
    ['AA==AA=='], // 패딩이 중간에
    ['AA AA'], // 공백
    ['AAA\n'], // 줄바꿈
    ['-_8='], // base64url
    ['AA=A'], // 패딩 뒤에 글자
    ['Zg'], // 패딩 없이 길이 2
  ])('%s → null', (input) => {
    expect(base64ToBytes(input)).toBe(null)
  })
})

describe('F-403 U17 base64 속도(느슨한 상한)', () => {
  it('749,039 B 인코딩·디코딩이 각각 200ms 미만', () => {
    const bytes = randomBytes(749039)
    const t0 = performance.now()
    const encoded = bytesToBase64(bytes)
    const t1 = performance.now()
    base64ToBytes(encoded)
    const t2 = performance.now()
    expect(t1 - t0).toBeLessThan(200)
    expect(t2 - t1).toBeLessThan(200)
  })
})
