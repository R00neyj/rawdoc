import { describe, it, expect, beforeEach, vi } from 'vitest'
import { cancelAccessRequest, fetchAccessStatus, sendAccessRequest } from '../../../src/app/accessRequestApi'

const STATUS = { target: 'doc', owner: false, memberRole: null, targetId: null, request: null }

function reply(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchAccessStatus', () => {
  it('200 정상이면 값, URL 은 토큰·docId', async () => {
    const f = reply(200, STATUS)
    vi.stubGlobal('fetch', f)
    expect(await fetchAccessStatus('tok', null)).toEqual(STATUS)
    expect(f.mock.calls[0][0]).toBe('/api/access-requests/link/tok')
    await fetchAccessStatus('tok', 'd 2')
    expect(f.mock.calls[1][0]).toBe('/api/access-requests/link/tok?docId=d%202')
  })

  it('대기·거절 요청 모양도 받는다', async () => {
    const body = { ...STATUS, request: { state: 'rejected', role: 'edit', retryAt: 5 } }
    vi.stubGlobal('fetch', reply(200, body))
    expect(await fetchAccessStatus('tok', null)).toEqual(body)
  })

  it('401·404·500 은 null', async () => {
    for (const s of [401, 404, 500]) {
      vi.stubGlobal('fetch', reply(s, STATUS))
      expect(await fetchAccessStatus('tok', null)).toBeNull()
    }
  })

  it('네트워크 오류·모양 틀림·키 하나 더·owner 권한은 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await fetchAccessStatus('tok', null)).toBeNull()
    for (const body of [{ ...STATUS, extra: 1 }, { ...STATUS, memberRole: 'owner' }, { target: 'doc' }, null, { ...STATUS, request: { state: 'rejected', role: 'view', retryAt: null } }]) {
      vi.stubGlobal('fetch', reply(200, body))
      expect(await fetchAccessStatus('tok', null)).toBeNull()
    }
  })
})

describe('sendAccessRequest', () => {
  it('201·200 은 상태, 몸통은 role(+docId)', async () => {
    const f = reply(201, { ...STATUS, request: { state: 'pending', role: 'edit', retryAt: null } })
    vi.stubGlobal('fetch', f)
    const r = await sendAccessRequest('tok', null, 'edit')
    expect(r).toEqual({ ok: true, status: { ...STATUS, request: { state: 'pending', role: 'edit', retryAt: null } } })
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect(f.mock.calls[0][1].body).toBe('{"role":"edit"}')
    await sendAccessRequest('tok', 'd2', 'view')
    expect(f.mock.calls[1][1].body).toBe('{"role":"view","docId":"d2"}')
  })

  it('상태 코드를 오류로 바꾼다', async () => {
    const cases: [number, unknown, string, number | null][] = [
      [404, {}, 'gone', null],
      [403, { error: 'account_blocked' }, 'blocked', null],
      [429, {}, 'rate_limited', null],
      [409, { error: 'already_member' }, 'already_member', null],
      [409, { error: 'cooldown', retryAt: 77 }, 'cooldown', 77],
      [409, { error: 'too_many_pending' }, 'too_many_pending', null],
      [409, { error: 'owner_full' }, 'owner_full', null],
      [409, { error: 'owner' }, 'failed', null],
      [400, { error: 'invalid' }, 'failed', null],
      [500, {}, 'failed', null],
    ]
    for (const [status, body, error, retryAt] of cases) {
      vi.stubGlobal('fetch', reply(status, body))
      expect(await sendAccessRequest('tok', null, 'view')).toEqual({ ok: false, error, retryAt })
    }
  })

  it('네트워크 오류·성공인데 모양 틀림은 failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await sendAccessRequest('tok', null, 'view')).toEqual({ ok: false, error: 'failed', retryAt: null })
    vi.stubGlobal('fetch', reply(201, { nope: 1 }))
    expect(await sendAccessRequest('tok', null, 'view')).toEqual({ ok: false, error: 'failed', retryAt: null })
  })
})

describe('cancelAccessRequest', () => {
  it('204 면 true, 그 밖·네트워크 오류면 false. DELETE URL', async () => {
    const f = reply(204)
    vi.stubGlobal('fetch', f)
    expect(await cancelAccessRequest('tok', 'd2')).toBe(true)
    expect(f.mock.calls[0][0]).toBe('/api/access-requests/link/tok?docId=d2')
    expect(f.mock.calls[0][1].method).toBe('DELETE')
    vi.stubGlobal('fetch', reply(404))
    expect(await cancelAccessRequest('tok', null)).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await cancelAccessRequest('tok', null)).toBe(false)
  })
})
