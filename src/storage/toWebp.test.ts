// toWebp 단위 (specs/features/F-209.md 3장 A5) — 브라우저 API 를 대체해 확인한다
import { describe, expect, it, vi, afterEach } from 'vitest'
import { toWebp } from './toWebp'

function stubGlobals({ convertedSize, fail = false }: { convertedSize?: number; fail?: boolean }) {
  const original = { createImageBitmap: globalThis.createImageBitmap, OffscreenCanvas: globalThis.OffscreenCanvas }

  if (fail) {
    globalThis.createImageBitmap = vi.fn().mockRejectedValue(new Error('decode failed'))
  } else {
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() })
    globalThis.OffscreenCanvas = vi.fn().mockImplementation(function FakeOffscreenCanvas() {
      return {
        getContext: () => ({ drawImage: vi.fn() }),
        convertToBlob: vi.fn().mockResolvedValue({ size: convertedSize } as Blob),
      }
    })
  }

  return () => {
    globalThis.createImageBitmap = original.createImageBitmap
    globalThis.OffscreenCanvas = original.OffscreenCanvas
  }
}

describe('toWebp', () => {
  let restore: () => void

  afterEach(() => {
    restore?.()
  })

  it('변환 결과가 원본보다 작으면 변환 결과를 쓴다', async () => {
    restore = stubGlobals({ convertedSize: 100 })
    const original = new Blob([new Uint8Array(1000)])
    const result = await toWebp(original)
    expect(result.size).toBe(100)
  })

  it('변환 결과가 원본보다 크면 원본을 쓴다', async () => {
    restore = stubGlobals({ convertedSize: 2000 })
    const original = new Blob([new Uint8Array(1000)])
    const result = await toWebp(original)
    expect(result).toBe(original)
  })

  it('변환 실패하면 원본을 쓴다', async () => {
    restore = stubGlobals({ fail: true })
    const original = new Blob([new Uint8Array(1000)])
    const result = await toWebp(original)
    expect(result).toBe(original)
  })
})
