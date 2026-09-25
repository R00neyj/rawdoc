// 복구 코드 20 B ↔ 표기 문자열 — Crockford base32, 검사 글자 없음 (F-403 6장). 난수를 만들지 않는다
export const RECOVERY_CODE_BYTES = 20

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // I L O U 없음

const DECODE_TABLE = new Int8Array(128).fill(-1)
for (let i = 0; i < ALPHABET.length; i++) DECODE_TABLE[ALPHABET.charCodeAt(i)] = i

export function encodeRecoveryCode(bytes: Uint8Array): string {
  if (bytes.length !== RECOVERY_CODE_BYTES) throw new RangeError(`recovery code must be ${RECOVERY_CODE_BYTES} bytes`)

  // 160비트를 5비트씩 32자로. 앞 바이트의 높은 비트부터
  let bitBuffer = 0
  let bitCount = 0
  let out = ''
  for (const byte of bytes) {
    bitBuffer = (bitBuffer << 8) | byte
    bitCount += 8
    while (bitCount >= 5) {
      bitCount -= 5
      out += ALPHABET[(bitBuffer >> bitCount) & 0x1f]
    }
  }
  if (bitCount > 0) out += ALPHABET[(bitBuffer << (5 - bitCount)) & 0x1f]

  const groups: string[] = []
  for (let i = 0; i < out.length; i += 4) groups.push(out.slice(i, i + 4))
  return groups.join('-')
}

export function parseRecoveryCode(input: string): Uint8Array<ArrayBuffer> | null {
  let s = input.normalize('NFKC').toUpperCase()
  s = s.replace(/[\s\-‐-―−]/g, '')
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1')
  if (s.length !== 32) return null

  let bitBuffer = 0
  let bitCount = 0
  const out = new Uint8Array(RECOVERY_CODE_BYTES)
  let outIndex = 0
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    const value = code < 128 ? DECODE_TABLE[code] : -1
    if (value < 0) return null
    bitBuffer = (bitBuffer << 5) | value
    bitCount += 5
    if (bitCount >= 8) {
      bitCount -= 8
      out[outIndex++] = (bitBuffer >> bitCount) & 0xff
    }
  }
  return out
}
