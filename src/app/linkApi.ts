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

export type ShareLinkInfo = { token: string; docIds: string[] }

// 끊기지 않은 링크가 있으면 token·docIds, 없으면(404) null (docIds — F-252.md 2.4)
export async function getShareLink(docId: string): Promise<ShareLinkInfo | null> {
  const res = await send(`/api/docs/${encodeURIComponent(docId)}/link`)
  if (res.status === 404) return null
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok) throw new LinkApiError('other')
  const data = (await res.json()) as { token: string; docIds?: string[] }
  return { token: data.token, docIds: data.docIds ?? [] }
}

// 있으면 그 토큰, 없으면 새로 발급. docIds 를 주면 함께 공유할 문서 묶음으로 발급한다 (F-252.md 2.4)
export async function createShareLink(docId: string, docIds?: string[]): Promise<string> {
  const init: RequestInit = { method: 'POST' }
  if (docIds !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify({ docIds })
  }
  const res = await send(`/api/docs/${encodeURIComponent(docId)}/link`, init)
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

// 폴더 읽기 전용 링크 — GET·POST·DELETE /api/folders/:id/link (F-211.md 2.1, 규칙은 문서와 같다)
export async function getFolderShareLink(folderId: string): Promise<string | null> {
  const res = await send(`/api/folders/${encodeURIComponent(folderId)}/link`)
  if (res.status === 404) return null
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok) throw new LinkApiError('other')
  const data = (await res.json()) as { token: string }
  return data.token
}

export async function createFolderShareLink(folderId: string): Promise<string> {
  const res = await send(`/api/folders/${encodeURIComponent(folderId)}/link`, { method: 'POST' })
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok) throw new LinkApiError('other')
  const data = (await res.json()) as { token: string }
  return data.token
}

export async function revokeFolderShareLink(folderId: string): Promise<void> {
  const res = await send(`/api/folders/${encodeURIComponent(folderId)}/link`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new LinkApiError(kind)
  if (!res.ok && res.status !== 204) throw new LinkApiError('other')
}
