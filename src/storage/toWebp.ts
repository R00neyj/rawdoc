// PNG·JPEG·WebP 를 WebP 로 변환 — 더 커지거나 실패하면 원본을 쓴다 (specs/features/F-209.md 2.5)
export async function toWebp(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close?.()
    const converted = await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 })
    return converted.size < blob.size ? converted : blob
  } catch {
    return blob
  }
}
