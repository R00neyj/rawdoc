// 웹 푸시 구독 API 몸통·응답 타입 — 앱·Worker 공용 (specs/features/F-3003.md 5.1)
export const PUSH_API_MAX_BODY_BYTES = 2048

export type PushKeyResponse = { publicKey: string }
export type PushSubscribeBody = { endpoint: string; keys: { p256dh: string; auth: string } }
export type PushEndpointBody = { endpoint: string }
export type PushApiError =
  | { error: 'push_unavailable' }
  | { error: 'invalid'; field?: 'endpoint' | 'keys' }
  | { error: 'unsupported_push_service' }
  | { error: 'too_large'; limit: 2048 }
  | { error: 'not_found' }
  | { error: 'push_failed'; status: number | null }
