// 소유자 읽기 전용 링크 관리 — GET·POST·DELETE /api/docs/:id/link (specs/features/F-210.md 2.2·2.6)

export type LinkApiErrorKind = 'network' | 'server_error' | 'other'

export class LinkApiError extends Error {
  kind: LinkApiErrorKind
  constructor(kind: LinkApiErrorKind) {
    super(kind)
    this.kind = kind
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new LinkApiError('network')
  }
}

function classifyStatus(status: number): LinkApiErrorKind | null {
  if (status >= 500) return 'server_error'
  return null
}

// 끊기지 않은 링크가 있으면 토큰, 없으면(404) null
export async function getShareLink(docId: string): Promise<string | null> {
  const res = await send(`/api/docs/${encodeURIComponent(docId)}/link`)
  if (res.status === 404) return null
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok) throw new LinkApiError('other')
  const data = (await res.json()) as { token: string }
  return data.token
}

// 있으면 그 토큰, 없으면 새로 발급
export async function createShareLink(docId: string): Promise<string> {
  const res = await send(`/api/docs/${encodeURIComponent(docId)}/link`, { method: 'POST' })
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok) throw new LinkApiError('other')
  const data = (await res.json()) as { token: string }
  return data.token
}

export async function revokeShareLink(docId: string): Promise<void> {
  const res = await send(`/api/docs/${encodeURIComponent(docId)}/link`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok && res.status !== 204) throw new LinkApiError('other')
}
