// 표준 base64 — 표 조회 한 경로, 브라우저·Node 같은 코드 (F-403 4장). Buffer·btoa/atob 를 쓰지 않는다
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const DECODE_TABLE = new Int16Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DECODE_TABLE[ALPHABET.charCodeAt(i)] = i

export function bytesToBase64(bytes: Uint8Array): string {
  const fullGroups = Math.floor(bytes.length / 3)
  const remainder = bytes.length - fullGroups * 3
  const outLen = 4 * Math.ceil(bytes.length / 3)
  const chars = new Uint8Array(outLen === 0 ? 0 : outLen)
  let outIndex = 0
  let i = 0
  for (; i < fullGroups * 3; i += 3) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    chars[outIndex++] = ALPHABET.charCodeAt(b0 >> 2)
    chars[outIndex++] = ALPHABET.charCodeAt(((b0 & 0x03) << 4) | (b1 >> 4))
    chars[outIndex++] = ALPHABET.charCodeAt(((b1 & 0x0f) << 2) | (b2 >> 6))
    chars[outIndex++] = ALPHABET.charCodeAt(b2 & 0x3f)
  }
  if (remainder === 1) {
    const b0 = bytes[i]
    chars[outIndex++] = ALPHABET.charCodeAt(b0 >> 2)
    chars[outIndex++] = ALPHABET.charCodeAt((b0 & 0x03) << 4)
    chars[outIndex++] = '='.charCodeAt(0)
    chars[outIndex++] = '='.charCodeAt(0)
  } else if (remainder === 2) {
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    chars[outIndex++] = ALPHABET.charCodeAt(b0 >> 2)
    chars[outIndex++] = ALPHABET.charCodeAt(((b0 & 0x03) << 4) | (b1 >> 4))
    chars[outIndex++] = ALPHABET.charCodeAt((b1 & 0x0f) << 2)
    chars[outIndex++] = '='.charCodeAt(0)
  }
  return new TextDecoder('latin1').decode(chars)
}

export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length === 0) return new Uint8Array(0)
  if (text.length % 4 !== 0) return null

  let padding = 0
  if (text.charCodeAt(text.length - 1) === 61 /* '=' */) padding++
  if (padding === 1 && text.charCodeAt(text.length - 2) === 61) padding++
  // '=' 는 끝의 1개 또는 2개만 — 다른 위치에 있으면 거절
  for (let i = 0; i < text.length - padding; i++) {
    if (text.charCodeAt(i) === 61) return null
  }

  const groups = text.length / 4
  const outLen = groups * 3 - padding
  const out = new Uint8Array(outLen)
  let outIndex = 0
  for (let g = 0; g < groups; g++) {
    const isLast = g === groups - 1
    const charsInGroup = isLast ? 4 - padding : 4
    let bits = 0
    for (let j = 0; j < 4; j++) {
      const ch = text.charCodeAt(g * 4 + j)
      if (j < charsInGroup) {
        if (ch >= 128) return null
        const value = DECODE_TABLE[ch]
        if (value < 0) return null
        bits = (bits << 6) | value
      } else {
        // 패딩 문자 자리 — 값을 넣지 않고 자리만 채운다(아래 정규형 검사에서 처리)
        bits = bits << 6
      }
    }
    if (charsInGroup === 4) {
      out[outIndex++] = (bits >> 16) & 0xff
      out[outIndex++] = (bits >> 8) & 0xff
      out[outIndex++] = bits & 0xff
    } else if (charsInGroup === 3) {
      // 마지막 글자가 패딩 하나 — 24비트 중 앞 16비트가 바이트 둘, 나머지 8비트는 0이어야 정규형
      if ((bits & 0xff) !== 0) return null
      out[outIndex++] = (bits >> 16) & 0xff
      out[outIndex++] = (bits >> 8) & 0xff
    } else if (charsInGroup === 2) {
      // 마지막 두 글자가 패딩 — 24비트 중 앞 8비트가 바이트 하나, 나머지 16비트는 0이어야 정규형
      if ((bits & 0xffff) !== 0) return null
      out[outIndex++] = (bits >> 16) & 0xff
    } else {
      return null
    }
  }
  return out
}
