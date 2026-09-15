import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchPublicDoc, fetchPublicFolder, fetchPublicFolderDoc, firstFolderDocId, PublicDocError, type PublicFolder } from './publicDoc'

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

describe('fetchPublicFolder', () => {
  it('200 이면 폴더 목록을 돌려준다', async () => {
    const body = { name: '폴더', folders: [], docs: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body }))
    await expect(fetchPublicFolder('tok')).resolves.toEqual(body)
  })

  it('404 면 not_found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, json: async () => ({}) }))
    await expect(fetchPublicFolder('tok')).rejects.toMatchObject({ kind: 'not_found' })
  })

  it('네트워크 오류면 network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchPublicFolder('tok')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('fetchPublicFolderDoc', () => {
  it('200 이면 문서를 돌려준다', async () => {
    const body = { title: '제목', content: '본문', lineEnding: 'lf', updatedAt: 1 }
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => body })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPublicFolderDoc('tok', 'd1')).resolves.toEqual(body)
    expect(fetchMock).toHaveBeenCalledWith('/pub/folders/tok/docs/d1', { cache: 'no-store' })
  })

  it('404 면 not_found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 404, ok: false, json: async () => ({}) }))
    await expect(fetchPublicFolderDoc('tok', 'd1')).rejects.toMatchObject({ kind: 'not_found' })
  })
})

describe('firstFolderDocId', () => {
  it('이 폴더 자신의 문서 중 updatedAt 이 가장 큰 문서를 먼저 고른다', () => {
    const folder: PublicFolder = {
      name: '폴더',
      folders: [{ id: 'sub1', name: '하위', parentId: 'root' }],
      docs: [
        { id: 'd1', title: '1', folderId: 'root', updatedAt: 10 },
        { id: 'd2', title: '2', folderId: 'root', updatedAt: 20 },
        { id: 'd3', title: '3', folderId: 'sub1', updatedAt: 999 },
      ],
    }
    expect(firstFolderDocId(folder)).toBe('d2')
  })

  it('자신의 문서가 없으면 하위 폴더 문서 중에서 고른다', () => {
    const folder: PublicFolder = {
      name: '폴더',
      folders: [{ id: 'sub1', name: '하위', parentId: 'root' }],
      docs: [{ id: 'd3', title: '3', folderId: 'sub1', updatedAt: 5 }],
    }
    expect(firstFolderDocId(folder)).toBe('d3')
  })

  it('문서가 없으면 null', () => {
    const folder: PublicFolder = { name: '폴더', folders: [], docs: [] }
    expect(firstFolderDocId(folder)).toBeNull()
  })
})
