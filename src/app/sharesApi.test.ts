import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listShares, SharesApiError } from './sharesApi'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('listShares', () => {
  it('200 이면 links·grants 를 그대로 돌려준다', async () => {
    const body = { links: [{ token: 't1' }], grants: [{ email: 'a@b.com' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }))
    expect(await listShares()).toEqual(body)
  })

  it('401 이면 unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 401, ok: false }))
    await expect(listShares()).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('5xx 면 server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }))
    await expect(listShares()).rejects.toMatchObject({ kind: 'server_error' })
  })

  it('네트워크 오류면 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    await expect(listShares()).rejects.toBeInstanceOf(SharesApiError)
    await expect(listShares()).rejects.toMatchObject({ kind: 'network' })
  })

  it('credentials same-origin 으로 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ links: [], grants: [] }) })
    vi.stubGlobal('fetch', fetchMock)
    await listShares()
    expect(fetchMock).toHaveBeenCalledWith('/api/shares', { credentials: 'same-origin' })
  })
})
