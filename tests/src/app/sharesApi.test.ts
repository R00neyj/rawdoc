import { describe, it, expect, beforeEach, vi } from 'vitest'
import { approveAccessRequest, listShares, rejectAccessRequest, SharesApiError } from '../../../src/app/sharesApi'

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

describe('F-2136 approveAccessRequest·rejectAccessRequest — U4', () => {
  it('200·204 는 ok, 404 는 gone, 그 밖·네트워크는 failed', async () => {
    for (const [fn, ok] of [[approveAccessRequest, 200], [rejectAccessRequest, 204]] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: ok, ok: true }))
      expect(await fn('r1')).toBe('ok')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
      expect(await fn('r1')).toBe('gone')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }))
      expect(await fn('r1')).toBe('failed')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 429, ok: false }))
      expect(await fn('r1')).toBe('failed')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
      expect(await fn('r1')).toBe('failed')
    }
  })

  it('POST 주소와 credentials same-origin', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await approveAccessRequest('r 1')
    await rejectAccessRequest('r2')
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/access-requests/r%201/approve', { credentials: 'same-origin', method: 'POST' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/access-requests/r2/reject', { credentials: 'same-origin', method: 'POST' })
  })
})
