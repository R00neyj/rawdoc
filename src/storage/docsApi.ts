// F-206 서버 API 호출 래퍼 — fetch 하나로 감싸고 오류를 종류별로 분류한다 (specs/features/F-207.md 2.3)
import type { Doc, Folder, LineEnding } from '../types'
import { getLockSessionId, isLockSessionSettled, lockSessionReady } from './lockSession'
import { parseRetryAfter } from '../lib/usageLimits'
import type { CommentImportBody, CommentImportResponse } from '../lib/docComments'

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
  | 'rate_limited' // 429 (F-2030)
  | 'doc_quota_exceeded' // 413 { error: 'doc_quota_exceeded' } (F-2030)
  | 'account_blocked' // 403 { error: 'account_blocked' } (F-2030)
  | 'e2ee_doc' // 409 — 금고 문서에 표지 없는 PUT (F-405 5.1)
  | 'not_e2ee' // 409 — 일반 문서에 금고 표지 PUT
  | 'e2ee_folder' // 409 — 금고 폴더 규칙 위반
  | 'no_vault' // 409 — 키 묶음 없이 금고 문서 만들기
  | 'e2ee_folder_not_ready' // 409 { error: 'e2ee_folder_not_ready', docs, folders } — 바로 아래에 일반 문서·폴더가 있다 (F-407 3.2)
  | 'comments_exist' // 409 { error: 'comments_exist' } — 방에 이미 댓글이 있다 (F-503 6.4, F-508 3.4)

export class ApiError extends Error {
  kind: ApiErrorKind
  status?: number
  doc?: ServerDoc
  email?: string
  expiresAt?: number
  scope?: 'minute' | 'day'
  retryAfter?: number
  limit?: number
  used?: number
  resource?: 'bytes' | 'docs'

  constructor(
    kind: ApiErrorKind,
    extra: {
      status?: number
      doc?: ServerDoc
      email?: string
      expiresAt?: number
      scope?: 'minute' | 'day'
      retryAfter?: number
      limit?: number
      used?: number
      resource?: 'bytes' | 'docs'
    } = {},
  ) {
    super(kind)
    this.kind = kind
    this.status = extra.status
    this.doc = extra.doc
    this.email = extra.email
    this.expiresAt = extra.expiresAt
    this.scope = extra.scope
    this.retryAfter = extra.retryAfter
    this.limit = extra.limit
    this.used = extra.used
    this.resource = extra.resource
  }
}

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

// 409 몸통의 error 가 allowed 안에 있으면 그 종류, 아니면 null (F-405 5.1)
function e2eeConflictKind(data: unknown, allowed: ApiErrorKind[]): ApiErrorKind | null {
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
  return typeof error === 'string' && (allowed as string[]).includes(error) ? (error as ApiErrorKind) : null
}

// 429 — 쓰기 함수 전부가 기존 갈래보다 먼저 본다 (F-2030 3.1)
async function rateLimitedError(res: Response): Promise<ApiError> {
  const data = (await readJson(res)) as { scope?: unknown; limit?: unknown; retryAfter?: unknown } | null
  const scope: 'minute' | 'day' = data && data.scope === 'day' ? 'day' : 'minute'
  const retryAfter = parseRetryAfter(res.headers.get('Retry-After'), data?.retryAfter)
  const limitRaw = data?.limit
  const limit = typeof limitRaw === 'number' && Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : undefined
  return new ApiError('rate_limited', { scope, retryAfter, limit })
}

// 413 몸통이 doc_quota_exceeded 일 때만 — 아니면 null(기존 413 갈래로 넘어간다) (F-2030 3.1)
async function docQuotaError(res: Response): Promise<ApiError | null> {
  const data = (await readJson(res)) as { error?: unknown; resource?: unknown; used?: unknown; limit?: unknown } | null
  if (!data || data.error !== 'doc_quota_exceeded') return null
  const resource: 'bytes' | 'docs' = data.resource === 'docs' ? 'docs' : 'bytes'
  const used = typeof data.used === 'number' && Number.isFinite(data.used) && data.used >= 0 ? data.used : undefined
  const limit = typeof data.limit === 'number' && Number.isFinite(data.limit) && data.limit >= 0 ? data.limit : undefined
  return new ApiError('doc_quota_exceeded', { resource, used, limit })
}

// 403 몸통이 account_blocked 일 때만 — 아니면 null(기존 403 갈래로 넘어간다) (F-2030 3.1)
async function accountBlockedError(res: Response): Promise<ApiError | null> {
  const data = (await readJson(res)) as { error?: unknown } | null
  if (!data || data.error !== 'account_blocked') return null
  return new ApiError('account_blocked')
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
  // 금고 문서만 (F-405 5.1)
  e2eeKey?: string
  attachmentRefs?: string[]
}): Promise<ServerDoc> {
  const res = await send('/api/docs', jsonInit(body, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
    throw new ApiError('too_large')
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 409) throw new ApiError(e2eeConflictKind(await readJson(res), ['e2ee_folder', 'no_vault']) ?? 'id_taken')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function updateDoc(
  id: string,
  body: { title?: string; content?: string; baseVersion: number; e2ee?: true; attachmentRefs?: string[] },
): Promise<ServerDoc> {
  if (!isLockSessionSettled()) await lockSessionReady() // 탭 복제로 회전할지 정해지기 전엔 세션 id 를 싣는 요청을 안 보낸다 (F-297.md 4.2)
  const res = await send(`/api/docs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Lock-Session': getLockSessionId() },
    body: JSON.stringify(body),
  })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 403) throw new ApiError('forbidden')
  if (res.status === 413) throw new ApiError('too_large')
  if (res.status === 423) {
    const data = (await readJson(res)) as { email?: string; expiresAt?: number } | null
    throw new ApiError('locked', { email: data?.email, expiresAt: data?.expiresAt })
  }
  if (res.status === 409) {
    const data = (await readJson(res)) as { doc?: ServerDoc } | null
    const e2eeKind = e2eeConflictKind(data, ['e2ee_doc', 'not_e2ee'])
    if (e2eeKind) throw new ApiError(e2eeKind)
    throw new ApiError('conflict', { doc: data?.doc })
  }
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

// 로그인 이관 — 로컬 댓글 기록을 서버 방으로 옮긴다 (F-508.md 3.4)
export async function importDocComments(id: string, body: CommentImportBody): Promise<CommentImportResponse> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}/comments/import`, jsonInit(body, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
    throw new ApiError('forbidden')
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 409) {
    const kind2 = e2eeConflictKind(await readJson(res), ['comments_exist', 'e2ee_doc'])
    throw new ApiError(kind2 ?? 'other', { status: 409 })
  }
  if (res.status === 413) throw new ApiError('too_large')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as CommentImportResponse
}

// 잡기·연장 — edit 이상 권한 필요, 200 이면 잡음/연장, 423 이면 다른 세션이 쥐고 있음 (F-213.md 2.2)
export async function lockDoc(id: string): Promise<{ expiresAt: number }> {
  if (!isLockSessionSettled()) await lockSessionReady()
  const res = await send(`/api/docs/${encodeURIComponent(id)}/lock`, jsonInit({ sessionId: getLockSessionId() }, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
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
export async function unlockDoc(id: string, opts: { keepalive?: boolean } = {}): Promise<void> {
  if (!isLockSessionSettled()) await lockSessionReady()
  try {
    await fetch(`/api/docs/${encodeURIComponent(id)}/lock?session=${encodeURIComponent(getLockSessionId())}`, {
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
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 400) throw new ApiError('invalid')
  if (res.status === 409) throw new ApiError(e2eeConflictKind(await readJson(res), ['e2ee_folder']) ?? 'other', { status: 409 })
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function setPinned(id: string, pinned: boolean): Promise<ServerDoc> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}/pin`, jsonInit({ pinned }, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerDoc
}

export async function removeDoc(id: string): Promise<void> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
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
  e2ee?: true
}): Promise<ServerFolder> {
  const res = await send('/api/folders', jsonInit(body, 'POST'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 409) throw new ApiError(e2eeConflictKind(await readJson(res), ['e2ee_folder']) ?? 'id_taken')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerFolder
}

export async function updateFolder(
  id: string,
  body: { name?: string; parentId?: string | null; e2ee?: boolean },
): Promise<ServerFolder> {
  const res = await send(`/api/folders/${encodeURIComponent(id)}`, jsonInit(body, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 400) throw new ApiError('invalid')
  if (res.status === 409) throw new ApiError(e2eeConflictKind(await readJson(res), ['e2ee_folder', 'e2ee_folder_not_ready']) ?? 'other', { status: 409 })
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as ServerFolder
}

// 금고로 옮기기·빼기 — 편집 잠금을 보지 않으므로 X-Lock-Session 을 싣지 않는다. 분류 차례는 updateDoc 과 같다 (F-407 3.2)
export async function setDocE2ee(
  id: string,
  body: { e2eeKey: string | null; title: string; content: string; attachmentRefs: string[] | null; baseVersion: number },
): Promise<ServerDoc & { purged: boolean }> {
  const res = await send(`/api/docs/${encodeURIComponent(id)}/e2ee`, jsonInit(body, 'PUT'))
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 403) throw new ApiError('forbidden')
  if (res.status === 413) throw new ApiError('too_large')
  if (res.status === 409) {
    const data = (await readJson(res)) as { doc?: ServerDoc } | null
    const e2eeKind = e2eeConflictKind(data, ['e2ee_doc', 'not_e2ee', 'e2ee_folder', 'no_vault'])
    if (e2eeKind) throw new ApiError(e2eeKind)
    throw new ApiError('conflict', { doc: data?.doc })
  }
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  const data = (await readJson(res)) as ServerDoc & { purged?: unknown }
  // 옛 서버는 purged 를 싣지 않는다 — 불리언이 아니면 지운 것으로 본다
  return { ...data, purged: typeof data.purged === 'boolean' ? data.purged : true }
}

export async function removeFolder(id: string, mode: 'move-up' | 'delete-all' = 'move-up'): Promise<void> {
  const res = await send(`/api/folders/${encodeURIComponent(id)}?contents=${mode}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
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
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (res.status === 400) throw new ApiError('invalid')
  if (!res.ok) throw new ApiError('other', { status: res.status })
  return (await readJson(res)) as Grant
}

export async function deleteGrant(targetType: GrantTargetType, targetId: string, email: string): Promise<void> {
  const res = await send(`${grantsPath(targetType, targetId)}/${encodeURIComponent(email)}`, { method: 'DELETE' })
  const kind = classifyStatus(res.status)
  if (kind) throw new ApiError(kind)
  if (res.status === 429) throw await rateLimitedError(res)
  if (res.status === 413) {
    const quota = await docQuotaError(res)
    if (quota) throw quota
  }
  if (res.status === 403) {
    const blocked = await accountBlockedError(res)
    if (blocked) throw blocked
  }
  if (res.status === 404) throw new ApiError('not_found')
  if (!res.ok && res.status !== 204) throw new ApiError('other', { status: res.status })
}
