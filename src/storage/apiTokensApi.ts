// F-222 API 토큰 관리 API 래퍼 (specs/features/F-222.md 2.2)
export type ApiToken = { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }
export type CreatedApiToken = ApiToken & { token: string }

export type ApiTokensErrorKind = 'network' | 'unauthorized' | 'invalid' | 'too_many' | 'not_found' | 'server_error' | 'other'

export class ApiTokensError extends Error {
  kind: ApiTokensErrorKind
  limit?: number
  constructor(kind: ApiTokensErrorKind, extra: { limit?: number } = {}) {
    super(kind)
    this.kind = kind
    this.limit = extra.limit
  }
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiTokensError('network')
  }
}

function classifyStatus(status: number): ApiTokensErrorKind | null {
  if (status === 401) return 'unauthorized'
  if (status >= 500) return 'server_error'
  return null
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export async function listTokens(): Promise<ApiToken[]> {
  const res = await send('/api/tokens')
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiTokensError(kind)
  if (!res.ok) throw new ApiTokensError('other')
  return (await readJson(res)) as ApiToken[]
}

export async function createToken(name: string): Promise<CreatedApiToken> {
  const res = await send('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiTokensError(kind)
  if (res.status === 400) throw new ApiTokensError('invalid')
  if (res.status === 409) {
    const data = (await readJson(res)) as { limit?: number } | null
    throw new ApiTokensError('too_many', { limit: data?.limit })
  }
  if (!res.ok) throw new ApiTokensError('other')
  return (await readJson(res)) as CreatedApiToken
}

export async function revokeToken(id: string): Promise<void> {
  const res = await send(`/api/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiTokensError(kind)
  if (res.status === 404) throw new ApiTokensError('not_found')
  if (!res.ok && res.status !== 204) throw new ApiTokensError('other')
}
