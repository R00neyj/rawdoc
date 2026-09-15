import { describe, expect, it } from 'vitest'
import { sniffImage } from './imageSniff'

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

function ascii(str: string): number[] {
  return [...str].map((c) => c.charCodeAt(0))
}

function minimalPng(width: number, height: number): Uint8Array {
  const wBytes = new Uint8Array(4)
  new DataView(wBytes.buffer).setUint32(0, width)
  const hBytes = new Uint8Array(4)
  new DataView(hBytes.buffer).setUint32(0, height)
  return bytes(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // 시그니처
    0, 0, 0, 13, // IHDR 길이
    ...ascii('IHDR'),
    ...wBytes,
    ...hBytes,
    8, 6, 0, 0, 0, // bitdepth, colortype, compression, filter, interlace
  )
}

function minimalGif(width: number, height: number): Uint8Array {
  return bytes(...ascii('GIF89a'), width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff)
}

function minimalJpeg(width: number, height: number): Uint8Array {
  return bytes(
    0xff, 0xd8, 0xff, 0xc0, // SOI + SOF0
    0x00, 0x08, // length
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
  )
}

function minimalWebp(width: number, height: number): Uint8Array {
  return bytes(
    ...ascii('RIFF'), 20, 0, 0, 0, ...ascii('WEBP'),
    ...ascii('VP8 '), 10, 0, 0, 0,
    0x10, 0x00, 0x00, // frame tag
    0x9d, 0x01, 0x2a, // start code
    width & 0xff, (width >> 8) & 0x3f,
    height & 0xff, (height >> 8) & 0x3f,
  )
}

describe('sniffImage', () => {
  it('PNG 형식·가로세로를 판정한다', () => {
    expect(sniffImage(minimalPng(10, 20))).toEqual({ ext: 'png', mime: 'image/png', width: 10, height: 20 })
  })

  it('JPEG 형식·가로세로를 판정한다', () => {
    expect(sniffImage(minimalJpeg(10, 20))).toEqual({ ext: 'jpg', mime: 'image/jpeg', width: 10, height: 20 })
  })

  it('GIF 형식·가로세로를 판정한다', () => {
    expect(sniffImage(minimalGif(10, 20))).toEqual({ ext: 'gif', mime: 'image/gif', width: 10, height: 20 })
  })

  it('WebP 형식·가로세로를 판정한다', () => {
    expect(sniffImage(minimalWebp(10, 20))).toEqual({ ext: 'webp', mime: 'image/webp', width: 10, height: 20 })
  })

  it('SVG 는 거부한다', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(sniffImage(svg)).toBeNull()
  })

  it('실제 판정은 요청 확장자와 무관하다 — 불일치는 호출자가 검사한다', () => {
    const result = sniffImage(minimalPng(1, 1))
    expect(result?.ext).toBe('png')
    expect(result?.ext).not.toBe('jpg')
  })

  it('가로 또는 세로가 0 이면 거부한다', () => {
    expect(sniffImage(minimalPng(0, 1))).toBeNull()
    expect(sniffImage(minimalPng(1, 0))).toBeNull()
  })

  it('픽셀 수가 40,000,000 을 넘으면 거부한다', () => {
    expect(sniffImage(minimalPng(100000, 401))).toBeNull() // 40,100,000
    expect(sniffImage(minimalPng(100000, 400))).not.toBeNull() // 40,000,000 은 통과
  })
})
