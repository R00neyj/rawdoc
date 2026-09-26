// shrinkImage 단위 (specs/features/F-220.md 3장 A1) — 브라우저 API 를 대체해 확인한다
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fitWithin, shrinkImage } from './shrinkImage'

describe('fitWithin', () => {
  it('4000x3000 → 2000x1500', () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 })
  })

  it('1000x3000 → 667x2000', () => {
    expect(fitWithin(1000, 3000, 2000)).toEqual({ width: 667, height: 2000 })
  })

  it('2000x100 은 그대로', () => {
    expect(fitWithin(2000, 100, 2000)).toEqual({ width: 2000, height: 100 })
  })

  it('5000x1 → 2000x1(짧은 변 최소 1)', () => {
    expect(fitWithin(5000, 1, 2000)).toEqual({ width: 2000, height: 1 })
  })
})

// bitmap 은 브라우저가 EXIF 방향을 적용해 돌려준 크기다 — 안 주면 10x10
function stubGlobals({ convertedSize, fail = false, bitmap = { width: 10, height: 10 } }: { convertedSize?: number; fail?: boolean; bitmap?: { width: number; height: number } }) {
  const original = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas }

  if (fail) {
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('decode failed'))
  } else {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ ...bitmap, close: vi.fn() })
    globalThis.OffscreenCanvas = vi.fn().mockImplementation(function FakeOffscreenCanvas(width: number, height: number) {
      return {
        width,
        height,
        getContext: () => ({ drawImage: vi.fn(), imageSmoothingQuality: 'low' }),
        convertToBlob: vi.fn().mockResolvedValue({ size: convertedSize } as Blob),
      }
    })
  }

  return () => {
    globalThis.createImageBitmap = original.createImageBitmap
    globalThis.OffscreenCanvas = original.OffscreenCanvas
  }
}

describe('shrinkImage', () => {
  let restore: () => void

  afterEach(() => {
    restore?.()
  })

  it('GIF 는 건드리지 않는다', async () => {
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/gif', ext: 'gif', width: 4000, height: 3000 })
    expect(result).toEqual({ blob, mime: 'image/gif', ext: 'gif', width: 4000, height: 3000 })
  })

  it('긴 변 2000 넘으면 축소해 WebP 로 쓴다(원본보다 커도)', async () => {
    restore = stubGlobals({ convertedSize: 999999, bitmap: { width: 4000, height: 3000 } })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 4000, height: 3000 })
    expect(result.ext).toBe('webp')
    expect(result.mime).toBe('image/webp')
    expect(result.width).toBe(2000)
    expect(result.height).toBe(1500)
  })

  it('긴 변 2000 이하면 WebP 인코딩 결과가 원본보다 작을 때만 쓴다', async () => {
    restore = stubGlobals({ convertedSize: 100, bitmap: { width: 400, height: 200 } })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 400, height: 200 })
    expect(result.ext).toBe('webp')
    expect(result.width).toBe(400)
    expect(result.height).toBe(200)
  })

  it('긴 변 2000 이하이고 WebP 결과가 원본보다 크면 원본을 쓴다', async () => {
    restore = stubGlobals({ convertedSize: 2000, bitmap: { width: 400, height: 200 } })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 400, height: 200 })
    expect(result).toEqual({ blob, mime: 'image/png', ext: 'png', width: 400, height: 200 })
  })

  // EXIF 방향(Orientation 5~8) JPEG — 헤더 400x200, createImageBitmap 은 돌린 200x400 (2026-09-27 Chrome 실측, F-2048 11장 C1)
  it('EXIF 로 돌아간 JPEG 는 돌린 뒤 크기로 캔버스를 만들고 그 크기를 돌려준다', async () => {
    restore = stubGlobals({ convertedSize: 100, bitmap: { width: 200, height: 400 } })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/jpeg', ext: 'jpg', width: 400, height: 200 })
    const canvas = vi.mocked(globalThis.OffscreenCanvas).mock.results[0].value as { width: number; height: number }
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 200, height: 400 })
    expect({ width: result.width, height: result.height }).toEqual({ width: 200, height: 400 })
  })

  it('EXIF 로 돌아간 큰 JPEG 는 돌린 뒤 크기 기준으로 줄인다', async () => {
    restore = stubGlobals({ convertedSize: 999999, bitmap: { width: 3000, height: 4000 } })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/jpeg', ext: 'jpg', width: 4000, height: 3000 })
    expect({ width: result.width, height: result.height }).toEqual({ width: 1500, height: 2000 })
  })

  it('EXIF 로 돌아간 JPEG 를 원본 그대로 둘 때도 크기는 돌린 뒤 크기다', async () => {
    restore = stubGlobals({ convertedSize: 2000, bitmap: { width: 200, height: 400 } })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/jpeg', ext: 'jpg', width: 400, height: 200 })
    expect(result).toEqual({ blob, mime: 'image/jpeg', ext: 'jpg', width: 200, height: 400 })
  })

  it('캔버스·인코딩 실패면 원본 그대로', async () => {
    restore = stubGlobals({ fail: true })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 4000, height: 3000 })
    expect(result).toEqual({ blob, mime: 'image/png', ext: 'png', width: 4000, height: 3000 })
  })
})
