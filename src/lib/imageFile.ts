// 이미지 바이트 형식·가로·세로 판정 (F-156.md 2.2). 순수 함수, File.type·확장자를 믿지 않고 디코딩도 하지 않는다(압축 폭탄 방지)
import type { ImageExt } from './imageBlock'

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

type Dims = { width: number; height: number }

function matchesAt(bytes: Uint8Array, offset: number, seq: number[]): boolean {
  if (bytes.length < offset + seq.length) return false
  for (let i = 0; i < seq.length; i++) {
    if (bytes[offset + i] !== seq[i]) return false
  }
  return true
}

function asciiAt(bytes: Uint8Array, offset: number, len: number): string | null {
  if (bytes.length < offset + len) return null
  let s = ''
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[offset + i])
  return s
}

function readPng(bytes: Uint8Array): Dims | null {
  if (!matchesAt(bytes, 0, PNG_SIG)) return null
  if (bytes.length < 24) return null
  if (asciiAt(bytes, 12, 4) !== 'IHDR') return null
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]
  return { width: width >>> 0, height: height >>> 0 }
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])
const NO_LENGTH_MARKERS = new Set([0x01, 0xd8, 0xd9])

function readJpeg(bytes: Uint8Array): Dims | null {
  if (!matchesAt(bytes, 0, [0xff, 0xd8, 0xff])) return null
  let pos = 2
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) return null
    let marker = bytes[pos + 1]
    let skip = pos + 2
    while (marker === 0xff && skip < bytes.length) {
      marker = bytes[skip]
      skip++
    }
    pos = skip
    if (marker === 0xd9 || NO_LENGTH_MARKERS.has(marker) || (marker >= 0xd0 && marker <= 0xd7)) {
      if (marker === 0xd9) return null
      continue
    }
    if (pos + 1 >= bytes.length) return null
    const segLen = (bytes[pos] << 8) | bytes[pos + 1]
    if (segLen < 2) return null
    if (SOF_MARKERS.has(marker)) {
      if (pos + 6 >= bytes.length) return null
      const height = (bytes[pos + 3] << 8) | bytes[pos + 4]
      const width = (bytes[pos + 5] << 8) | bytes[pos + 6]
      return { width, height }
    }
    pos += segLen
  }
  return null
}

function readGif(bytes: Uint8Array): Dims | null {
  const header = asciiAt(bytes, 0, 6)
  if (header !== 'GIF87a' && header !== 'GIF89a') return null
  if (bytes.length < 10) return null
  const width = bytes[6] | (bytes[7] << 8)
  const height = bytes[8] | (bytes[9] << 8)
  return { width, height }
}

function readWebp(bytes: Uint8Array): Dims | null {
  if (!matchesAt(bytes, 0, [0x52, 0x49, 0x46, 0x46])) return null // RIFF
  if (asciiAt(bytes, 8, 4) !== 'WEBP') return null
  const fourcc = asciiAt(bytes, 12, 4)
  const dataStart = 20

  if (fourcc === 'VP8 ') {
    if (bytes.length < dataStart + 10) return null
    const width = bytes[dataStart + 6] | ((bytes[dataStart + 7] & 0x3f) << 8)
    const height = bytes[dataStart + 8] | ((bytes[dataStart + 9] & 0x3f) << 8)
    return { width, height }
  }
  if (fourcc === 'VP8L') {
    if (bytes.length < dataStart + 5) return null
    if (bytes[dataStart] !== 0x2f) return null
    const b0 = bytes[dataStart + 1]
    const b1 = bytes[dataStart + 2]
    const b2 = bytes[dataStart + 3]
    const b3 = bytes[dataStart + 4]
    const width = ((b1 & 0x3f) << 8 | b0) + 1
    const height = (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) + 1
    return { width, height }
  }
  if (fourcc === 'VP8X') {
    if (bytes.length < dataStart + 10) return null
    const width = (bytes[dataStart + 4] | (bytes[dataStart + 5] << 8) | (bytes[dataStart + 6] << 16)) + 1
    const height = (bytes[dataStart + 7] | (bytes[dataStart + 8] << 8) | (bytes[dataStart + 9] << 16)) + 1
    return { width, height }
  }
  return null
}

const FORMATS: { mime: string; ext: ImageExt; read: (bytes: Uint8Array) => Dims | null }[] = [
  { mime: 'image/png', ext: 'png', read: readPng },
  { mime: 'image/jpeg', ext: 'jpg', read: readJpeg },
  { mime: 'image/gif', ext: 'gif', read: readGif },
  { mime: 'image/webp', ext: 'webp', read: readWebp },
]

export type InspectedImage = { mime: string; ext: ImageExt; width: number; height: number }

// 파일 앞부분 바이트(시그니처)로 형식을 정하고 헤더에서 가로·세로를 읽는다. SVG·글자 파일·형식 모름·잘린 헤더는 null
export function inspectImageBytes(bytes: Uint8Array | null | undefined): InspectedImage | null {
  if (!bytes || bytes.length === 0) return null
  for (const format of FORMATS) {
    const dims = format.read(bytes)
    if (!dims) continue
    if (!Number.isFinite(dims.width) || !Number.isFinite(dims.height)) continue
    if (dims.width <= 0 || dims.height <= 0) continue
    return { mime: format.mime, ext: format.ext, width: dims.width, height: dims.height }
  }
  return null
}
