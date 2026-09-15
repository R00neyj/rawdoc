// 이미지 시그니처·가로세로 판정 — 서버는 클라이언트 Content-Type 을 믿지 않는다 (specs/features/F-209.md 2.2)

export type ImageExt = 'png' | 'jpg' | 'gif' | 'webp'

export type SniffResult = {
  ext: ImageExt
  mime: string
  width: number
  height: number
}

const MAX_PIXELS = 40_000_000

const MIME: Record<ImageExt, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function asciiAt(bytes: Uint8Array, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i])
  return s
}

function sniffPngDims(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < 24) return null
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return null
  }
  if (asciiAt(bytes, 12, 4) !== 'IHDR') return null
  return { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
}

function sniffGifDims(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10) return null
  const header = asciiAt(bytes, 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  return { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) }
}

// FFD8FF 로 시작, SOFn(0xC0~0xCF, DHT·JPG·DAC 제외) 마커의 높이·너비를 찾는다
function sniffJpegDims(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = readUint16BE(bytes, offset + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      if (offset + 9 > bytes.length) return null
      const height = readUint16BE(bytes, offset + 5)
      const width = readUint16BE(bytes, offset + 7)
      return { width, height }
    }
    offset += 2 + length
  }
  return null
}

function sniffWebpDims(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 21) return null
  if (asciiAt(bytes, 0, 4) !== 'RIFF' || asciiAt(bytes, 8, 4) !== 'WEBP') return null
  const fourCc = asciiAt(bytes, 12, 4)
  if (fourCc === 'VP8 ') {
    if (bytes.length < 30) return null
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff }
  }
  if (fourCc === 'VP8L') {
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (fourCc === 'VP8X') {
    if (bytes.length < 30) return null
    return {
      width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
      height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
    }
  }
  return null
}

function finalize(ext: ImageExt, dims: { width: number; height: number } | null): SniffResult | null {
  if (!dims) return null
  const { width, height } = dims
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  if (width * height > MAX_PIXELS) return null
  return { ext, mime: MIME[ext], width, height }
}

// 앞부분 바이트로 실제 형식·가로세로를 판정한다. 판정 실패·가로세로 0·픽셀 수 초과는 null (2.2, 2.4)
export function sniffImage(bytes: Uint8Array): SniffResult | null {
  return (
    finalize('png', sniffPngDims(bytes)) ??
    finalize('jpg', sniffJpegDims(bytes)) ??
    finalize('gif', sniffGifDims(bytes)) ??
    finalize('webp', sniffWebpDims(bytes))
  )
}
