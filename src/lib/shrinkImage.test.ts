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

function stubGlobals({ convertedSize, fail = false }: { convertedSize?: number; fail?: boolean }) {
  const original = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas }

  if (fail) {
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('decode failed'))
  } else {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() })
    globalThis.OffscreenCanvas = vi.fn().mockImplementation(function FakeOffscreenCanvas() {
      return {
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
    restore = stubGlobals({ convertedSize: 999999 })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 4000, height: 3000 })
    expect(result.ext).toBe('webp')
    expect(result.mime).toBe('image/webp')
    expect(result.width).toBe(2000)
    expect(result.height).toBe(1500)
  })

  it('긴 변 2000 이하면 WebP 인코딩 결과가 원본보다 작을 때만 쓴다', async () => {
    restore = stubGlobals({ convertedSize: 100 })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 400, height: 200 })
    expect(result.ext).toBe('webp')
    expect(result.width).toBe(400)
    expect(result.height).toBe(200)
  })

  it('긴 변 2000 이하이고 WebP 결과가 원본보다 크면 원본을 쓴다', async () => {
    restore = stubGlobals({ convertedSize: 2000 })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 400, height: 200 })
    expect(result).toEqual({ blob, mime: 'image/png', ext: 'png', width: 400, height: 200 })
  })

  it('캔버스·인코딩 실패면 원본 그대로', async () => {
    restore = stubGlobals({ fail: true })
    const blob = new Blob([new Uint8Array(1000)])
    const result = await shrinkImage(blob, { mime: 'image/png', ext: 'png', width: 4000, height: 3000 })
    expect(result).toEqual({ blob, mime: 'image/png', ext: 'png', width: 4000, height: 3000 })
  })
})
