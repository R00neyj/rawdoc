import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchShareSet, ShareSetApiError } from './shareSetApi'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchShareSet', () => {
  it('200 이면 nodes·truncated 를 그대로 돌려준다', async () => {
    const body = { nodes: [{ id: 'b', title: 'B', depth: 1, parentId: null }], truncated: false }
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchShareSet('d1')).toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/api/docs/d1/share-set', { credentials: 'same-origin' })
  })

  it('404(소유 아님) 면 other', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false }))
    await expect(fetchShareSet('d1')).rejects.toMatchObject({ kind: 'other' })
  })

  it('5xx 면 server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false }))
    await expect(fetchShareSet('d1')).rejects.toBeInstanceOf(ShareSetApiError)
    await expect(fetchShareSet('d1')).rejects.toMatchObject({ kind: 'server_error' })
  })

  it('네트워크 오류면 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')))
    await expect(fetchShareSet('d1')).rejects.toMatchObject({ kind: 'network' })
  })
})
