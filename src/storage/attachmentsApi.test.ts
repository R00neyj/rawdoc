// attachmentsApi 단위 — fetch 를 대체해 상태별 분류를 확인한다
import { describe, expect, it, vi, afterEach } from 'vitest'
import { uploadAttachment, fetchAttachment, AttachmentApiError } from './attachmentsApi'

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('uploadAttachment', () => {
  it('201 이면 결과를 그대로 돌려준다', async () => {
    mockFetch(() => new Response(JSON.stringify({ id: 'a', ext: 'png', mime: 'image/png', size: 1, width: 1, height: 1 }), { status: 201 }))
    const result = await uploadAttachment('a', 'png', new Blob(['x']))
    expect(result.mime).toBe('image/png')
  })

  it('413 이면 too_large', async () => {
    mockFetch(() => new Response('{}', { status: 413 }))
    await expect(uploadAttachment('a', 'png', new Blob(['x']))).rejects.toMatchObject({ kind: 'too_large' })
  })

  it('400 type_mismatch 이면 그 종류', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'type_mismatch' }), { status: 400 }))
    await expect(uploadAttachment('a', 'png', new Blob(['x']))).rejects.toMatchObject({ kind: 'type_mismatch' })
  })

  it('400 그 외면 unsupported', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'unsupported' }), { status: 400 }))
    await expect(uploadAttachment('a', 'png', new Blob(['x']))).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('401 이면 unauthorized', async () => {
    mockFetch(() => new Response('{}', { status: 401 }))
    await expect(uploadAttachment('a', 'png', new Blob(['x']))).rejects.toMatchObject({ kind: 'unauthorized' })
  })

  it('네트워크 실패면 network', async () => {
    mockFetch(() => {
      throw new Error('offline')
    })
    await expect(uploadAttachment('a', 'png', new Blob(['x']))).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('fetchAttachment', () => {
  it('200 이면 blob 을 돌려준다', async () => {
    mockFetch(() => new Response(new Blob(['x']), { status: 200 }))
    const blob = await fetchAttachment('a', 'png')
    expect(blob).toBeInstanceOf(Blob)
  })

  it('404 이면 not_found', async () => {
    mockFetch(() => new Response('{}', { status: 404 }))
    await expect(fetchAttachment('a', 'png')).rejects.toBeInstanceOf(AttachmentApiError)
    mockFetch(() => new Response('{}', { status: 404 }))
    await expect(fetchAttachment('a', 'png')).rejects.toMatchObject({ kind: 'not_found' })
  })
})
