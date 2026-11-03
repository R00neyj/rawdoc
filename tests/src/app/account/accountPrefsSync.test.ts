// 계정 설정 동기화 — 받은 값과 이 기기 값 합치기·받기·보내기 엔진 (small 2026-11-04)
import { describe, expect, it } from 'vitest'
import { createAccountPrefsSync, mergePulled } from '../../../../src/app/account/accountPrefsSync'
import type { AccountPrefKey, AccountPrefs } from '../../../../src/lib/account/accountPrefsPolicy'

describe('mergePulled', () => {
  it('서버에 값이 있으면 서버 값을 적용한다', () => {
    expect(mergePulled({ lineBreaks: 'off' }, { lineBreaks: 'on' }, [])).toEqual({ apply: { lineBreaks: 'off' }, push: {} })
  })
  it('서버에 없고 이 기기에서 정한 값이 있으면 올린다', () => {
    expect(mergePulled({}, { lineBreaks: 'off' }, [])).toEqual({ apply: {}, push: { lineBreaks: 'off' } })
  })
  it('둘 다 없으면 아무것도 안 한다', () => {
    expect(mergePulled({}, {}, [])).toEqual({ apply: {}, push: {} })
  })
  it('아직 못 보낸 이 기기 변경은 서버 값보다 앞선다', () => {
    expect(mergePulled({ lineBreaks: 'on' }, { lineBreaks: 'off' }, ['lineBreaks'])).toEqual({ apply: {}, push: { lineBreaks: 'off' } })
  })
})

type Call = { method: string; body?: unknown }

function world(server: AccountPrefs, local: AccountPrefs = {}) {
  const calls: Call[] = []
  let failing = false
  const state = { server: { ...server }, local: { ...local }, dirty: [] as AccountPrefKey[] }
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, body })
    if (failing) throw new TypeError('offline')
    if (method === 'PUT') state.server = { ...state.server, ...body.prefs }
    return new Response(JSON.stringify({ prefs: state.server }), { status: 200 })
  }) as unknown as typeof fetch
  const sync = createAccountPrefsSync({
    fetch: fetchImpl,
    now: () => 0,
    readLocal: () => state.local,
    applyRemote: (p) => {
      state.local = { ...state.local, ...p }
    },
    readDirty: () => state.dirty,
    writeDirty: (keys) => {
      state.dirty = keys
    },
  })
  return { sync, calls, state, setFailing: (v: boolean) => (failing = v) }
}

describe('createAccountPrefsSync', () => {
  it('시작하면 받아서 이 기기에 적용한다', async () => {
    const w = world({ lineBreaks: 'off' })
    await w.sync.start('u1')
    expect(w.state.local).toEqual({ lineBreaks: 'off' })
    expect(w.calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('계정에 값이 없으면 이 기기 값을 올린다', async () => {
    const w = world({}, { lineBreaks: 'off' })
    await w.sync.start('u1')
    expect(w.state.server).toEqual({ lineBreaks: 'off' })
  })

  it('바꾸면 올리고, 실패하면 남겨 두었다가 연결되면 다시 보낸다', async () => {
    const w = world({ lineBreaks: 'on' }, { lineBreaks: 'on' })
    await w.sync.start('u1')
    w.setFailing(true)
    w.state.local = { lineBreaks: 'off' }
    await w.sync.onLocalChange('lineBreaks')
    expect(w.state.dirty).toEqual(['lineBreaks'])
    w.setFailing(false)
    await w.sync.onOnline()
    expect(w.state.server).toEqual({ lineBreaks: 'off' })
    expect(w.state.dirty).toEqual([])
  })

  it('로그인 전에는 서버에 보내지 않고 남기지도 않는다', async () => {
    const w = world({})
    await w.sync.start(null)
    await w.sync.onLocalChange('lineBreaks')
    expect(w.calls).toEqual([])
    expect(w.state.dirty).toEqual([])
  })
})
