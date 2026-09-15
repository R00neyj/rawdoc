import { describe, it, expect } from 'vitest'
import { inspectImageBytes } from './imageFile'

function bytes(...arrays: Uint8Array[]) {
  const total = arrays.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

function u32be(n: number) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function u16be(n: number) {
  return [(n >>> 8) & 0xff, n & 0xff]
}
function u16le(n: number) {
  return [n & 0xff, (n >>> 8) & 0xff]
}
function ascii(s: string) {
  return Array.from(s).map((c) => c.charCodeAt(0))
}

function pngBytes(width: number, height: number) {
  return bytes(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Uint8Array.from(u32be(13)), // IHDR 길이
    Uint8Array.from(ascii('IHDR')),
    Uint8Array.from(u32be(width)),
    Uint8Array.from(u32be(height)),
    Uint8Array.from([8, 6, 0, 0, 0]), // bit depth, color type, ...
  )
}

// SOF0(0xC0) 마커 하나만 있는 최소 JPEG
function jpegBytes(width: number, height: number) {
  const sof = bytes(
    Uint8Array.from([0xff, 0xc0]),
    Uint8Array.from(u16be(8)), // 세그먼트 길이(길이 2바이트 포함)
    Uint8Array.from([8]), // precision
    Uint8Array.from(u16be(height)),
    Uint8Array.from(u16be(width)),
  )
  return bytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), Uint8Array.from(u16be(4)), Uint8Array.from([0, 0]), sof)
}

function gifBytes(width: number, height: number) {
  return bytes(Uint8Array.from(ascii('GIF89a')), Uint8Array.from(u16le(width)), Uint8Array.from(u16le(height)))
}

function webpVp8Bytes(width: number, height: number) {
  const frameTag = [0x30, 0x00, 0x00] // key frame
  const startCode = [0x9d, 0x01, 0x2a]
  const dims = [...u16le(width & 0x3fff), ...u16le(height & 0x3fff)]
  const vp8Data = Uint8Array.from([...frameTag, ...startCode, ...dims])
  return bytes(
    Uint8Array.from(ascii('RIFF')),
    Uint8Array.from(u32be(0)),
    Uint8Array.from(ascii('WEBP')),
    Uint8Array.from(ascii('VP8 ')),
    Uint8Array.from(u32be(vp8Data.length)),
    vp8Data,
  )
}

describe('inspectImageBytes', () => {
  it('PNG 시그니처·IHDR 에서 가로·세로를 읽는다', () => {
    expect(inspectImageBytes(pngBytes(200, 100))).toEqual({ mime: 'image/png', ext: 'png', width: 200, height: 100 })
  })

  it('JPEG SOF0 에서 가로·세로를 읽는다', () => {
    expect(inspectImageBytes(jpegBytes(300, 150))).toEqual({
      mime: 'image/jpeg',
      ext: 'jpg',
      width: 300,
      height: 150,
    })
  })

  it('GIF 논리 화면에서 가로·세로를 읽는다', () => {
    expect(inspectImageBytes(gifBytes(64, 32))).toEqual({ mime: 'image/gif', ext: 'gif', width: 64, height: 32 })
  })

  it('WebP(VP8 무손실 아님) 에서 가로·세로를 읽는다', () => {
    expect(inspectImageBytes(webpVp8Bytes(400, 200))).toEqual({
      mime: 'image/webp',
      ext: 'webp',
      width: 400,
      height: 200,
    })
  })

  it('가로 12000px PNG 도 헤더는 읽는다(크기 제한은 상위 정책의 몫)', () => {
    expect(inspectImageBytes(pngBytes(12000, 100))).toEqual({
      mime: 'image/png',
      ext: 'png',
      width: 12000,
      height: 100,
    })
  })

  it('SVG(XML 글자)는 null', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(inspectImageBytes(svg)).toBeNull()
  })

  it('평범한 글자 파일(확장자만 .png)은 null', () => {
    const text = new TextEncoder().encode('이것은 이미지가 아닙니다')
    expect(inspectImageBytes(text)).toBeNull()
  })

  it('잘린 PNG 헤더는 null', () => {
    const full = pngBytes(200, 100)
    expect(inspectImageBytes(full.slice(0, 10))).toBeNull()
  })

  it('잘린 JPEG(마커만 있고 SOF 없음)는 null', () => {
    const truncated = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])
    expect(inspectImageBytes(truncated)).toBeNull()
  })

  it('잘린 GIF 헤더는 null', () => {
    expect(inspectImageBytes(Uint8Array.from(ascii('GIF89a')))).toBeNull()
  })

  it('빈 바이트는 null', () => {
    expect(inspectImageBytes(new Uint8Array(0))).toBeNull()
    expect(inspectImageBytes(null)).toBeNull()
  })
})
