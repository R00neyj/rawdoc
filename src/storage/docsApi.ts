// F-206 서버 API 호출 래퍼 — fetch 하나로 감싸고 오류를 종류별로 분류한다 (specs/features/F-207.md 2.3)
import type { Doc, Folder, LineEnding } from '../types'

export type ServerDoc = Doc & { version: number }
export type ServerDocSummary = Omit<Doc, 'content'> & { version: number }
export type ServerFolder = Folder

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'not_found'
  | 'too_large'
  | 'conflict'
  | 'locked'
  | 'id_taken'
  | 'invalid'
  | 'forbidden'
  | 'server_error'
  | 'other'

export class ApiError extends Error {
  kind: ApiErrorKind
  status?: number
  doc?: ServerDoc
  email?: string
  expiresAt?: number

  constructor(
    kind: ApiErrorKind,
    extra: { status?: number; doc?: ServerDoc; email?: string; expiresAt?: number } = {},
  ) {
    super(kind)
    this.kind = kind
    this.status = extra.status
    this.doc = extra.doc
    this.email = extra.email
    this.expiresAt = extra.expiresAt
  }
}

// 편집 잠금 세션 id — 창(탭)마다 하나, 문서를 옮겨 다녀도 같다 (specs/features/F-213.md 2.2)
export const lockSessionId: string =
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, { credentials: 'same-origin', ...init })
  } catch {
    throw new ApiError('network')
  }
}

function classifyStatus(status: number): ApiErrorKind | null {
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

function jsonInit(body: unknown, method: string): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

export async function listDocs(): Promise<ServerDocSummary[]> {
  const res = await send('/api/docs')
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDocSummary[]
}

export async function getDoc(id: string): Promise<ServerDoc> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}`)
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function createDoc(body: {
  id: string
  title: string
  content: string
  lineEnding: LineEnding
  folderId: string | null
  // 로컬 이관(F-208 2.2·2.3)이 원본 시각을 유지할 때만 보낸다
  createdAt?: number
  updatedAt?: number
  pinnedAt?: number | null
}): Promise<ServerDoc> {
  const res = await send('/api/docs', jsonInit(body, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 413) throw new ApiError('too_large')
  if (res.status === 409) throw new ApiError('id_taken')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function updateDoc(
  id: string,
  body: { title?: string; content?: string; baseVersion: number },
): Promise<ServerDoc> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Lock-Session': lockSessionId },
    body: JSON.stringify(body),
  })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 403) throw new ApiError('forbidden')
  if (res.status === 413) throw new ApiError('too_large')
  if (res.status === 423) {
    const data = (await readJson(res)) as { email?: string; expiresAt?: number } | null
    throw new ApiError('locked', { email: data?.email, expiresAt: data?.expiresAt })
  }
  if (res.status === 409) {
    const data = (await readJson(res)) as { doc?: ServerDoc } | null
    throw new ApiError('conflict', { doc: data?.doc })
  }
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

// 잡기·연장 — edit 이상 권한 필요, 200 이면 잡음/연장, 423 이면 다른 세션이 쥐고 있음 (F-213.md 2.2)
export async function lockDoc(id: string, sessionId: string): Promise<{ expiresAt: number }> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}/lock`, jsonInit({ sessionId }, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 403) throw new ApiError('forbidden')
  if (res.status === 423) {
    const data = (await readJson(res)) as { email?: string; expiresAt?: number } | null
    throw new ApiError('locked', { email: data?.email, expiresAt: data?.expiresAt })
  }
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as { expiresAt: number }
}

// 같은 세션일 때만 서버가 지운다. 못 보내도 60초 뒤 만료하므로 오류는 무시한다 (F-213.md 2.2·2.3)
export async function unlockDoc(id: string, sessionId: string, opts: { keepalive?: boolean } = {}): Promise<void> {
  try {
    await fetch(`/api/docs/${encodeURIComponent(id)}/lock?session=${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      keepalive: opts.keepalive,
    })
  } catch {
    // 못 보내도 60초 뒤 만료 (2.3)
  }
}

export async function moveDocFolder(id: string, folderId: string | null): Promise<ServerDoc> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}/folder`, jsonInit({ folderId }, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function setPinned(id: string, pinned: boolean): Promise<ServerDoc> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}/pin`, jsonInit({ pinned }, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function removeDoc(id: string): Promise<void> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok && res.status !== 204) throw new ApiError('other', { status: res.status })
}

export async function listFolders(): Promise<ServerFolder[]> {
  const res = await send('/api/folders')
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerFolder[]
}

export async function createFolder(body: {
  id: string
  name: string
  parentId: string | null
}): Promise<ServerFolder> {
  const res = await send('/api/folders', jsonInit(body, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 409) throw new ApiError('id_taken')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerFolder
}

export async function updateFolder(
  id: string,
  body: { name?: string; parentId?: string | null },
): Promise<ServerFolder> {
  const res = await send(`/api/folders/${encodeURIComponent(id)}`, jsonInit(body, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerFolder
}

export async function removeFolder(id: string): Promise<void> {
  const res = await send(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok && res.status !== 204) throw new ApiError('other', { status: res.status })
}

// 나에게 권한이 있는(내 소유가 아닌) 문서 메타 — GET /api/shared (specs/features/F-212.md 2.3·2.4)
export type SharedDocMeta = ServerDocSummary & {
  role: 'edit' | 'view'
  ownerEmail: string
  viaFolder?: { id: string; name: string }
}

export async function getShared(): Promise<SharedDocMeta[]> {
  const res = await send('/api/shared')
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as SharedDocMeta[]
}

// 초대(권한 부여) 관리 — owner 만 (F-212.md 2.3)
export type GrantTargetType = 'doc' | 'folder'
export type GrantRole = 'view' | 'edit'
export type Grant = { email: string; role: GrantRole; createdAt: number }

function grantsPath(targetType: GrantTargetType, targetId: string): string {
  return `/api/${targetType}s/${encodeURIComponent(targetId)}/grants`
}

export async function listGrants(targetType: GrantTargetType, targetId: string): Promise<Grant[]> {
  const res = await send(grantsPath(targetType, targetId))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as Grant[]
}

export async function putGrant(
  targetType: GrantTargetType,
  targetId: string,
  email: string,
  role: GrantRole,
): Promise<Grant> {
  const res = await send(`${grantsPath(targetType, targetId)}/${encodeURIComponent(email)}`, jsonInit({ role }, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as Grant
}

export async function deleteGrant(targetType: GrantTargetType, targetId: string, email: string): Promise<void> {
  const res = await send(`${grantsPath(targetType, targetId)}/${encodeURIComponent(email)}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok && res.status !== 204) throw new ApiError('other', { status: res.status })
}
