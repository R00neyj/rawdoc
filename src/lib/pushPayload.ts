// 푸시 본문 계약·서버 상수·모양 검사 — Worker·서비스 워커·앱 공용이라 아무것도 import 하지 않는다 (specs/features/F-3002.md 4장)
export const PUSH_BATCH_MS = 180_000
export const PUSH_PRESENCE_FRESH_MS = 90_000
export const PUSH_STALE_MS = 3_600_000
export const PUSH_TTL_SEC = 86_400
export const PUSH_SENDS_PER_RUN_MAX = 40
export const PUSH_SUBSCRIPTIONS_PER_USER_MAX = 5
export const PUSH_PAYLOAD_MAX_BYTES = 3_000
export const PUSH_EXCERPT_CHARS = 80
export const PUSH_SHARE_DEDUPE_MS = 600_000
export const PUSH_QUOTA_RATIO = 0.9
export const PUSH_QUOTA_REPEAT_MS = 604_800_000
export const VAPID_JWT_TTL_SEC = 43_200

export type PushTag = `doc:${string}` | `share:${string}` | 'quota' | 'test'
export type PushPayload = { v: 1; title: string; body: string; tag: PushTag; url: string }
export type FallbackNotification = { title: '새 알림'; body: ''; tag: 'fallback'; url: '/' }

export const FALLBACK_NOTIFICATION: FallbackNotification = { title: '새 알림', body: '', tag: 'fallback', url: '/' }

const PAYLOAD_KEYS = ['v', 'title', 'body', 'tag', 'url'] as const
const TAG_RE = /^(doc|share):[0-9A-Za-z-]{1,64}$/
const URL_CHECK_BASE = 'https://x.invalid' // 판정용 자리표시 출처 — 어디에도 요청하지 않는다

function isPushTag(tag: unknown): tag is PushTag {
  return typeof tag === 'string' && (tag === 'quota' || tag === 'test' || TAG_RE.test(tag))
}

export function safePushUrl(url: unknown): string {
  if (typeof url !== 'string' || !url.startsWith('/')) return '/'
  try {
    return new URL(url, URL_CHECK_BASE).origin === URL_CHECK_BASE ? url : '/'
  } catch {
    return '/'
  }
}

export function readPushPayload(json: unknown): PushPayload | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const obj = json as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length !== PAYLOAD_KEYS.length || !PAYLOAD_KEYS.every((k) => Object.prototype.hasOwnProperty.call(obj, k))) return null
  if (obj.v !== 1) return null
  if (typeof obj.title !== 'string' || obj.title === '') return null
  if (typeof obj.body !== 'string' || typeof obj.url !== 'string') return null
  if (!isPushTag(obj.tag)) return null
  return { v: 1, title: obj.title, body: obj.body, tag: obj.tag, url: safePushUrl(obj.url) }
}

function encodeJson(payload: PushPayload): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(JSON.stringify(payload))) // Workers 타입의 encode 는 ArrayBufferLike 라 복사로 좁힌다
}

// 넘으면 body 만 코드 포인트 머리 + … 로 줄인다. 크기가 머리 길이에 단조라 이분 탐색 (4.3)
export function encodePushPayload(payload: PushPayload): Uint8Array<ArrayBuffer> | null {
  const whole = encodeJson(payload)
  if (whole.length <= PUSH_PAYLOAD_MAX_BYTES) return whole
  const empty = encodeJson({ ...payload, body: '' })
  if (empty.length > PUSH_PAYLOAD_MAX_BYTES) return null
  const chars = [...payload.body]
  const fits = (n: number) => encodeJson({ ...payload, body: chars.slice(0, n).join('') + '…' })
  let lo = -1
  let hi = chars.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2)
    if (fits(mid).length <= PUSH_PAYLOAD_MAX_BYTES) lo = mid
    else hi = mid - 1
  }
  return lo < 0 ? empty : fits(lo)
}
