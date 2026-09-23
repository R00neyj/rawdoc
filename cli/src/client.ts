// '/v1' HTTP 클라이언트. fetch 주입 (specs/features/F-2021.md 4.1)
import type { V1Attachment, V1Doc, V1DocSummary, V1Folder, V1Link, V1Me } from '../../worker/v1Contract'
import { CliError } from './output'

export type ClientConfig = {
  origin: string
  token: string
  fetchImpl: typeof fetch
  userAgent: string
  timeoutMs?: number
}

type RequestOptions = { notFoundId?: string }

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
}

async function handleResponse(res: Response, opts: RequestOptions): Promise<unknown> {
  if (res.status === 204) return undefined

  const text = await res.text()
  let json: unknown = null
  if (text) {
    try {
      json = JSON.parse(text)
    } catch {
      if (res.status >= 200 && res.status < 300) return null
      throw new CliError('bad_response', { status: res.status })
    }
  }

  if (res.status >= 200 && res.status < 300) return json

  const body = (json ?? {}) as Record<string, unknown>
  if (res.status === 401) throw new CliError('unauthenticated', { status: 401 })
  if (res.status === 403) throw new CliError('forbidden', { status: 403 })
  if (res.status === 404) throw new CliError('not_found', { status: 404, id: opts.notFoundId })
  if (res.status === 409) {
    const doc = body.doc as { version?: number } | undefined
    throw new CliError('conflict', { status: 409, currentVersion: doc?.version })
  }
  if (res.status === 423) {
    throw new CliError('locked', {
      status: 423,
      email: body.email as string | undefined,
      expiresAt: body.expiresAt as number | undefined,
    })
  }
  if (res.status === 413) throw new CliError('too_large', { status: 413, limit: body.limit as number | undefined })
  if (res.status === 507) {
    throw new CliError('quota_exceeded', {
      status: 507,
      used: body.used as number | undefined,
      limit: body.limit as number | undefined,
    })
  }
  if (res.status === 400) throw new CliError('invalid', { status: 400, field: body.field as string | undefined })
  if (res.status >= 500) throw new CliError('server_error', { status: res.status })
  throw new CliError('bad_response', { status: res.status })
}

async function request(
  cfg: ClientConfig,
  method: string,
  path: string,
  body: Uint8Array | Record<string, unknown> | undefined,
  opts: RequestOptions = {},
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    'User-Agent': cfg.userAgent,
  }
  let payload: BodyInit | undefined
  if (body instanceof Uint8Array) {
    payload = body as BodyInit
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8'
    payload = JSON.stringify(body)
  }

  let res: Response
  try {
    res = await cfg.fetchImpl(`${cfg.origin}${path}`, {
      method,
      headers,
      body: payload,
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 60_000),
    })
  } catch (err) {
    if (isTimeoutError(err)) throw new CliError('timeout')
    throw new CliError('network', { origin: cfg.origin })
  }

  return handleResponse(res, opts)
}

export function apiMe(cfg: ClientConfig): Promise<V1Me> {
  return request(cfg, 'GET', '/v1/me', undefined) as Promise<V1Me>
}

export function apiListDocs(cfg: ClientConfig): Promise<V1DocSummary[]> {
  return request(cfg, 'GET', '/v1/docs', undefined) as Promise<V1DocSummary[]>
}

export function apiGetDoc(cfg: ClientConfig, id: string): Promise<V1Doc> {
  return request(cfg, 'GET', `/v1/docs/${encodeURIComponent(id)}`, undefined, { notFoundId: id }) as Promise<V1Doc>
}

export function apiCreateDoc(
  cfg: ClientConfig,
  body: { title: string; content: string; lineEnding: 'crlf' | 'lf'; folderId?: string },
): Promise<V1Doc> {
  return request(cfg, 'POST', '/v1/docs', body) as Promise<V1Doc>
}

export function apiUpdateDoc(
  cfg: ClientConfig,
  id: string,
  body: { title?: string; content?: string; baseVersion: number },
): Promise<V1Doc> {
  return request(cfg, 'PUT', `/v1/docs/${encodeURIComponent(id)}`, body, { notFoundId: id }) as Promise<V1Doc>
}

export function apiListFolders(cfg: ClientConfig): Promise<V1Folder[]> {
  return request(cfg, 'GET', '/v1/folders', undefined) as Promise<V1Folder[]>
}

export function apiCreateFolder(cfg: ClientConfig, body: { name: string; parentId?: string }): Promise<V1Folder> {
  return request(cfg, 'POST', '/v1/folders', body) as Promise<V1Folder>
}

export function apiUploadAttachment(cfg: ClientConfig, bytes: Uint8Array): Promise<V1Attachment> {
  return request(cfg, 'POST', '/v1/attachments', bytes) as Promise<V1Attachment>
}

export function apiCreateLink(cfg: ClientConfig, id: string): Promise<V1Link> {
  return request(cfg, 'POST', `/v1/docs/${encodeURIComponent(id)}/link`, undefined, {
    notFoundId: id,
  }) as Promise<V1Link>
}
