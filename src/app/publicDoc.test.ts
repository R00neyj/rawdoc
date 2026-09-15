import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPublicDoc, PublicDocError } from './publicDoc'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchPublicDoc', () => {
  it('200 이면 문서를 돌려준다', async () => {
    const body = { title: '제목', content: '# 본문', lineEnding: 'lf', updatedAt: 123 }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }),
    )
    await expect(fetchPublicDoc('tok')).resolves.toEqual(body)
  })

  it('404 면 not_found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, json: async () => ({}) }))
    await expect(fetchPublicDoc('tok')).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('네트워크 오류면 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchPublicDoc('tok')).rejects.toBeInstanceOf(PublicDocError)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchPublicDoc('tok')).rejects.toMatchObject({ kind: 'network' })
  })

  it('그 외 오류는 other', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => ({}) }))
    await expect(fetchPublicDoc('tok')).rejects.toMatchObject({ kind: 'other' })
  })

  it('토큰을 URL 인코딩해 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await fetchPublicDoc('a b')
    expect(fetchMock).toHaveBeenCalledWith('/pub/docs/a%20b', { cache: 'no-store' })
  })
})
