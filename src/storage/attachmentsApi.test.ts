// F-2030 3.2 — uploadAttachment 429·403 account_blocked 분류 (U6)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { AttachmentApiError, uploadAttachment } from './attachmentsApi'

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
