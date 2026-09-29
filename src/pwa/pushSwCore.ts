// 서비스 워커 푸시 처리기의 순수 규칙 — push-sw.js 크기 상한 때문에 pushPayload 하나만 import 한다 (specs/features/F-3004.md 3장)
import { FALLBACK_NOTIFICATION, readPushPayload, safePushUrl } from '../lib/pushPayload'

export const PUSH_ICON_URL = '/icons/icon-192.png'
export const PUSH_BADGE_URL = '/icons/badge-96.png'
export const PUSH_OPEN_MESSAGE = 'push-open'
export const PUSH_SW_MAX_BYTES = 4096

export type PushOpenMessage = { type: 'push-open'; url: string }
export type PushNotificationSpec = {
  title: string
  options: { body: string; tag: string; icon: string; badge: string; lang: 'ko'; data: { url: string } }
}
export type PushWindowCandidate = { url: string; focused: boolean; visibilityState: string }

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function pushNotificationSpec(text: string | null): PushNotificationSpec {
  const p = readPushPayload(parseJson(text)) ?? FALLBACK_NOTIFICATION
  return {
    title: p.title,
    options: { body: p.body, tag: p.tag, icon: PUSH_ICON_URL, badge: PUSH_BADGE_URL, lang: 'ko', data: { url: p.url } },
  }
}

// 다른 버전의 처리기가 띄운 알림일 수 있어 다시 검사한다 (3.2)
export function pushClickUrl(data: unknown): string {
  return safePushUrl(typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined)
}

function isAppWindow(url: string, origin: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.origin === origin && parsed.pathname === '/'
  } catch {
    return false
  }
}

// Client.url 은 해시 이동을 따라오지 않아 "그 문서를 연 창" 으로는 고르지 않는다 (3.3, m5)
export function pickPushWindow<T extends PushWindowCandidate>(windows: readonly T[], origin: string): T | null {
  const apps = windows.filter((w) => isAppWindow(w.url, origin))
  return apps.find((w) => w.focused) ?? apps.find((w) => w.visibilityState === 'visible') ?? apps[0] ?? null
}
