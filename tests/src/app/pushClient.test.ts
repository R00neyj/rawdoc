// F-2110 9.1 U1~U9 — 푸시 화면 상태·흐름·판정 (순수, 가짜 PushDeps)
import { describe, it, expect, vi } from 'vitest'
import {
  PUSH_SYNC_INTERVAL_MS,
  decidePushSync,
  fetchPushKey,
  isIosLike,
  isPublicBoot,
  pushOpenTarget,
  pushSettingsView,
  sameServerKey,
  sendTestPush,
  syncPushOnBoot,
  turnOffPush,
  turnOnPush,
  type PushDeps,
  type PushKeyState,
  type PushPermission,
  type PushSettingsInput,
  type PushSubscriptionLike,
} from '../../../src/app/pushClient'

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const KEY_BYTES = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : i))
const KEY_B64 = b64url(KEY_BYTES)
const NOW = 1_800_000_000_000

function jsonRes(status: number, body: unknown = {}) {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response
}

function fakeSub(keyBytes: Uint8Array | null = KEY_BYTES, endpoint = 'https://push.example/1') {
  return {
    endpoint,
    options: { applicationServerKey: keyBytes ? (keyBytes.slice().buffer as ArrayBuffer) : null },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'P', auth: 'A' } }),
    unsubscribe: vi.fn(async () => true),
  } satisfies PushSubscriptionLike
}

type Setup = {
  permission?: PushPermission
  requestResult?: PushPermission
  existing?: ReturnType<typeof fakeSub> | null
  managerNull?: boolean
  supported?: boolean
  prefs?: Record<string, string>
  routes?: Partial<Record<string, (init?: RequestInit) => Response | Promise<Response>>>
}
function setup(s: Setup = {}) {
  const calls: string[] = []
  const prefs: Record<string, string> = { 'md.push': '', 'md.pushSyncedAt': '', ...s.prefs }
  let existing = s.existing ?? null
  const created = fakeSub()
  const manager = {
    getSubscription: vi.fn(async () => existing),
    subscribe: vi.fn(async (...args: [{ userVisibleOnly: true; applicationServerKey: Uint8Array }]) => {
      void args
      calls.push('subscribe')
      existing = created
      return created
    }),
  }
  const requestPermission = vi.fn(async () => {
    calls.push('requestPermission')
    return s.requestResult ?? 'granted'
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input)
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)
    const handler = s.routes?.[`${method} ${path}`]
    if (handler) return handler(init)
    if (method === 'GET' && path === '/api/push/key') return jsonRes(200, { publicKey: KEY_B64 })
    return jsonRes(204)
  })
  const deps: PushDeps = {
    platform: {
      supported: () => s.supported ?? true,
      permission: () => s.permission ?? 'granted',
      requestPermission,
      pushManager: async () => (s.managerNull ? null : manager),
    },
    fetch: fetchMock as unknown as typeof fetch,
    now: () => NOW,
    getPref: (k) => prefs[k] ?? '',
    setPref: (k, v) => {
      prefs[k] = v
    },
  }
  return { deps, calls, prefs, manager, requestPermission, fetchMock, created }
}
type Harness = ReturnType<typeof setup>
function bodiesOf(fetchMock: Harness['fetchMock'], method: string, path: string) {
  return fetchMock.mock.calls
    .filter(([p, i]) => String(p) === path && ((i as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([, i]) => JSON.parse(String((i as RequestInit).body)))
}
function count(fetchMock: Harness['fetchMock'], method: string, path: string) {
  return fetchMock.mock.calls.filter(([p, i]) => String(p) === path && ((i as RequestInit | undefined)?.method ?? 'GET') === method).length
}

const BASE: PushSettingsInput = {
  supported: true, ios: false, standalone: false, permission: 'default', online: true, enabled: false, key: 'unknown', busy: null,
}

describe('U1 pushSettingsView', () => {
  it('아홉 행', () => {
    expect(pushSettingsView({ ...BASE, busy: 'on' })).toMatchObject({
      kind: 'turning-on', checked: false, locked: true, disabled: false, note: '켜는 중…', showTest: false,
    })
    expect(pushSettingsView({ ...BASE, busy: 'off', enabled: true })).toMatchObject({
      kind: 'turning-off', checked: true, locked: true, note: '끄는 중…', showTest: true, testLocked: true,
    })
    expect(pushSettingsView({ ...BASE, ios: true })).toMatchObject({
      kind: 'ios-browser', checked: false, disabled: true, note: 'iPhone·iPad에서는 홈 화면에 추가한 앱에서만 푸시를 받을 수 있습니다.', showTest: false,
    })
    expect(pushSettingsView({ ...BASE, supported: false })).toMatchObject({
      kind: 'unsupported', disabled: true, note: '이 브라우저는 푸시 알림을 지원하지 않습니다.',
    })
    expect(pushSettingsView({ ...BASE, permission: 'denied' })).toMatchObject({
      kind: 'denied', checked: false, disabled: true,
      note: '이 사이트의 알림이 브라우저에서 차단되어 있습니다. 브라우저 설정에서 허용한 뒤 다시 켜 주세요.',
    })
    expect(pushSettingsView({ ...BASE, online: false })).toMatchObject({
      kind: 'offline', checked: false, disabled: true, note: '온라인일 때 바꿀 수 있습니다.', showTest: false,
    })
    const onOn = pushSettingsView({ ...BASE, enabled: true, permission: 'granted' })
    expect(onOn).toMatchObject({ kind: 'on', checked: true, disabled: false, locked: false, showTest: true, testLocked: false })
    expect(onOn.note).toContain('이 기기로 보냅니다')
    expect(pushSettingsView({ ...BASE, key: 'unavailable' })).toMatchObject({
      kind: 'unavailable', checked: false, disabled: true, note: '지금은 푸시 알림을 켤 수 없습니다.', showTest: false,
    })
    expect(pushSettingsView({ ...BASE, key: 'error' })).toMatchObject({ kind: 'off', checked: false, disabled: false, locked: false, showTest: false })
  })

  it('순서 판정', () => {
    expect(pushSettingsView({ ...BASE, busy: 'on', permission: 'denied' }).kind).toBe('turning-on')
    expect(pushSettingsView({ ...BASE, ios: true, standalone: false, supported: false }).kind).toBe('ios-browser')
    expect(pushSettingsView({ ...BASE, permission: 'denied', enabled: true })).toMatchObject({ kind: 'denied', checked: false })
    expect(pushSettingsView({ ...BASE, enabled: true, key: 'unavailable' }).kind).toBe('on')
    expect(pushSettingsView({ ...BASE, ios: true, standalone: true }).kind).toBe('off')
  })

  it('offline + enabled, on + busy test', () => {
    expect(pushSettingsView({ ...BASE, online: false, enabled: true })).toMatchObject({
      kind: 'offline', checked: true, disabled: true, showTest: true, testDisabled: true,
    })
    expect(pushSettingsView({ ...BASE, enabled: true, busy: 'test' })).toMatchObject({ kind: 'on', locked: true, testLocked: true })
  })
})

describe('U2 isIosLike', () => {
  it('판정', () => {
    expect(isIosLike('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isIosLike('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5)).toBe(true)
    expect(isIosLike('Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0)', 5)).toBe(true)
    expect(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(isIosLike('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
    expect(isIosLike('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36', 5)).toBe(false)
    expect(isIosLike('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36', 0)).toBe(false)
  })
})

describe('U3 decidePushSync', () => {
  const base = { userId: 'u1', push: 'u1', syncedAt: String(NOW - 86_400_000), now: NOW, supported: true, permission: 'granted' as const, hasSubscription: true }
  it('여섯 판정', () => {
    expect(decidePushSync({ ...base, push: 'u2' })).toBe('skip')
    expect(decidePushSync({ ...base, push: '' })).toBe('skip')
    expect(decidePushSync({ ...base, supported: false })).toBe('skip')
    expect(decidePushSync({ ...base, permission: 'denied' })).toBe('revoke')
    expect(decidePushSync({ ...base, permission: 'default' })).toBe('revoke')
    expect(decidePushSync({ ...base, hasSubscription: false })).toBe('subscribe')
    expect(decidePushSync(base)).toBe('fresh')
    for (const syncedAt of [String(NOW - 8 * 86_400_000), '', 'abc', String(NOW + 86_400_000)]) {
      expect(decidePushSync({ ...base, syncedAt })).toBe('refresh')
    }
  })
  it('경계', () => {
    expect(decidePushSync({ ...base, syncedAt: String(NOW - PUSH_SYNC_INTERVAL_MS) })).toBe('refresh')
    expect(decidePushSync({ ...base, syncedAt: String(NOW - PUSH_SYNC_INTERVAL_MS + 1) })).toBe('fresh')
  })
})

describe('U4 fetchPushKey·sameServerKey', () => {
  const fx = (res: () => Response | Promise<Response>) => vi.fn(async () => res()) as unknown as typeof fetch
  it('키 판정', async () => {
    expect(await fetchPushKey(fx(() => jsonRes(200, { publicKey: KEY_B64 })))).toEqual({ kind: 'ok', publicKey: KEY_B64 })
    const short = b64url(new Uint8Array(64).fill(4))
    const wrongFirst = b64url(new Uint8Array(65).fill(3))
    expect((await fetchPushKey(fx(() => jsonRes(200, { publicKey: short })))).kind).toBe('error')
    expect((await fetchPushKey(fx(() => jsonRes(200, { publicKey: wrongFirst })))).kind).toBe('error')
    expect((await fetchPushKey(fx(() => jsonRes(200, { publicKey: '!!!' })))).kind).toBe('error')
    const badJson = { status: 200, ok: true, json: async () => { throw new Error('x') } } as unknown as Response
    expect((await fetchPushKey(fx(() => badJson))).kind).toBe('error')
    expect((await fetchPushKey(fx(() => jsonRes(503)))).kind).toBe('unavailable')
    expect((await fetchPushKey(fx(() => jsonRes(401)))).kind).toBe('error')
    expect((await fetchPushKey(fx(() => jsonRes(500)))).kind).toBe('error')
    expect((await fetchPushKey(fx(() => { throw new TypeError('net') }))).kind).toBe('error')
  })
  it('sameServerKey', () => {
    expect(sameServerKey(KEY_BYTES.slice().buffer as ArrayBuffer, KEY_BYTES)).toBe(true)
    const b = KEY_BYTES.slice()
    b[10] ^= 1
    expect(sameServerKey(b.buffer as ArrayBuffer, KEY_BYTES)).toBe(false)
    expect(sameServerKey(null, KEY_BYTES)).toBe(false)
    expect(sameServerKey(KEY_BYTES.slice(0, 64).buffer as ArrayBuffer, KEY_BYTES)).toBe(false)
  })
})

describe('U5 turnOnPush', () => {
  const unknown: PushKeyState = { kind: 'unknown' }
  it('정상 순서와 몸통', async () => {
    const s = setup({ permission: 'default' })
    const r = await turnOnPush(s.deps, 'u1', unknown)
    expect(r.result).toBe('on')
    expect(s.calls[0]).toBe('requestPermission')
    expect(s.calls.indexOf('requestPermission')).toBeLessThan(s.calls.indexOf('GET /api/push/key'))
    const arg = s.manager.subscribe.mock.calls[0][0]
    expect(arg.userVisibleOnly).toBe(true)
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect(arg.applicationServerKey.length).toBe(65)
    expect(bodiesOf(s.fetchMock, 'PUT', '/api/push/subscription')).toEqual([{ endpoint: 'https://push.example/1', keys: { p256dh: 'P', auth: 'A' } }])
    expect(s.prefs['md.push']).toBe('u1')
    expect(s.prefs['md.pushSyncedAt']).toBe(String(NOW))
    expect(r.key.kind).toBe('ok')
  })
  it('권한 거절', async () => {
    for (const requestResult of ['denied', 'default'] as const) {
      const s = setup({ permission: 'default', requestResult })
      expect((await turnOnPush(s.deps, 'u1', unknown)).result).toBe('permission-refused')
      expect(s.fetchMock).not.toHaveBeenCalled()
      expect(s.prefs['md.push']).toBe('')
    }
    const d = setup({ permission: 'denied' })
    expect((await turnOnPush(d.deps, 'u1', unknown)).result).toBe('permission-refused')
  })
  it('실패 갈래는 설정 그대로', async () => {
    const k503 = setup({ routes: { 'GET /api/push/key': () => jsonRes(503) } })
    const r3 = await turnOnPush(k503.deps, 'u1', unknown)
    expect(r3.result).toBe('unavailable')
    expect(r3.key.kind).toBe('unavailable')
    const nul = setup({ managerNull: true })
    expect((await turnOnPush(nul.deps, 'u1', unknown)).result).toBe('failed')
    const unsup = setup({ routes: { 'PUT /api/push/subscription': () => jsonRes(400, { error: 'unsupported_push_service' }) } })
    expect((await turnOnPush(unsup.deps, 'u1', unknown)).result).toBe('unsupported-service')
    const p500 = setup({ routes: { 'PUT /api/push/subscription': () => jsonRes(500) } })
    expect((await turnOnPush(p500.deps, 'u1', unknown)).result).toBe('failed')
    const thrown = setup({ routes: { 'PUT /api/push/subscription': () => { throw new TypeError('net') } } })
    expect((await turnOnPush(thrown.deps, 'u1', unknown)).result).toBe('failed')
    for (const s of [k503, nul, unsup, p500, thrown]) {
      expect(s.prefs['md.push']).toBe('')
      expect(s.prefs['md.pushSyncedAt']).toBe('')
    }
  })
  it('기존 구독 키 비교', async () => {
    const same = setup({ existing: fakeSub() })
    await turnOnPush(same.deps, 'u1', unknown)
    expect(same.manager.subscribe).not.toHaveBeenCalled()
    const other = fakeSub(new Uint8Array(65).fill(4))
    const diff = setup({ existing: other })
    await turnOnPush(diff.deps, 'u1', unknown)
    expect(other.unsubscribe).toHaveBeenCalledTimes(1)
    expect(diff.manager.subscribe).toHaveBeenCalledTimes(1)
  })
  it('키가 ok 면 GET 안 함', async () => {
    const s = setup()
    await turnOnPush(s.deps, 'u1', { kind: 'ok', publicKey: KEY_B64 })
    expect(count(s.fetchMock, 'GET', '/api/push/key')).toBe(0)
  })
})

describe('U6 turnOffPush', () => {
  it('성공', async () => {
    const sub = fakeSub()
    const s = setup({ existing: sub, prefs: { 'md.push': 'u1', 'md.pushSyncedAt': '5' } })
    expect(await turnOffPush(s.deps)).toBe('off')
    expect(bodiesOf(s.fetchMock, 'DELETE', '/api/push/subscription')).toEqual([{ endpoint: sub.endpoint }])
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1)
    expect(s.prefs).toMatchObject({ 'md.push': '', 'md.pushSyncedAt': '' })
  })
  it('DELETE 실패는 켜진 채', async () => {
    for (const route of [() => jsonRes(500), () => { throw new TypeError('net') }]) {
      const sub = fakeSub()
      const s = setup({ existing: sub, prefs: { 'md.push': 'u1', 'md.pushSyncedAt': '5' }, routes: { 'DELETE /api/push/subscription': route } })
      expect(await turnOffPush(s.deps)).toBe('failed')
      expect(sub.unsubscribe).not.toHaveBeenCalled()
      expect(s.prefs['md.push']).toBe('u1')
    }
  })
  it('구독 없음·unsubscribe 던짐', async () => {
    const s = setup({ prefs: { 'md.push': 'u1', 'md.pushSyncedAt': '5' } })
    expect(await turnOffPush(s.deps)).toBe('off')
    expect(s.fetchMock).not.toHaveBeenCalled()
    expect(s.prefs['md.push']).toBe('')
    const sub = fakeSub()
    sub.unsubscribe.mockRejectedValue(new Error('x'))
    const t = setup({ existing: sub, prefs: { 'md.push': 'u1' } })
    expect(await turnOffPush(t.deps)).toBe('off')
  })
})

describe('U7 sendTestPush', () => {
  it('204', async () => {
    const sub = fakeSub()
    const s = setup({ existing: sub })
    expect(await sendTestPush(s.deps)).toBe('sent')
    expect(bodiesOf(s.fetchMock, 'POST', '/api/push/test')).toEqual([{ endpoint: sub.endpoint }])
  })
  it('404 되살리기', async () => {
    let n = 0
    const s = setup({ existing: fakeSub(), routes: { 'POST /api/push/test': () => (n++ === 0 ? jsonRes(404) : jsonRes(204)) } })
    expect(await sendTestPush(s.deps)).toBe('sent')
    expect(count(s.fetchMock, 'PUT', '/api/push/subscription')).toBe(1)
    expect(count(s.fetchMock, 'POST', '/api/push/test')).toBe(2)
    expect(s.prefs['md.pushSyncedAt']).toBe(String(NOW))
    const t = setup({ existing: fakeSub(), routes: { 'POST /api/push/test': () => jsonRes(404) } })
    expect(await sendTestPush(t.deps)).toBe('failed')
    expect(count(t.fetchMock, 'POST', '/api/push/test')).toBe(2)
  })
  it('그 밖은 failed', async () => {
    for (const route of [() => jsonRes(502), () => jsonRes(503), () => { throw new TypeError('net') }]) {
      const s = setup({ existing: fakeSub(), routes: { 'POST /api/push/test': route } })
      expect(await sendTestPush(s.deps)).toBe('failed')
      expect(count(s.fetchMock, 'PUT', '/api/push/subscription')).toBe(0)
    }
  })
  it('구독 없음', async () => {
    const s = setup()
    expect(await sendTestPush(s.deps)).toBe('sent')
    const order = s.calls.filter((c) => c.startsWith('GET') || c === 'subscribe' || c.startsWith('PUT') || c.startsWith('POST'))
    expect(order).toEqual(['GET /api/push/key', 'subscribe', 'PUT /api/push/subscription', 'POST /api/push/test'])
  })
})

describe('U8 syncPushOnBoot', () => {
  const on = { 'md.push': 'u1' }
  it('skip·fresh 는 요청 0', async () => {
    const a = setup({ prefs: { 'md.push': 'u2' } })
    expect(await syncPushOnBoot(a.deps, 'u1')).toBe('skip')
    const b = setup({ existing: fakeSub(), prefs: { ...on, 'md.pushSyncedAt': String(NOW - 1000) } })
    expect(await syncPushOnBoot(b.deps, 'u1')).toBe('fresh')
    expect(a.fetchMock).not.toHaveBeenCalled()
    expect(b.fetchMock).not.toHaveBeenCalled()
  })
  it('revoke', async () => {
    for (const del of [() => jsonRes(204), () => jsonRes(500)]) {
      const sub = fakeSub()
      const s = setup({ existing: sub, permission: 'denied', prefs: { ...on, 'md.pushSyncedAt': '5' }, routes: { 'DELETE /api/push/subscription': del } })
      expect(await syncPushOnBoot(s.deps, 'u1')).toBe('revoked')
      expect(count(s.fetchMock, 'DELETE', '/api/push/subscription')).toBe(1)
      expect(sub.unsubscribe).toHaveBeenCalledTimes(1)
      expect(s.prefs).toMatchObject({ 'md.push': '', 'md.pushSyncedAt': '' })
    }
  })
  it('refresh 키 같음·다름', async () => {
    const same = setup({ existing: fakeSub(), prefs: on })
    expect(await syncPushOnBoot(same.deps, 'u1')).toBe('synced')
    expect(same.manager.subscribe).not.toHaveBeenCalled()
    expect(count(same.fetchMock, 'PUT', '/api/push/subscription')).toBe(1)
    expect(same.prefs['md.pushSyncedAt']).toBe(String(NOW))
    const old = fakeSub(new Uint8Array(65).fill(4))
    const diff = setup({ existing: old, prefs: on })
    expect(await syncPushOnBoot(diff.deps, 'u1')).toBe('synced')
    expect(old.unsubscribe).toHaveBeenCalledTimes(1)
    expect(diff.manager.subscribe).toHaveBeenCalledTimes(1)
  })
  it('실패 갈래', async () => {
    const k = setup({ existing: fakeSub(), prefs: { ...on, 'md.pushSyncedAt': '5' }, routes: { 'GET /api/push/key': () => jsonRes(503) } })
    expect(await syncPushOnBoot(k.deps, 'u1')).toBe('unavailable')
    expect(k.prefs['md.push']).toBe('u1')
    const u = setup({ existing: fakeSub(), prefs: { ...on, 'md.pushSyncedAt': '5' }, routes: { 'PUT /api/push/subscription': () => jsonRes(400, { error: 'unsupported_push_service' }) } })
    expect(await syncPushOnBoot(u.deps, 'u1')).toBe('failed')
    expect(u.prefs).toMatchObject({ 'md.push': '', 'md.pushSyncedAt': '' })
    const f = setup({ existing: fakeSub(), prefs: { ...on, 'md.pushSyncedAt': '5' }, routes: { 'PUT /api/push/subscription': () => jsonRes(500) } })
    expect(await syncPushOnBoot(f.deps, 'u1')).toBe('failed')
    expect(f.prefs).toMatchObject({ 'md.push': 'u1', 'md.pushSyncedAt': '5' })
    for (const s of [k, u, f]) expect(s.requestPermission).not.toHaveBeenCalled()
  })
  it('subscribe 판정(구독 없음)', async () => {
    const s = setup({ prefs: on })
    expect(await syncPushOnBoot(s.deps, 'u1')).toBe('synced')
    expect(s.manager.subscribe).toHaveBeenCalledTimes(1)
  })
})

describe('U9 pushOpenTarget·isPublicBoot', () => {
  const msg = (url: unknown, type: unknown = 'push-open') => ({ type, url })
  it('doc 만 옮긴다', () => {
    expect(pushOpenTarget(msg('/#/d/a/c/t'), false)).toEqual({ kind: 'hash', hash: '#/d/a/c/t', docId: 'a' })
    expect(pushOpenTarget(msg('/#/d/a'), false)).toEqual({ kind: 'hash', hash: '#/d/a', docId: 'a' })
    for (const u of ['/', '/#/', '/#', '/#/shares', '/#/map', '//evil.com/#/d/a', 'https://evil.com/#/d/a', '/guides/x#/d/a']) {
      expect(pushOpenTarget(msg(u), false).kind, u).toBe('none')
    }
  })
  it('모양 틀림', () => {
    expect(pushOpenTarget(msg('/#/d/a', 'other'), false).kind).toBe('none')
    expect(pushOpenTarget(msg(5), false).kind).toBe('none')
    expect(pushOpenTarget(null, false).kind).toBe('none')
    expect(pushOpenTarget('push-open', false).kind).toBe('none')
  })
  it('공개 보기로 부팅', () => {
    expect(pushOpenTarget(msg('/#/d/a'), true)).toEqual({ kind: 'reload', url: '/#/d/a' })
    expect(isPublicBoot('#/p/tok')).toBe(true)
    expect(isPublicBoot('#/p/f/tok')).toBe(true)
    expect(isPublicBoot('#/d/a')).toBe(false)
    expect(isPublicBoot('')).toBe(false)
  })
})
