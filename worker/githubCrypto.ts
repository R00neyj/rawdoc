// GitHub 토큰 봉투 — AES-256-GCM, 저장 글자 v1.{iv}.{암호문}, AAD github:{userId}:{kind} (specs/features/F-3014.md 2장)

export type TokenKind = 'access' | 'refresh'

const IV_BYTES = 12
const encoder = new TextEncoder()
const decoder = new TextDecoder()

let cachedKeyText: string | null = null
let cachedKey: CryptoKey | null = null

function toBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 다시 인코딩해 같은 글자일 때만 받는다 — 끝 글자의 남는 비트만 바꾼 변조도 걸러진다
function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  let binary: string
  try {
    binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return toBase64Url(bytes) === text ? bytes : null
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function aad(userId: string, kind: TokenKind): Uint8Array {
  return encoder.encode(`github:${userId}:${kind}`)
}

export async function importTokenKey(base64: string | undefined): Promise<CryptoKey | null> {
  if (!base64) return null
  if (base64 === cachedKeyText) return cachedKey
  const raw = decodeBase64(base64)
  if (!raw || raw.length !== 32) return null
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    cachedKeyText = base64
    cachedKey = key
    return key
  } catch {
    return null
  }
}

export async function sealToken(key: CryptoKey, userId: string, kind: TokenKind, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, kind) }, key, encoder.encode(token))
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`
}

export async function openToken(key: CryptoKey, userId: string, kind: TokenKind, sealed: string): Promise<string | null> {
  const parts = sealed.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') return null
  const iv = fromBase64Url(parts[1])
  const body = fromBase64Url(parts[2])
  if (!iv || iv.length !== IV_BYTES || !body) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(userId, kind) }, key, body)
    return decoder.decode(plain)
  } catch {
    return null
  }
}
