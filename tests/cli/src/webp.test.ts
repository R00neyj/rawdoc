// F-2144 U1~U5, U7 — CLI 업로드 전 PNG·JPEG → WebP 변환 (specs/features/F-2144.md 2장·4장)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import encodePng, { init as initPngEncoder } from '@jsquash/png/encode.js'
import encodeJpeg, { init as initJpegEncoder } from '@jsquash/jpeg/encode.js'
import pngWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm?url&inline'
import jpegEncWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm?url&inline'
import { toWebpBytes } from '../../../cli/src/webp'
import { inspectImageBytes } from '../../../src/lib/image/imageFile'

async function compile(dataUrl: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(await (await fetch(dataUrl)).arrayBuffer())
}

// 결정적인 의사 난수 — 매번 같은 그림
function pixels(width: number, height: number, noise: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  let seed = 1
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return (seed / 0x7fffffff - 0.5) * noise
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (x / width) * 255 + rand()
      data[i + 1] = (y / height) * 255 + rand()
      data[i + 2] = ((x + y) / (width + height)) * 255 + rand()
      data[i + 3] = 255
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData
}

// SOI 바로 뒤에 Orientation 6 하나뿐인 EXIF APP1 을 끼운다
function withOrientation6(jpeg: Uint8Array): Uint8Array {
  const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const length = payload.length + 2
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...payload]
  return new Uint8Array([...jpeg.subarray(0, 2), ...app1, ...jpeg.subarray(2)])
}

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

let png: Uint8Array
let jpeg: Uint8Array

beforeAll(async () => {
  await initPngEncoder(await compile(pngWasm))
  await initJpegEncoder(await compile(jpegEncWasm))
  png = new Uint8Array(await encodePng(pixels(400, 300, 40)))
  jpeg = new Uint8Array(await encodeJpeg(pixels(400, 300, 40), { quality: 95 }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('F-2144 toWebpBytes', () => {
  it('U1 PNG·JPEG → 원본보다 짧은 RIFF????WEBP', async () => {
    for (const input of [png, jpeg]) {
      const out = await toWebpBytes(input)
      expect(ascii(out, 0, 4)).toBe('RIFF')
      expect(ascii(out, 8, 12)).toBe('WEBP')
      expect(out.length).toBeLessThan(input.length)
    }
  })

  it('U2 결과가 원본보다 크면(반투명 1×1 PNG 73 B → webp 86 B) 받은 객체 그대로', async () => {
    const pixel = { data: new Uint8ClampedArray([10, 20, 30, 128]), width: 1, height: 1, colorSpace: 'srgb' } as ImageData
    const tiny = new Uint8Array(await encodePng(pixel))
    expect(await toWebpBytes(tiny)).toBe(tiny)
  })

  it('U3 GIF·WebP·글자 바이트는 받은 객체 그대로', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0, 0, 0x3b])
    const webp = await toWebpBytes(png)
    const text = new TextEncoder().encode('# 제목\n본문')
    for (const input of [gif, webp, text]) expect(await toWebpBytes(input)).toBe(input)
  })

  it('U4 EXIF Orientation 6 인 40×20 JPEG → 20×40 webp', async () => {
    const rotated = withOrientation6(new Uint8Array(await encodeJpeg(pixels(40, 20, 0))))
    expect(inspectImageBytes(rotated)).toMatchObject({ width: 40, height: 20 })
    const out = await toWebpBytes(rotated)
    expect(inspectImageBytes(out)).toMatchObject({ ext: 'webp', width: 20, height: 40 })
  })

  it('U5 픽셀 한도 넘는 PNG 머리·잘린 PNG 는 그대로', async () => {
    const huge = new Uint8Array(png.length)
    huge.set(png)
    const view = new DataView(huge.buffer)
    view.setUint32(16, 7000)
    view.setUint32(20, 7000)
    expect(await toWebpBytes(huge)).toBe(huge)
    const half = png.slice(0, png.length >> 1)
    expect(await toWebpBytes(half)).toBe(half)
  })

  it('U5 잘린 JPEG 를 바꾸는 동안 stderr·console.error 호출 0', async () => {
    const stderr = vi.spyOn(process.stderr, 'write')
    const consoleError = vi.spyOn(console, 'error')
    // emscripten 이 init 때 console.error 를 bind 하므로 감시를 건 뒤 새 모듈로 코덱을 연다
    vi.resetModules()
    const fresh = await import('../../../cli/src/webp')
    await fresh.toWebpBytes(jpeg.slice(0, jpeg.length >> 1))
    expect(stderr).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })
})

describe('F-2144 U7 앱·서버는 @jsquash 를 쓰지 않는다', () => {
  it('src/·worker/ 의 .ts·.tsx 에 @jsquash/ 문자열이 없다', async () => {
    const offenders: string[] = []
    for (const dir of ['src', 'worker']) {
      const root = new URL(`../../../${dir}/`, import.meta.url)
      for (const path of await readdir(root, { recursive: true })) {
        if (!/\.tsx?$/.test(path)) continue
        if ((await readFile(new URL(path.replaceAll('\\', '/'), root), 'utf-8')).includes('@jsquash/')) offenders.push(`${dir}/${path}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
