// F-209 첨부 서버 API 래퍼 — 서버 판정 결과를 그대로 돌려준다 (specs/features/F-209.md 2.3, 2.4)
import type { AttachmentExt } from '../types'
import { parseRetryAfter } from '../lib/usageLimits'

export type UploadedAttachment = { id: string; ext: AttachmentExt; mime: string; size: number; width: number; height: number }

export type AttachmentApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'too_large'
  | 'unsupported'
  | 'type_mismatch'
  | 'not_found'
  | 'quota_exceeded'
  | 'server_error'
  | 'other'
  | 'rate_limited' // 429 (F-2030)
  | 'account_blocked' // 403 { error: 'account_blocked' } (F-2030)
  | 'invalid' // 400 { error: 'invalid', field } (F-406 4.1, F-402 3.1 4·7번)
  | 'e2ee_mismatch' // 409 { error: 'e2ee_mismatch' } (F-406 4.1, F-402 3.1 5번)

export class AttachmentApiError extends Error {
  kind: AttachmentApiErrorKind
  scope?: 'minute' | 'day'
  retryAfter?: number
  limit?: number

  constructor(
    kind: AttachmentApiErrorKind,
    extra: { scope?: 'minute' | 'day'; retryAfter?: number; limit?: number } = {},
  ) {
    super(kind)
    this.kind = kind
    this.scope = extra.scope
    this.retryAfter = extra.retryAfter
    this.limit = extra.limit
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new AttachmentApiError('network')
  }
}

function classifyStatus(status: number): AttachmentApiErrorKind | null {
  if (status === 401) return 'unauthorized'
  if (status >= 500) return 'server_error'
  return null
}

// e2ee 를 주면 ?e2ee=1&w={width}&h={height} 를 붙인다 (F-406 4.1)
export async function uploadAttachment(
  id: string,
  ext: AttachmentExt,
  blob: Blob,
  e2ee?: { width: number; height: number },
): Promise<UploadedAttachment> {
  const path = e2ee
    ? `/api/attachments/${id}.${ext}?e2ee=1&w=${e2ee.width}&h=${e2ee.height}`
    : `/api/attachments/${id}.${ext}`
  const res = await send(path, { method: 'PUT', body: blob })
  if (res.status === 507) throw new AttachmentApiError('quota_exceeded')
  const kind = classifyStatus(res.status)
  if (kind) throw new AttachmentApiError(kind)
  // 507 다음, 기존 classifyStatus 다음에서 429·403 account_blocked 를 가른다 (F-2030 3.2)
  if (res.status === 429) {
    const data = (await res.json().catch(() => null)) as { scope?: unknown; limit?: unknown; retryAfter?: unknown } | null
    const scope: 'minute' | 'day' = data && data.scope === 'day' ? 'day' : 'minute'
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'), data?.retryAfter)
    const limitRaw = data?.limit
    const limit = typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    throw new AttachmentApiError('rate_limited', { scope, retryAfter, limit })
  }
  if (res.status === 403) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null
    if (data?.error === 'account_blocked') throw new AttachmentApiError('account_blocked')
  }
  if (res.status === 413) throw new AttachmentApiError('too_large')
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new AttachmentApiError(data?.error === 'e2ee_mismatch' ? 'e2ee_mismatch' : 'other')
  }
  if (res.status === 400) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    if (data?.error === 'type_mismatch') throw new AttachmentApiError('type_mismatch')
    if (data?.error === 'invalid') throw new AttachmentApiError('invalid')
    throw new AttachmentApiError('unsupported')
  }
  if (!res.ok) throw new AttachmentApiError('other')
  return (await res.json()) as UploadedAttachment
}

// F-407 이 옮기기·빼기에서 쓴다 (F-406 4.1)
export async function deleteAttachment(id: string, ext: AttachmentExt): Promise<'deleted' | 'not_found' | 'in_use'> {
  const res = await send(`/api/attachments/${id}.${ext}`, { method: 'DELETE' })
  if (res.status === 204) return 'deleted'
  if (res.status === 404) return 'not_found'
  if (res.status === 409) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    if (data?.error === 'in_use') return 'in_use'
    throw new AttachmentApiError('other')
  }
  if (res.status === 507) throw new AttachmentApiError('quota_exceeded')
  const kind = classifyStatus(res.status)
  if (kind) throw new AttachmentApiError(kind)
  if (res.status === 429) {
    const data = (await res.json().catch(() => null)) as { scope?: unknown; limit?: unknown; retryAfter?: unknown } | null
    const scope: 'minute' | 'day' = data && data.scope === 'day' ? 'day' : 'minute'
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'), data?.retryAfter)
    const limitRaw = data?.limit
    const limit = typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined
    throw new AttachmentApiError('rate_limited', { scope, retryAfter, limit })
  }
  if (res.status === 403) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null
    if (data?.error === 'account_blocked') throw new AttachmentApiError('account_blocked')
  }
  if (!res.ok) throw new AttachmentApiError('other')
  return 'deleted'
}

export type Usage = {
  used: number
  limit: number
  // F-2024 3.4 — 옛 서버·가짜 서버는 안 보낸다 (선택 필드)
  docs?: { bytes: number; bytesLimit: number; count: number; countLimit: number }
  // 화면에 쓰지 않는다 (F-2030 9장 기본값 11)
  writes?: { today: number; limit: number }
}

export async function fetchUsage(): Promise<Usage> {
  const res = await send('/api/usage')
  const kind = classifyStatus(res.status)
  if (kind) throw new AttachmentApiError(kind)
  if (!res.ok) throw new AttachmentApiError('other')
  return (await res.json()) as Usage
}

// docId 를 주면 ?doc= 를 붙인다 — 내 것이 아닌 첨부는 그 문서 열람 권한으로 판정한다 (specs/features/F-212.md 2.2)
export async function fetchAttachment(id: string, ext: AttachmentExt, docId?: string): Promise<Blob> {
  const path = docId ? `/api/attachments/${id}.${ext}?doc=${encodeURIComponent(docId)}` : `/api/attachments/${id}.${ext}`
  const res = await send(path)
  const kind = classifyStatus(res.status)
  if (kind) throw new AttachmentApiError(kind)
  if (res.status === 404) throw new AttachmentApiError('not_found')
  if (!res.ok) throw new AttachmentApiError('other')
  return res.blob()
}
