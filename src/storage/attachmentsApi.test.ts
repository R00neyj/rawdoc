// F-2030 3.2 — uploadAttachment 429·403 account_blocked 분류 (U6)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { AttachmentApiError, deleteAttachment, uploadAttachment } from './attachmentsApi'

function jsonResponse(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('U6: uploadAttachment 새 오류 종류', () => {
  it('429 → rate_limited', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate_limited', scope: 'minute' }, { 'Retry-After': '30' })),
    )
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'rate_limited', scope: 'minute', retryAfter: 30 })
  })

  it('403 account_blocked → account_blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'account_blocked' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'account_blocked' })
  })

  it('507 → quota_exceeded (지금 그대로)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(507, { error: 'quota_exceeded' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toBeInstanceOf(AttachmentApiError)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(507, { error: 'quota_exceeded' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'quota_exceeded' })
  })
})

describe('F-406 S5: uploadAttachment 분류·e2ee 쿼리', () => {
  it('400 invalid → invalid, 400 unsupported → unsupported, 400 type_mismatch → type_mismatch, 400 JSON 아님 → unsupported', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid', field: 'body' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'invalid' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'unsupported' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'unsupported' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'type_mismatch' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'type_mismatch' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 400 })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'unsupported' })
  })

  it('409 e2ee_mismatch → e2ee_mismatch, 409 그 밖 → other', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: 'e2ee_mismatch' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'e2ee_mismatch' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: 'other_thing' })))
    await expect(uploadAttachment('a', 'png', new Blob())).rejects.toMatchObject({ kind: 'other' })
  })

  it('e2ee 를 주면 요청 URL 쿼리 e2ee=1&w=…&h=…', async () => {
    const uploaded = { id: 'a', ext: 'png', mime: 'image/png', size: 3, width: 10, height: 20 }
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(201, uploaded))
    vi.stubGlobal('fetch', fetchMock)
    await uploadAttachment('a', 'png', new Blob(), { width: 10, height: 20 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attachments/a.png?e2ee=1&w=10&h=20')

    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, uploaded))
    await uploadAttachment('a', 'png', new Blob())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/attachments/a.png')
  })
})

describe('F-406 S6: deleteAttachment', () => {
  it('204 → deleted, 404 → not_found, 409 in_use → in_use, 500 → server_error 던짐, 429 → rate_limited, 요청은 DELETE', async () => {
    const fetchMock204 = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock204)
    await expect(deleteAttachment('a', 'png')).resolves.toBe('deleted')
    expect(fetchMock204.mock.calls[0][0]).toBe('/api/attachments/a.png')
    expect(fetchMock204.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(deleteAttachment('a', 'png')).resolves.toBe('not_found')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: 'in_use' })))
    await expect(deleteAttachment('a', 'png')).resolves.toBe('in_use')

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(deleteAttachment('a', 'png')).rejects.toMatchObject({ kind: 'server_error' })
  })

  it('fetch 거부 → network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    await expect(deleteAttachment('a', 'png')).rejects.toMatchObject({ kind: 'network' })
  })

  it('429 → rate_limited(scope·retryAfter)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate_limited', scope: 'day' }, { 'Retry-After': '60' })),
    )
    await expect(deleteAttachment('a', 'png')).rejects.toMatchObject({ kind: 'rate_limited', scope: 'day', retryAfter: 60 })
  })
})
