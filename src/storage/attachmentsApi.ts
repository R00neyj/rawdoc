// F-209 첨부 서버 API 래퍼 — 서버 판정 결과를 그대로 돌려준다 (specs/features/F-209.md 2.3, 2.4)
import type { AttachmentExt } from '../types'

export type UploadedAttachment = { id: string; ext: AttachmentExt; mime: string; size: number; width: number; height: number }

export type AttachmentApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'too_large'
  | 'unsupported'
  | 'type_mismatch'
  | 'not_found'
  | 'server_error'
  | 'other'

export class AttachmentApiError extends Error {
  kind: AttachmentApiErrorKind
  constructor(kind: AttachmentApiErrorKind) {
    super(kind)
    this.kind = kind
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

export async function uploadAttachment(id: string, ext: AttachmentExt, blob: Blob): Promise<UploadedAttachment> {
  const res = await send(`/api/attachments/${id}.${ext}`, { method: 'PUT', body: blob })
  const kind = classifyStatus(res.status)
  if (kind) throw new AttachmentApiError(kind)
  if (res.status === 413) throw new AttachmentApiError('too_large')
  if (res.status === 400) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new AttachmentApiError(data?.error === 'type_mismatch' ? 'type_mismatch' : 'unsupported')
  }
  if (!res.ok) throw new AttachmentApiError('other')
  return (await res.json()) as UploadedAttachment
}

export async function fetchAttachment(id: string, ext: AttachmentExt): Promise<Blob> {
  const res = await send(`/api/attachments/${id}.${ext}`)
  const kind = classifyStatus(res.status)
  if (kind) throw new AttachmentApiError(kind)
  if (res.status === 404) throw new AttachmentApiError('not_found')
  if (!res.ok) throw new AttachmentApiError('other')
  return res.blob()
}
