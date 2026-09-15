import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getShareLink, createShareLink, revokeShareLink, LinkApiError } from './linkApi'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getShareLink', () => {
  it('200 이면 토큰', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({ token: 'tok1' }) }))
    expect(await getShareLink('d1')).toBe('tok1')
  })

  it('404 면 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
    expect(await getShareLink('d1')).toBeNull()
  })

  it('5xx 면 server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }))
    await expect(getShareLink('d1')).rejects.toMatchObject({ kind: 'server_error' })
  })

  it('네트워크 오류면 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    await expect(getShareLink('d1')).rejects.toBeInstanceOf(LinkApiError)
    await expect(getShareLink('d1')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('createShareLink', () => {
  it('200·201 모두 토큰', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 201, ok: true, json: async () => ({ token: 'tok2' }) }))
    expect(await createShareLink('d1')).toBe('tok2')
  })

  it('5xx 면 server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }))
    await expect(createShareLink('d1')).rejects.toMatchObject({ kind: 'server_error' })
  })
})

describe('revokeShareLink', () => {
  it('204 면 성공', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204, ok: true }))
    await expect(revokeShareLink('d1')).resolves.toBeUndefined()
  })

  it('5xx 면 server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }))
    await expect(revokeShareLink('d1')).rejects.toMatchObject({ kind: 'server_error' })
  })
})
