// 웹 푸시 — VAPID(RFC 8292)·aes128gcm 암호화(RFC 8291)·전송(RFC 8030). 라이브러리 없이 WebCrypto 만 (specs/features/F-3002.md 3장)
import { encodePushPayload, PUSH_TTL_SEC, VAPID_JWT_TTL_SEC, type PushPayload } from '../src/lib/pushPayload'

export type VapidKeys = { privateKey: CryptoKey; publicKey: string }
export type VapidAuth = { header(audience: string, nowMs: number): Promise<string> }
export type PushKeys = { p256dh: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> }
export type PushTarget = { endpoint: string; p256dh: string; auth: string }
export type PushOutcome = 'sent' | 'gone' | 'transient' | 'rejected'
export type PushSendResult = { outcome: PushOutcome; status: number | null }
export type PushEncryptSeed = { salt: Uint8Array<ArrayBuffer>; senderPrivateKey: CryptoKey; senderPublicKey: Uint8Array<ArrayBuffer> }

export const PUSH_SERVICE_HOSTS: readonly string[] = [
  'fcm.googleapis.com', // Chrome·안드로이드·삼성 인터넷·Opera
  'updates.push.services.mozilla.com', // Firefox
  '.push.apple.com', // Safari·iOS
  '.notify.windows.com', // Edge
] as const
export const PUSH_ENDPOINT_MAX_CHARS = 1024
export const PUSH_RECORD_SIZE = 4096
export const PUSH_SEND_TIMEOUT_MS = 10_000
export const VAPID_JWT_REFRESH_SEC = 3_600

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const
const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const
const TOPIC_RE = /^[A-Za-z0-9_-]{1,32}$/
const JWT_HEADER = '{"typ":"JWT","alg":"ES256"}'
const RECORD_OVERHEAD = 17 // AES-GCM 태그 16 + 구분 바이트 0x02
const encoder = new TextEncoder()

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 알파벳 밖 글자(+ / 공백 포함)는 거절, 끝의 = 패딩만 허용
function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(input)) return null
  const bare = input.replace(/=+$/, '')
  const b64 = bare.replace(/-/g, '+').replace(/_/g, '/')
  let binary: string
  try {
    binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  } catch {
    return null
  }
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8))
}

function readCoordinate(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== 'string') return null
  const bytes = base64UrlToBytes(value)
  return bytes !== null && bytes.length === 32 ? bytes : null
}

// 잘못된 비밀 값은 던지지 않고 null — 부르는 쪽이 푸시 꺼짐으로 다룬다 (3.2)
export async function importVapidKey(secret: string | undefined): Promise<VapidKeys | null> {
  if (!secret) return null
  let jwk: unknown
  try {
    jwk = JSON.parse(secret)
  } catch {
    return null
  }
  if (typeof jwk !== 'object' || jwk === null || Array.isArray(jwk)) return null
  const { kty, crv, d, x, y } = jwk as Record<string, unknown>
  if (kty !== 'EC' || crv !== 'P-256') return null
  const dBytes = readCoordinate(d)
  const xBytes = readCoordinate(x)
  const yBytes = readCoordinate(y)
  if (!dBytes || !xBytes || !yBytes) return null
  let privateKey: CryptoKey
  try {
    const clean = { kty: 'EC', crv: 'P-256', d: bytesToBase64Url(dBytes), x: bytesToBase64Url(xBytes), y: bytesToBase64Url(yBytes) }
    privateKey = await crypto.subtle.importKey('jwk', clean, ES256, false, ['sign'])
  } catch {
    return null
  }
  return { privateKey, publicKey: bytesToBase64Url(concatBytes(new Uint8Array([4]), xBytes, yBytes)) }
}

export async function vapidJwt(keys: VapidKeys, audience: string, subject: string, nowMs: number): Promise<string> {
  const header = bytesToBase64Url(encoder.encode(JWT_HEADER))
  const claims = bytesToBase64Url(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + VAPID_JWT_TTL_SEC, sub: subject })))
  const signed = `${header}.${claims}`
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(signed))
  return `${signed}.${bytesToBase64Url(new Uint8Array(signature))}`
}

export function createVapidAuth(keys: VapidKeys, subject: string): VapidAuth {
  const cache = new Map<string, { exp: number; value: string }>()
  return {
    async header(audience, nowMs) {
      const hit = cache.get(audience)
      if (hit && nowMs / 1000 < hit.exp - VAPID_JWT_REFRESH_SEC) return hit.value
      const exp = Math.floor(nowMs / 1000) + VAPID_JWT_TTL_SEC
      const value = `vapid t=${await vapidJwt(keys, audience, subject, nowMs)}, k=${keys.publicKey}`
      cache.set(audience, { exp, value })
      return value
    },
  }
}

// 곡선 밖 점은 importKey 가 거절한다 — 그래서 비동기 (3.4)
export async function readPushKeys(p256dh: string, auth: string): Promise<PushKeys | null> {
  const key = base64UrlToBytes(p256dh)
  const secret = base64UrlToBytes(auth)
  if (!key || key.length !== 65 || key[0] !== 0x04) return null
  if (!secret || secret.length !== 16) return null
  try {
    await crypto.subtle.importKey('raw', key, P256, false, [])
  } catch {
    return null
  }
  return { p256dh: key, auth: secret }
}

// RFC 8291 3.4 — 레코드 하나, 채움 없음. seed 는 테스트 전용
export async function encryptPushPayload(plaintext: Uint8Array, keys: PushKeys, seed?: PushEncryptSeed): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > PUSH_RECORD_SIZE - RECORD_OVERHEAD) throw new RangeError('push plaintext does not fit one record')
  let salt: Uint8Array<ArrayBuffer>
  let senderPrivateKey: CryptoKey
  let senderPublicKey: Uint8Array<ArrayBuffer>
  if (seed) {
    ;({ salt, senderPrivateKey, senderPublicKey } = seed)
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16))
    const pair = (await crypto.subtle.generateKey(P256, false, ['deriveBits'])) as CryptoKeyPair
    senderPrivateKey = pair.privateKey
    senderPublicKey = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  }
  const receiverKey = await crypto.subtle.importKey('raw', keys.p256dh, P256, false, [])
  const ecdh = { name: 'ECDH', public: receiverKey } // Workers 타입은 public 을 $public 으로 적어 리터럴로 못 넘긴다
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, senderPrivateKey, 256))
  const keyInfo = concatBytes(encoder.encode('WebPush: info\0'), keys.p256dh, senderPublicKey)
  const ikm = await hkdf(keys.auth, ecdhSecret, keyInfo, 32)
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12)
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const record = concatBytes(plaintext, new Uint8Array([0x02]))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, record))
  const recordSize = new Uint8Array(4)
  new DataView(recordSize.buffer).setUint32(0, PUSH_RECORD_SIZE)
  return concatBytes(salt, recordSize, new Uint8Array([senderPublicKey.length]), senderPublicKey, cipher)
}

function hostAllowed(hostname: string): boolean {
  return PUSH_SERVICE_HOSTS.some((h) => (h.startsWith('.') ? hostname.length > h.length && hostname.endsWith(h) : hostname === h))
}

export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length < 1 || endpoint.length > PUSH_ENDPOINT_MAX_CHARS) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return false
  return hostAllowed(url.hostname)
}

export function pushAudience(endpoint: string): string | null {
  return isAllowedPushEndpoint(endpoint) ? new URL(endpoint).origin : null
}

export function pushTopic(docId: string): string | null {
  const topic = docId.replace(/-/g, '')
  return TOPIC_RE.test(topic) ? topic : null
}

export function classifyPushStatus(status: number | null): PushOutcome {
  if (status === null) return 'transient'
  if (status >= 200 && status <= 299) return 'sent'
  if (status === 404 || status === 410) return 'gone'
  if (status === 429 || (status >= 500 && status <= 599)) return 'transient'
  return 'rejected'
}

export async function buildPushRequest(
  target: PushTarget,
  payload: PushPayload,
  vapid: VapidAuth,
  nowMs: number,
  topic?: string,
): Promise<{ url: string; init: RequestInit } | { outcome: 'gone' | 'transient' }> {
  const audience = pushAudience(target.endpoint)
  if (audience === null) return { outcome: 'gone' }
  const keys = await readPushKeys(target.p256dh, target.auth)
  if (!keys) return { outcome: 'gone' }
  const plaintext = encodePushPayload(payload)
  if (!plaintext) return { outcome: 'transient' }
  const body = await encryptPushPayload(plaintext, keys)
  const headers: Record<string, string> = {
    TTL: String(PUSH_TTL_SEC),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    Urgency: 'normal',
    Authorization: await vapid.header(audience, nowMs),
  }
  if (topic !== undefined && TOPIC_RE.test(topic)) headers.Topic = topic
  return { url: target.endpoint, init: { method: 'POST', redirect: 'manual', headers, body } }
}

// 던지지 않는다 — 요청을 못 만든 까닭이 우리 쪽 실패(서명·암호화)면 transient (3.6)
export async function sendPush(
  target: PushTarget,
  payload: PushPayload,
  vapid: VapidAuth,
  nowMs: number,
  topic?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PushSendResult> {
  let built: Awaited<ReturnType<typeof buildPushRequest>>
  try {
    built = await buildPushRequest(target, payload, vapid, nowMs, topic)
  } catch {
    return { outcome: 'transient', status: null }
  }
  if ('outcome' in built) return { outcome: built.outcome, status: null }
  let res: Response
  try {
    res = await fetchImpl(built.url, { ...built.init, signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS) })
  } catch {
    return { outcome: 'transient', status: null }
  }
  res.body?.cancel().catch(() => {}) // 몸통은 읽지 않고 닫는다 — Workers 문서 권고(메모리)
  return { outcome: classifyPushStatus(res.status), status: res.status }
}
