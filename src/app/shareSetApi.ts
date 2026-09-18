// 위키링크 묶음 미리보기 — GET /api/docs/:id/share-set (specs/features/F-252.md 2.3)

export type ShareSetNode = { id: string; title: string; depth: number; parentId: string | null }
export type ShareSetPreview = { nodes: ShareSetNode[]; truncated: boolean }

export type ShareSetApiErrorKind = 'network' | 'server_error' | 'other'

export class ShareSetApiError extends Error {
  kind: ShareSetApiErrorKind
  constructor(kind: ShareSetApiErrorKind) {
    super(kind)
    this.kind = kind
  }
}

function classifyStatus(status: number): ShareSetApiErrorKind | null {
  if (status >= 500) return 'server_error'
  return null
}

export async function fetchShareSet(docId: string): Promise<ShareSetPreview> {
  let res: Response
  try {
    res = await fetch(`/api/docs/${encodeURIComponent(docId)}/share-set`, { credentials: 'same-origin' })
  } catch {
    throw new ShareSetApiError('network')
  }
  const kind = classifyStatus(res.status)
  if (kind) throw new ShareSetApiError(kind)
  if (!res.ok) throw new ShareSetApiError('other')
  return (await res.json()) as ShareSetPreview
}
