// 공유 관리 페이지 목록·권한 요청 처리 API — GET /api/shares, POST /api/access-requests/{id}/approve|reject (specs/features/F-243.md 3.2, F-2136)
import type { AccessRequestRow } from '../../lib/share/accessRequest'

export type ShareLinkRow = {
  token: string
  targetType: 'doc' | 'folder'
  targetId: string
  targetName: string
  createdAt: number
}

export type ShareGrantRow = {
  targetType: 'doc' | 'folder'
  targetId: string
  targetName: string
  email: string
  role: 'view' | 'edit'
  createdAt: number
}

export type SharesErrorKind = 'network' | 'unauthorized' | 'server_error' | 'other'

export class SharesApiError extends Error {
  kind: SharesErrorKind
  constructor(kind: SharesErrorKind) {
    super(kind)
    this.kind = kind
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new SharesApiError('network')
  }
}

function classifyStatus(status: number): SharesErrorKind | null {
  if (status === 401) return 'unauthorized'
  if (status >= 500) return 'server_error'
  return null
}

export async function listShares(): Promise<{ links: ShareLinkRow[]; grants: ShareGrantRow[]; requests: AccessRequestRow[] }> {
  const res = await send('/api/shares')
  const kind = classifyStatus(res.status)
  if (kind) throw new SharesApiError(kind)
  if (!res.ok) throw new SharesApiError('other')
  return (await res.json()) as { links: ShareLinkRow[]; grants: ShareGrantRow[]; requests: AccessRequestRow[] }
}

export type AccessRequestDecision = 'ok' | 'gone' | 'failed'

async function decideAccessRequest(id: string, action: 'approve' | 'reject'): Promise<AccessRequestDecision> {
  try {
    const res = await fetch(`/api/access-requests/${encodeURIComponent(id)}/${action}`, { credentials: 'same-origin', method: 'POST' })
    if (res.status === 200 || res.status === 204) return 'ok'
    return res.status === 404 ? 'gone' : 'failed'
  } catch {
    return 'failed'
  }
}

export const approveAccessRequest = (id: string) => decideAccessRequest(id, 'approve')
export const rejectAccessRequest = (id: string) => decideAccessRequest(id, 'reject')
