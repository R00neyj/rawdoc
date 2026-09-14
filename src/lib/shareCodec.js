// 문서 ↔ 공유 링크 조각 인코딩 — 순수 함수, 비동기 (specs/features/F-130.md 3.3)
// 조각 = base64url(패딩 없음)( deflate-raw( UTF-8( JSON ) ) )
// JSON: { v:1, t:제목, c:본문(LF 로 이은 원문), e:"crlf"|"lf" }
import { toEditorText, fromEditorText } from './lineEnding.js'

const SHARE_VERSION = 1

// 풀린 바이트가 이 값을 넘으면 읽기를 멈추고 거부한다 — 조작된 링크로 탭이 멈추는 것을
// 막는다 (F-138 3.6). 스트림을 읽으면서 누적 크기로 판정한다
const MAX_DECOMPRESSED_BYTES = 20 * 1024 * 1024

function toBase64Url(bytes) {
  let binary = ''
  const chunkSize = 0x8000 // String.fromCharCode 인자 개수 상한을 피하기 위한 묶음 처리
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(fragment) {
  if (!/^[A-Za-z0-9_-]+$/.test(fragment)) {
    throw new Error('base64url 이 아닌 문자가 있습니다')
  }
  let base64 = fragment.replace(/-/g, '+').replace(/_/g, '/')
  const pad = base64.length % 4
  if (pad === 1) {
    throw new Error('조각 길이가 올바르지 않습니다')
  }
  if (pad === 2) base64 += '=='
  else if (pad === 3) base64 += '='

  let binary
  try {
    binary = atob(base64)
  } catch {
    throw new Error('base64 디코딩에 실패했습니다')
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// writer.write/close 가 반환하는 프라미스를 그냥 버리면, 스트림이 오류로 끝날 때
// (예: decompress 에 잘린 데이터가 들어올 때) 그 프라미스도 함께 거부되어
// 아래 Response(...).arrayBuffer() 의 거부와 별개로 unhandled rejection 이 발생한다.
// 실제 오류는 arrayBuffer() 쪽 거부로 propagate 시키고, write/close 쪽은 즉시 catch 해 둔다
async function compress(bytes) {
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  const writeDone = writer.write(bytes).catch(() => {})
  const closeDone = writer.close().catch(() => {})
  try {
    return new Uint8Array(await new Response(cs.readable).arrayBuffer())
  } finally {
    await writeDone
    await closeDone
  }
}

// 풀린 바이트를 한 번에 buffer 하지 않고 스트림을 읽으면서 누적 크기를 잰다 —
// `maxBytes` 를 넘는 순간 더 읽지 않고 거부한다(F-138 3.6). 테스트에서 실제 20MB
// 데이터를 만드는 대신 `maxBytes` 를 작은 값으로 넘겨 빠르게 확인할 수 있도록
// export 한다.
export async function decompress(bytes, maxBytes = MAX_DECOMPRESSED_BYTES) {
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  const writeDone = writer.write(bytes).catch(() => {})
  const closeDone = writer.close().catch(() => {})
  const reader = ds.readable.getReader()

  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`압축 해제 결과가 상한(${maxBytes} 바이트)을 넘었습니다`)
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    await writeDone
    await closeDone
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

/**
 * @param {{ title:string, content:string, lineEnding:'crlf'|'lf' }} doc `content` 는 줄
 *   구분이 `lineEnding` 인 원문. JSON `c` 에는 LF 로 바꿔 넣는다
 * @returns {Promise<string>} base64url(패딩 없음) 조각
 */
export async function encodeShare({ title, content, lineEnding }) {
  const json = {
    v: SHARE_VERSION,
    t: title ?? '',
    c: toEditorText(content ?? ''),
    e: lineEnding,
  }
  const bytes = new TextEncoder().encode(JSON.stringify(json))
  const compressed = await compress(bytes)
  return toBase64Url(compressed)
}

/**
 * @param {string} fragment
 * @returns {Promise<{ title:string, content:string, lineEnding:'crlf'|'lf' }>} `content` 는
 *   `lineEnding` 으로 되돌린 원문. 형식이 틀리거나 `v !== 1` 이면 reject
 */
export async function decodeShare(fragment) {
  if (typeof fragment !== 'string' || fragment.length === 0) {
    throw new Error('빈 조각입니다')
  }

  const compressed = fromBase64Url(fragment)

  let bytes
  try {
    bytes = await decompress(compressed)
  } catch {
    throw new Error('압축을 해제할 수 없습니다')
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('UTF-8 로 해석할 수 없습니다')
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('JSON 형식이 아닙니다')
  }

  if (!json || typeof json !== 'object' || json.v !== SHARE_VERSION) {
    throw new Error('지원하지 않는 버전입니다')
  }
  if (typeof json.c !== 'string' || (json.e !== 'crlf' && json.e !== 'lf')) {
    throw new Error('형식이 올바르지 않습니다')
  }

  return {
    title: typeof json.t === 'string' ? json.t : '',
    content: fromEditorText(json.c, json.e),
    lineEnding: json.e,
  }
}
