// 이미지 자동 축소 — 긴 변 2000px 초과면 줄이고 WebP 로 인코딩한다 (F-220.md 2.1)
import type { ImageExt } from './imageBlock'

export const MAX_SIDE = 2000
const QUALITY = 0.85

export type ShrinkImageInfo = { mime: string; ext: ImageExt; width: number; height: number }
export type ShrinkImageResult = { blob: Blob; mime: string; ext: ImageExt; width: number; height: number }

// 비율 유지로 긴 변을 max 에 맞춘다. 긴 변이 max 이하면 그대로, 짧은 변은 최소 1
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longSide = Math.max(width, height)
  if (longSide <= max) return { width, height }
  const scale = max / longSide
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// GIF 는 건드리지 않는다. 그 외는 긴 변 2000 초과면 축소해 WebP 로 쓰고, 이하면 WebP 로 인코딩해 원본보다 작을 때만 쓴다
export async function shrinkImage(blob: Blob, info: ShrinkImageInfo): Promise<ShrinkImageResult> {
  const original: ShrinkImageResult = { blob, mime: info.mime, ext: info.ext, width: info.width, height: info.height }
  if (info.ext === 'gif') return original

  try {
    // 크기는 헤더(info)가 아니라 bitmap 에서 — createImageBitmap 은 EXIF 방향을 적용한 크기를 준다(헤더 크기면 세로 사진이 찌그러졌다, 2026-09-27)
    const bitmap = await createImageBitmap(blob)
    const source = { width: bitmap.width, height: bitmap.height }
    const target = fitWithin(source.width, source.height, MAX_SIDE)
    const needsShrink = target.width !== source.width || target.height !== source.height
    const canvas = new OffscreenCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, target.width, target.height)
    bitmap.close?.()
    const encoded = await canvas.convertToBlob({ type: 'image/webp', quality: QUALITY })

    if (needsShrink) {
      return { blob: encoded, mime: 'image/webp', ext: 'webp', width: target.width, height: target.height }
    }
    if (encoded.size < blob.size) {
      return { blob: encoded, mime: 'image/webp', ext: 'webp', ...source }
    }
    return { ...original, ...source }
  } catch {
    return original
  }
}
