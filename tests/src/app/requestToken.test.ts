import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchRequestToken, requestTokenDocId, resetRequestTokenCache } from '../../../src/app/requestToken'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'

function reply(status: number, body: unknown = { token: TOKEN }) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('requestTokenDocId — U2 (F-2137 2장)', () => {
  it('서버 저장소의 내 문서만 id, 나머지는 null', () => {
    expect(requestTokenDocId({ serverStore: true, doc: { id: 'd1' } })).toBe('d1')
    expect(requestTokenDocId({ serverStore: true, doc: { id: 'd1', role: 'owner' } })).toBe('d1')
    expect(requestTokenDocId({ serverStore: false, doc: { id: 'd1' } })).toBeNull()
    expect(requestTokenDocId({ serverStore: true, doc: { id: 'd1', role: 'view' } })).toBeNull()
    expect(requestTokenDocId({ serverStore: true, doc: { id: 'd1', role: 'edit' } })).toBeNull()
    expect(requestTokenDocId({ serverStore: true, doc: { id: 'd1', e2ee: 'open' } })).toBeNull()
    expect(requestTokenDocId({ serverStore: true, doc: { id: 'd1', e2ee: 'locked' } })).toBeNull()
    expect(requestTokenDocId({ serverStore: true, doc: null })).toBeNull()
  })
})

describe('fetchRequestToken — U3 (F-2137 2장)', () => {
  beforeEach(() => resetRequestTokenCache())
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('201·200 은 토큰, POST /api/docs/{id}/request-token 으로 부른다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(201)).mockResolvedValueOnce(reply(200))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRequestToken('d1')).resolves.toBe(TOKEN)
    await expect(fetchRequestToken('d2')).resolves.toBe(TOKEN)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/docs/d1/request-token')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
  })

  it('409·500·네트워크 오류는 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(409, { error: 'e2ee_doc' })))
    await expect(fetchRequestToken('d1')).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(reply(500, {})))
    await expect(fetchRequestToken('d1')).resolves.toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))
    await expect(fetchRequestToken('d1')).resolves.toBeNull()
  })

  it('3초 넘으면 null', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>()
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      return promise
    }))
    const pending = fetchRequestToken('d1')
    await vi.advanceTimersByTimeAsync(3001)
    await expect(pending).resolves.toBeNull()
  })

  it('같은 id 두 번은 fetch 한 번, null 뒤에는 다시 부른다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(500, {})).mockResolvedValue(reply(201))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRequestToken('d1')).resolves.toBeNull()
    await expect(fetchRequestToken('d1')).resolves.toBe(TOKEN)
    await expect(fetchRequestToken('d1')).resolves.toBe(TOKEN)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
