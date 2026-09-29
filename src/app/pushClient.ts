// 푸시 화면 상태·켜기·끄기·테스트·부팅 다시 알리기 — 순수, 브라우저·fetch·설정은 인자로 받는다 (F-2110)
import type { PushSubscribeBody } from '../lib/pushApi'
import { safePushUrl } from '../lib/pushPayload'
import { PUSH_OPEN_MESSAGE } from '../pwa/pushSwCore'
import { parseHash } from './hashRoute'

export const PUSH_SYNC_INTERVAL_MS = 604_800_000
export const PUSH_SW_READY_TIMEOUT_MS = 10_000

export type PushPermission = 'default' | 'granted' | 'denied'
export type PushKeyState = { kind: 'unknown' } | { kind: 'ok'; publicKey: string } | { kind: 'unavailable' } | { kind: 'error' }

export type PushSubscriptionLike = {
  endpoint: string
  options: { applicationServerKey: ArrayBuffer | null }
  toJSON(): unknown
  unsubscribe(): Promise<boolean>
}
export type PushManagerLike = {
  getSubscription(): Promise<PushSubscriptionLike | null>
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSubscriptionLike>
}
export type PushPlatform = {
  supported(): boolean
  permission(): PushPermission
  requestPermission(): Promise<PushPermission>
  // serviceWorker.ready 를 PUSH_SW_READY_TIMEOUT_MS 까지 기다려 pushManager 를, 넘으면 null
  pushManager(): Promise<PushManagerLike | null>
}
export type PushPrefKey = 'md.push' | 'md.pushSyncedAt'
export type PushDeps = {
  platform: PushPlatform
  fetch: typeof fetch
  now: () => number
  getPref: (key: PushPrefKey) => string
  setPref: (key: PushPrefKey, value: string) => void
}

export type TurnOnResult = 'on' | 'permission-refused' | 'unavailable' | 'unsupported-service' | 'failed'
export type PushSyncOutcome = 'skip' | 'fresh' | 'synced' | 'revoked' | 'unavailable' | 'failed'

// ----- 화면 상태 (3장) -----

export type PushViewKind = 'off' | 'turning-on' | 'on' | 'turning-off' | 'denied' | 'unsupported' | 'unavailable' | 'ios-browser' | 'offline'
export type PushSettingsInput = {
  supported: boolean
  ios: boolean
  standalone: boolean
  permission: PushPermission
  online: boolean
  enabled: boolean
  key: PushKeyState['kind']
  busy: null | 'on' | 'off' | 'test'
}
export type PushSettingsView = {
  kind: PushViewKind
  checked: boolean
  disabled: boolean
  locked: boolean
  note: string
  showTest: boolean
  testDisabled: boolean
  testLocked: boolean
}

const NOTE_READY = '멘션·답글, 내 문서의 새 댓글, 공유 받음, 저장 공간 경고를 이 기기로 보냅니다. 그 문서를 열어 두고 있거나 이미 읽은 알림은 보내지 않습니다.'
const NOTE_IOS = 'iPhone·iPad에서는 홈 화면에 추가한 앱에서만 푸시를 받을 수 있습니다.'
const NOTE_UNSUPPORTED = '이 브라우저는 푸시 알림을 지원하지 않습니다.'
const NOTE_DENIED = '이 사이트의 알림이 브라우저에서 차단되어 있습니다. 브라우저 설정에서 허용한 뒤 다시 켜 주세요.'
const NOTE_OFFLINE = '온라인일 때 바꿀 수 있습니다.'
const NOTE_UNAVAILABLE = '지금은 푸시 알림을 켤 수 없습니다.'

function view(kind: PushViewKind, note: string, rest: Partial<Omit<PushSettingsView, 'kind' | 'note'>> = {}): PushSettingsView {
  return { kind, note, checked: false, disabled: false, locked: false, showTest: false, testDisabled: false, testLocked: false, ...rest }
}

export function pushSettingsView(input: PushSettingsInput): PushSettingsView {
  const { supported, ios, standalone, permission, online, enabled, key, busy } = input
  if (busy === 'on') return view('turning-on', '켜는 중…', { locked: true })
  if (busy === 'off') return view('turning-off', '끄는 중…', { checked: true, locked: true, showTest: true, testLocked: true })
  if (ios && !standalone) return view('ios-browser', NOTE_IOS, { disabled: true })
  if (!supported) return view('unsupported', NOTE_UNSUPPORTED, { disabled: true })
  if (permission === 'denied') return view('denied', NOTE_DENIED, { disabled: true })
  if (!online) return view('offline', NOTE_OFFLINE, { checked: enabled, disabled: true, showTest: enabled, testDisabled: true })
  if (enabled) return view('on', NOTE_READY, { checked: true, locked: busy === 'test', showTest: true, testLocked: busy === 'test' })
  if (key === 'unavailable') return view('unavailable', NOTE_UNAVAILABLE, { disabled: true })
  return view('off', NOTE_READY)
}

export function isIosLike(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (userAgent.includes('Macintosh') && maxTouchPoints > 1)
}

// ----- 키 -----

function decodeServerKey(publicKey: unknown): Uint8Array | null {
  if (typeof publicKey !== 'string' || !/^[A-Za-z0-9_-]+$/.test(publicKey)) return null
  try {
    const std = publicKey.replace(/-/g, '+').replace(/_/g, '/')
    const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return bytes.length === 65 && bytes[0] === 0x04 ? bytes : null
  } catch {
    return null
  }
}

export function sameServerKey(current: ArrayBuffer | null, server: Uint8Array): boolean {
  if (!current) return false
  const a = new Uint8Array(current)
  return a.length === server.length && a.every((v, i) => v === server[i])
}

export async function fetchPushKey(fetchFn: typeof fetch): Promise<PushKeyState> {
  try {
    const res = await fetchFn('/api/push/key', { credentials: 'same-origin' })
    if (res.status === 503) return { kind: 'unavailable' }
    if (res.status !== 200) return { kind: 'error' }
    const body: unknown = await res.json()
    const publicKey = (body as { publicKey?: unknown } | null)?.publicKey
    return decodeServerKey(publicKey) ? { kind: 'ok', publicKey: publicKey as string } : { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

// ----- 요청 -----

function subscribeBody(json: unknown): PushSubscribeBody | null {
  const obj = json as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const p256dh = obj?.keys?.p256dh
  const auth = obj?.keys?.auth
  if (typeof obj?.endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') return null
  return { endpoint: obj.endpoint, keys: { p256dh, auth } }
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

type PutOutcome = 'ok' | 'unsupported' | 'unavailable' | 'failed'

async function putSubscription(deps: PushDeps, sub: PushSubscriptionLike): Promise<PutOutcome> {
  const body = subscribeBody(sub.toJSON())
  if (!body) return 'failed'
  const res = await deps.fetch('/api/push/subscription', jsonInit('PUT', body))
  if (res.status === 204) {
    deps.setPref('md.pushSyncedAt', String(deps.now()))
    return 'ok'
  }
  if (res.status === 503) return 'unavailable'
  if (res.status === 400) {
    const err: unknown = await res.json().catch(() => null)
    if ((err as { error?: unknown } | null)?.error === 'unsupported_push_service') return 'unsupported'
  }
  return 'failed'
}

type RegisterResult = { status: PutOutcome; key: PushKeyState }

// 키 → (pushManager) → 구독 만들기·바꾸기 → PUT
async function registerDevice(deps: PushDeps, key: PushKeyState, manager?: PushManagerLike | null): Promise<RegisterResult> {
  let known = key
  if (known.kind !== 'ok') known = await fetchPushKey(deps.fetch)
  if (known.kind === 'unavailable') return { status: 'unavailable', key: known }
  if (known.kind !== 'ok') return { status: 'failed', key: known }
  const keyBytes = decodeServerKey(known.publicKey)
  const mgr = manager ?? (await deps.platform.pushManager())
  if (!keyBytes || !mgr) return { status: 'failed', key: known }
  let sub = await mgr.getSubscription()
  if (sub && !sameServerKey(sub.options.applicationServerKey, keyBytes)) {
    await sub.unsubscribe().catch(() => false)
    sub = null
  }
  sub ??= await mgr.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes })
  return { status: await putSubscription(deps, sub), key: known }
}

function clearPrefs(deps: PushDeps) {
  deps.setPref('md.push', '')
  deps.setPref('md.pushSyncedAt', '')
}

// ----- 켜기·끄기·테스트 -----

export async function turnOnPush(deps: PushDeps, userId: string, key: PushKeyState): Promise<{ result: TurnOnResult; key: PushKeyState }> {
  let latest = key
  try {
    let permission = deps.platform.permission()
    if (permission === 'default') permission = await deps.platform.requestPermission()
    if (permission !== 'granted') return { result: 'permission-refused', key: latest }
    const registered = await registerDevice(deps, latest)
    latest = registered.key
    if (registered.status === 'ok') {
      deps.setPref('md.push', userId)
      return { result: 'on', key: latest }
    }
    const result: TurnOnResult =
      registered.status === 'unsupported' ? 'unsupported-service' : registered.status === 'unavailable' ? 'unavailable' : 'failed'
    return { result, key: latest }
  } catch {
    return { result: 'failed', key: latest }
  }
}

async function deleteSubscription(deps: PushDeps, sub: PushSubscriptionLike): Promise<boolean> {
  const res = await deps.fetch('/api/push/subscription', jsonInit('DELETE', { endpoint: sub.endpoint }))
  return res.status === 204
}

export async function turnOffPush(deps: PushDeps): Promise<'off' | 'failed'> {
  try {
    const mgr = await deps.platform.pushManager()
    const sub = mgr ? await mgr.getSubscription() : null
    if (sub) {
      if (!(await deleteSubscription(deps, sub))) return 'failed'
      await sub.unsubscribe().catch(() => false)
    }
    clearPrefs(deps)
    return 'off'
  } catch {
    return 'failed'
  }
}

async function postTest(deps: PushDeps, sub: PushSubscriptionLike): Promise<number> {
  return (await deps.fetch('/api/push/test', jsonInit('POST', { endpoint: sub.endpoint }))).status
}

export async function sendTestPush(deps: PushDeps): Promise<'sent' | 'failed'> {
  try {
    const mgr = await deps.platform.pushManager()
    if (!mgr) return 'failed'
    let sub = await mgr.getSubscription()
    if (!sub) {
      const registered = await registerDevice(deps, { kind: 'unknown' }, mgr)
      if (registered.status !== 'ok') return 'failed'
      sub = await mgr.getSubscription()
      if (!sub) return 'failed'
    }
    const first = await postTest(deps, sub)
    if (first === 204) return 'sent'
    if (first !== 404) return 'failed'
    if ((await putSubscription(deps, sub)) !== 'ok') return 'failed'
    return (await postTest(deps, sub)) === 204 ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

// ----- 부팅 다시 알리기 (4.4) -----

export type PushSyncInput = {
  userId: string
  push: string
  syncedAt: string
  now: number
  supported: boolean
  permission: PushPermission
  hasSubscription: boolean
}
export type PushSyncDecision = 'skip' | 'revoke' | 'subscribe' | 'fresh' | 'refresh'

export function decidePushSync(input: PushSyncInput): PushSyncDecision {
  if (input.push !== input.userId) return 'skip'
  if (!input.supported) return 'skip'
  if (input.permission !== 'granted') return 'revoke'
  if (!input.hasSubscription) return 'subscribe'
  const at = /^\d+$/.test(input.syncedAt) ? Number(input.syncedAt) : NaN
  const age = input.now - at
  return age >= 0 && age < PUSH_SYNC_INTERVAL_MS ? 'fresh' : 'refresh'
}

export async function syncPushOnBoot(deps: PushDeps, userId: string): Promise<PushSyncOutcome> {
  try {
    const input = {
      userId,
      push: deps.getPref('md.push'),
      syncedAt: deps.getPref('md.pushSyncedAt'),
      now: deps.now(),
      supported: deps.platform.supported(),
      permission: deps.platform.permission(),
    }
    const early = decidePushSync({ ...input, hasSubscription: true })
    if (early === 'skip') return 'skip'
    const mgr = await deps.platform.pushManager()
    if (!mgr) return 'failed'
    const sub = await mgr.getSubscription()
    if (early === 'revoke') {
      if (sub) {
        await deleteSubscription(deps, sub).catch(() => false)
        await sub.unsubscribe().catch(() => false)
      }
      clearPrefs(deps)
      return 'revoked'
    }
    const decision = decidePushSync({ ...input, hasSubscription: sub !== null })
    if (decision === 'fresh') return 'fresh'
    const registered = await registerDevice(deps, { kind: 'unknown' }, mgr)
    if (registered.status === 'ok') return 'synced'
    if (registered.status === 'unavailable') return 'unavailable'
    if (registered.status === 'unsupported') clearPrefs(deps)
    return 'failed'
  } catch {
    return 'failed'
  }
}

// ----- push-open (5.2) -----

export type PushOpenTarget = { kind: 'none' } | { kind: 'hash'; hash: string; docId: string } | { kind: 'reload'; url: string }

export function isPublicBoot(hash: string): boolean {
  const type = parseHash(hash).type
  return type === 'public' || type === 'publicFolder'
}

export function pushOpenTarget(data: unknown, bootedPublic: boolean): PushOpenTarget {
  const none: PushOpenTarget = { kind: 'none' }
  if (typeof data !== 'object' || data === null) return none
  const { type, url } = data as { type?: unknown; url?: unknown }
  if (type !== PUSH_OPEN_MESSAGE || typeof url !== 'string') return none
  const safe = safePushUrl(url)
  const hashAt = safe.indexOf('#')
  const path = (hashAt < 0 ? safe : safe.slice(0, hashAt)).split('?')[0]
  if (path !== '/') return none
  const route = parseHash(hashAt < 0 ? '' : safe.slice(hashAt))
  if (route.type !== 'doc') return none
  return bootedPublic ? { kind: 'reload', url: safe } : { kind: 'hash', hash: safe.slice(hashAt), docId: route.docId }
}
