import { describe, it, expect, vi } from 'vitest'
import { attachImages, type AttachImagesStore } from './attachImages'
import type { ImageExt } from '../lib/imageBlock'
import * as shrinkImageModule from '../lib/shrinkImage'

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0))
}

function pngBytes(width: number, height: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...u32be(13),
    ...ascii('IHDR'),
    ...u32be(width),
    ...u32be(height),
    8, 6, 0, 0, 0,
  ])
}

function pngFile(name: string, width = 200, height = 100): File {
  return new File([pngBytes(width, height)], name, { type: 'image/png' })
}

function fakeStore(overrides: Partial<AttachImagesStore> = {}): AttachImagesStore {
  let n = 0
  return {
    putAttachment: vi.fn(async () => ({ id: `id${n++}`, ext: 'png' as ImageExt })),
    ...overrides,
  }
}

describe('attachImages', () => {
  it('통과한 파일을 저장하고 alt·크기를 돌려준다(붙여넣기는 alt=이미지)', async () => {
    const store = fakeStore()
    const { inserted, notice } = await attachImages([pngFile('a.png')], { store, source: 'paste' })
    expect(notice).toBeNull()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ id: 'id0', ext: 'png', width: 200, height: 100, alt: '이미지' })
  })

  it('끌어놓기는 alt 가 파일명(확장자 제외)', async () => {
    const store = fakeStore()
    const { inserted } = await attachImages([pngFile('다이어그램.png')], { store, source: 'drop' })
    expect(inserted[0].alt).toBe('다이어그램')
  })

  it('20MB 초과면 저장하지 않고 알림', async () => {
    const store = fakeStore()
    const big = pngFile('big.png')
    Object.defineProperty(big, 'size', { value: 20 * 1024 * 1024 + 1 })
    const { inserted, notice } = await attachImages([big], { store, source: 'paste' })
    expect(inserted).toHaveLength(0)
    expect(store.putAttachment).not.toHaveBeenCalled()
    expect(notice).toEqual({ type: 'warn', message: '이미지는 한 장에 20MB 까지 넣을 수 있습니다.' })
  })

  it('SVG(형식 시그니처 아님)는 알림', async () => {
    const store = fakeStore()
    const svg = new File([new TextEncoder().encode('<svg></svg>')], 'a.svg', { type: 'image/svg+xml' })
    const { inserted, notice } = await attachImages([svg], { store, source: 'paste' })
    expect(inserted).toHaveLength(0)
    expect(notice).toEqual({ type: 'warn', message: 'PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.' })
  })

  it('확장자만 .png 인 글자 파일도 형식 검사로 걸러진다', async () => {
    const store = fakeStore()
    const fake = new File([new TextEncoder().encode('이것은 글자입니다')], 'a.png', { type: 'image/png' })
    const { notice } = await attachImages([fake], { store })
    expect(notice?.message).toBe('PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.')
  })

  it('가로 12000px 은 너무 큼 알림', async () => {
    const store = fakeStore()
    const { inserted, notice } = await attachImages([pngFile('huge.png', 12000, 100)], { store })
    expect(inserted).toHaveLength(0)
    expect(notice).toEqual({
      type: 'warn',
      message: '이미지가 너무 큽니다. 가로·세로 10000px 이하만 넣을 수 있습니다.',
    })
  })

  it('저장 실패는 error 알림', async () => {
    const store = fakeStore({ putAttachment: vi.fn().mockRejectedValue(new Error('quota')) })
    const { inserted, notice } = await attachImages([pngFile('a.png')], { store })
    expect(inserted).toHaveLength(0)
    expect(notice).toEqual({ type: 'error', message: '저장 공간이 부족해 이미지를 넣지 못했습니다.' })
  })

  it('계정당 500MB 한도 초과(quota_exceeded)는 전용 문구', async () => {
    const quotaError = new Error('quota_exceeded')
    quotaError.name = 'quota_exceeded'
    const store = fakeStore({ putAttachment: vi.fn().mockRejectedValue(quotaError) })
    const { inserted, notice } = await attachImages([pngFile('a.png')], { store })
    expect(inserted).toHaveLength(0)
    expect(notice).toEqual({
      type: 'error',
      message: '이미지 저장 공간(500MB)이 가득 찼습니다. 문서에서 지운 이미지는 하루 뒤 정리됩니다.',
    })
  })

  it('여러 장 중 일부만 실패하면 나머지는 넣고 N장 알림', async () => {
    const store = fakeStore()
    const svg = new File([new TextEncoder().encode('<svg></svg>')], 'b.svg')
    const { inserted, notice } = await attachImages([pngFile('a.png'), svg, pngFile('c.png')], {
      store,
      source: 'drop',
    })
    expect(inserted.map((i) => i.alt)).toEqual(['a', 'c'])
    expect(notice).toEqual({
      type: 'warn',
      message: '이미지 1장을 넣지 못했습니다. PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.',
    })
  })

  it('빈 목록이면 아무 일도 없다', async () => {
    const store = fakeStore()
    const { inserted, notice } = await attachImages([], { store })
    expect(inserted).toEqual([])
    expect(notice).toBeNull()
  })

  it('축소 결과(shrinkImage)를 저장·삽입에 반영한다', async () => {
    const shrunkBlob = new Blob([new Uint8Array(10)])
    const spy = vi
      .spyOn(shrinkImageModule, 'shrinkImage')
      .mockResolvedValue({ blob: shrunkBlob, mime: 'image/webp', ext: 'webp' as ImageExt, width: 2000, height: 1500 })
    const store = fakeStore({ putAttachment: vi.fn(async () => ({ id: 'id0', ext: 'webp' as ImageExt })) })
    const { inserted } = await attachImages([pngFile('a.png', 4000, 3000)], { store, source: 'paste' })
    expect(inserted[0]).toMatchObject({ ext: 'webp', width: 2000, height: 1500 })
    expect(store.putAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ blob: shrunkBlob, mime: 'image/webp', ext: 'webp', width: 2000, height: 1500 }),
    )
    spy.mockRestore()
  })

  it('축소 뒤에도 5MB 초과 — GIF 문구', async () => {
    const bigBlob = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])
    const spy = vi
      .spyOn(shrinkImageModule, 'shrinkImage')
      .mockResolvedValue({ blob: bigBlob, mime: 'image/gif', ext: 'gif' as ImageExt, width: 3000, height: 100 })
    const store = fakeStore()
    const { inserted, notice } = await attachImages([pngFile('a.gif')], { store, source: 'paste' })
    expect(inserted).toHaveLength(0)
    expect(notice).toEqual({ type: 'warn', message: 'GIF 는 한 장에 5MB 까지 넣을 수 있습니다.' })
    spy.mockRestore()
  })

  it('축소 뒤에도 5MB 초과 — 그 외 형식 문구', async () => {
    const bigBlob = new Blob([new Uint8Array(5 * 1024 * 1024 + 1)])
    const spy = vi
      .spyOn(shrinkImageModule, 'shrinkImage')
      .mockResolvedValue({ blob: bigBlob, mime: 'image/webp', ext: 'webp' as ImageExt, width: 2000, height: 1500 })
    const store = fakeStore()
    const { inserted, notice } = await attachImages([pngFile('a.png')], { store, source: 'paste' })
    expect(inserted).toHaveLength(0)
    expect(notice).toEqual({ type: 'warn', message: '이미지는 줄인 뒤에도 5MB 를 넘어 넣지 못했습니다.' })
    spy.mockRestore()
  })
})
