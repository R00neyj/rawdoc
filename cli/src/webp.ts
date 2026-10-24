// 올릴 PNG·JPEG 를 더 작아질 때만 WebP 로 — 브라우저 src/storage/toWebp.ts 와 같은 규칙 (F-2144 2장)
import initPng, { decode as decodePng } from '@jsquash/png/codec/pkg/squoosh_png.js'
import mozjpegDec, { type MozJPEGModule } from '@jsquash/jpeg/codec/dec/mozjpeg_dec.js'
import webpEncSimd from '@jsquash/webp/codec/enc/webp_enc_simd.js'
import type { WebPModule } from '@jsquash/webp/codec/enc/webp_enc.js'
import { defaultOptions } from '@jsquash/webp/meta.js'
import { initEmscriptenModule } from '@jsquash/webp/utils.js'
import pngWasm from '@jsquash/png/codec/pkg/squoosh_png_bg.wasm?url&inline'
import jpegWasm from '@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?url&inline'
import webpWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url&inline'
import { inspectImageBytes } from '../../src/lib/image/imageFile'

// worker/imageSniff.ts MAX_PIXELS — 서버가 거부할 크기를 wasm 메모리에 풀지 않는다
const MAX_PIXELS = 40_000_000
// 코덱이 터미널에 아무것도 쓰지 않게 (F-2021 4.1) — Premature end of JPEG file 같은 경고를 버린다
const SILENT = { print: () => {}, printErr: () => {} }

type Codecs = { jpeg: MozJPEGModule; webp: WebPModule }
let codecs: Promise<Codecs> | null = null

function compile(dataUrl: string): WebAssembly.Module {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new WebAssembly.Module(bytes)
}

// 첫 PNG·JPEG 에서 한 번만 컴파일한다 — 다른 명령은 wasm 비용이 없다
function loadCodecs(): Promise<Codecs> {
  codecs ??= Promise.all([
    initPng(compile(pngWasm)),
    initEmscriptenModule<MozJPEGModule>(mozjpegDec, compile(jpegWasm), SILENT),
    initEmscriptenModule<WebPModule>(webpEncSimd, compile(webpWasm), SILENT),
  ]).then(([, jpeg, webp]) => ({ jpeg, webp }))
  return codecs
}

export async function toWebpBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const image = inspectImageBytes(bytes)
  if (!image || (image.ext !== 'png' && image.ext !== 'jpg')) return bytes
  if (image.width * image.height > MAX_PIXELS) return bytes
  try {
    const { jpeg, webp } = await loadCodecs()
    // EXIF 는 변환에서 사라지므로 JPEG 방향을 픽셀에 굽는다
    const pixels = image.ext === 'png' ? decodePng(bytes) : jpeg.decode(bytes as Uint8Array<ArrayBuffer>, true)
    if (!pixels) return bytes
    const out = webp.encode(pixels.data, pixels.width, pixels.height, { ...defaultOptions, quality: 90 })
    return out && out.length < bytes.length ? out : bytes
  } catch {
    return bytes
  }
}
