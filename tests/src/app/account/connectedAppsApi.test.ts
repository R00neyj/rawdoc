import { afterEach, describe, expect, it, vi } from 'vitest'
import { disconnectConnectedApp, listConnectedApps } from '../../../../src/app/account/connectedAppsApi'

const APP = { id: 'a', name: 'n', host: 'h', createdAt: 1, lastUsedAt: null }

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('F-2148 U4 listConnectedApps', () => {
  it('200 이고 목록 모양이면 배열', async () => {
    const fn = stubFetch(async () => new Response(JSON.stringify([APP]), { status: 200 }))
    await expect(listConnectedApps()).resolves.toEqual([APP])
    expect(fn.mock.calls[0][0]).toBe('/api/connected-apps')
    expect(fn.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' })
  })
  it('401·500·네트워크·HTML 200 은 throw', async () => {
    stubFetch(async () => new Response('{}', { status: 401 }))
    await expect(listConnectedApps()).rejects.toThrow()
    stubFetch(async () => new Response('{}', { status: 500 }))
    await expect(listConnectedApps()).rejects.toThrow()
    stubFetch(async () => {
      throw new TypeError('failed')
    })
    await expect(listConnectedApps()).rejects.toThrow()
    stubFetch(async () => new Response('<html></html>', { status: 200 }))
    await expect(listConnectedApps()).rejects.toThrow()
  })
})

describe('F-2148 U4 disconnectConnectedApp', () => {
  it('204 ok, 404 gone', async () => {
    stubFetch(async () => new Response(null, { status: 204 }))
    await expect(disconnectConnectedApp('a')).resolves.toBe('ok')
    stubFetch(async () => new Response('{"error":"not_found"}', { status: 404 }))
    await expect(disconnectConnectedApp('a')).resolves.toBe('gone')
  })
  it('401·500·네트워크는 failed', async () => {
    stubFetch(async () => new Response('{}', { status: 401 }))
    await expect(disconnectConnectedApp('a')).resolves.toBe('failed')
    stubFetch(async () => new Response('{}', { status: 500 }))
    await expect(disconnectConnectedApp('a')).resolves.toBe('failed')
    stubFetch(async () => {
      throw new TypeError('failed')
    })
    await expect(disconnectConnectedApp('a')).resolves.toBe('failed')
  })
  it('주소에 id 를 인코딩하고 DELETE', async () => {
    const fn = stubFetch(async () => new Response(null, { status: 204 }))
    await disconnectConnectedApp('a/b c')
    expect(fn.mock.calls[0][0]).toBe('/api/connected-apps/a%2Fb%20c')
    expect(fn.mock.calls[0][1]).toMatchObject({ method: 'DELETE', credentials: 'same-origin' })
  })
})
