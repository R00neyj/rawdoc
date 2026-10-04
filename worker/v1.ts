// 자동 업로드 API '/v1' 전용 핸들러 — 몸통 보정·응답 모양만 여기서 하고, 나머지는 기존 /api 핸들러를 그대로 부른다 (specs/features/F-223.md)
import { errorResponse, jsonResponse } from './http'
import { rememberUser, requireUser, type AuthUser } from './auth'
import { getDocAccess, getOwnedFolder, roleAtLeast } from './access'
import { badBody, deleteDocRows, handleCreateDoc, handleListDocs, handleUpdateDoc, readJsonLimited, writeMoveDocFolder } from './docs'
import { deleteFolderContents, folderSubtreeHasE2ee, handleCreateFolder, type FolderRow } from './folders'
import { handleGetShared } from './grants'
import { rowToDoc } from './docWrite'
import type { DocRow } from './docWrite'
import { writeTextInRoom } from './docRoomRpc'
import type { RoomDocState, RoomTextWrite } from './docRoomCore'
import { handleCreateDocLink } from './links'
import { MAX_ATTACHMENT_BYTES, generateAttachmentId, storeAttachment } from './attachments'
import { buildImageLine } from '../src/lib/imageMarkdown'
import { fromEditorText, toEditorText } from '../src/lib/lineEnding'
import { MAX_BODY_BYTES, MAX_CONTENT_BYTES, isContentTooLarge, isValidLineEnding, isValidTitle, isValidUuid } from './validate'
import { checkDocGrow, readUsage, usageOf, utf8Bytes } from './usage'
import type { V1SharedDoc } from './v1Contract'

// 헤더는 그대로(Authorization 포함), 몸통만 새 JSON 으로 바꿔 아래 핸들러에 넘긴다
function jsonRequest(request: Request, bodyObj: unknown, dropHeaders: string[] = []): Request {
  const headers = new Headers(request.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.delete('Content-Length')
  for (const name of dropHeaders) headers.delete(name)
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(bodyObj ?? {}) })
}

// 안쪽 핸들러에 새 Request 를 넘기되 인증은 다시 하지 않는다 (F-2028 8장)
function innerRequest(request: Request, user: AuthUser, bodyObj: unknown, dropHeaders: string[] = []): Request {
  const inner = jsonRequest(request, bodyObj, dropHeaders)
  rememberUser(inner, user)
  return inner
}

export async function handleCreateDocV1(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const record = body as Record<string, unknown>
  // 금고 필드는 조용히 빼지 않는다 — CLI 사용자가 암호화된 줄 아는 평문 문서가 생긴다 (F-401 X21)
  for (const field of ['id', 'createdAt', 'updatedAt', 'pinnedAt', 'e2eeKey', 'attachmentRefs']) {
    if (field in record) return jsonResponse({ error: 'invalid', field }, 400)
  }

  const { title, content, folderId, lineEnding } = record
  if (lineEnding !== undefined && !isValidLineEnding(lineEnding)) {
    return jsonResponse({ error: 'invalid', field: 'lineEnding' }, 400)
  }
  const resolvedLineEnding =
    lineEnding ?? (typeof content === 'string' && content.includes('\r\n') ? 'crlf' : 'lf')

  const forwardBody: Record<string, unknown> = { title, content, lineEnding: resolvedLineEnding }
  if (folderId !== undefined) forwardBody.folderId = folderId

  return handleCreateDoc(innerRequest(request, user, forwardBody), env, ctx)
}

type DocSummaryBody = { title: string; e2eeKey?: string; attachmentRefs?: string[] }

// 금고 문서는 목록에 남기되 제목은 비우고 표지만 — 봉투·감싼 키는 주지 않는다 (F-401 X18, F-400 10장 Q8)
export async function handleListDocsV1(request: Request, env: Env): Promise<Response> {
  const res = await handleListDocs(request, env)
  if (res.status !== 200) return res
  const list = (await res.json()) as DocSummaryBody[]
  return jsonResponse(
    list.map((doc) => {
      if (doc.e2eeKey === undefined) return doc
      const summary: Partial<DocSummaryBody> = { ...doc }
      delete summary.e2eeKey
      delete summary.attachmentRefs
      return { ...summary, title: '', e2ee: true }
    }),
  )
}

// 금고 문서 본문은 CLI 로 받지 않는다 (F-401 X19)
export async function handleGetDocV1(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.doc.e2ee_key) return errorResponse('e2ee_doc', 403)
  return jsonResponse(rowToDoc(access.doc))
}

// CLI 는 금고 폴더를 만들지 않는다 — 금고 부모 아래는 handleCreateFolder 가 409 (F-401 X22)
export async function handleCreateFolderV1(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)
  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  if ('e2ee' in body) return jsonResponse({ error: 'invalid', field: 'e2ee' }, 400)
  return handleCreateFolder(innerRequest(request, user, body), env)
}

// DO 결과 값에 Worker 가 읽은 행의 나머지 열을 붙인다 (F-308 4장)
function roomDocToV1(row: DocRow, doc: RoomDocState) {
  return rowToDoc({ ...row, title: doc.title, content: doc.content, version: doc.version, updated_at: doc.updatedAt ?? row.updated_at })
}

// 문서의 DocRoom 을 거쳐 쓴다 — 판정 순서는 F-308 4장, DO 호출이 던지면 D1 직접 쓰기(9장)
export async function handleUpdateDocV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { title, content, baseVersion } = body as Record<string, unknown>
  if (title !== undefined && !isValidTitle(title)) {
    return jsonResponse({ error: 'invalid', field: 'title' }, 400)
  }
  if (content !== undefined && typeof content !== 'string') {
    return jsonResponse({ error: 'invalid', field: 'content' }, 400)
  }
  if (typeof content === 'string' && isContentTooLarge(content)) {
    return jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)
  }
  if (!Number.isInteger(baseVersion)) {
    return jsonResponse({ error: 'invalid', field: 'baseVersion' }, 400)
  }

  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  // writeTextInRoom 전에 — 평문이 금고 행에 쓰이지 않게 (F-401 X20)
  if (access.doc.e2ee_key) return errorResponse('e2ee_doc', 403)
  if (access.blocked) return errorResponse('account_blocked', 403) // 쓸 수 있던 사람의 막힘 — 보낸 사람 또는 문서 소유자 (F-2028 4.3)
  if (!roleAtLeast(access.role, 'edit')) return errorResponse('forbidden', 403)
  const row = access.doc

  // 문서 줄바꿈에 맞춘다 — Y.Text 는 LF 만 담는다 (8장)
  const nextContent = typeof content === 'string' ? fromEditorText(toEditorText(content), row.line_ending) : undefined
  if (nextContent !== undefined && isContentTooLarge(nextContent)) {
    return jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)
  }

  // 총량 413 — 5번(줄바꿈 맞춤·1MB) 뒤, 6번(빠른 409) 앞 (F-2025 6.3)
  if (nextContent !== undefined) {
    const deltaBytes = utf8Bytes(nextContent) - utf8Bytes(row.content)
    if (deltaBytes > 0) {
      const ownerUsage = row.owner_id === user.id ? await usageOf(env, user) : await readUsage(env, row.owner_id)
      const quota = checkDocGrow(ownerUsage, deltaBytes)
      if (quota) return jsonResponse(quota, 413)
    }
  }

  // 낡은 baseVersion 은 DO 안에서도 409 다 — 깨우지 않는다. 같은 값은 DO 가 200 으로 끝낸다 (7.3·7.4)
  const differs = (nextContent !== undefined && nextContent !== row.content) || (title !== undefined && title !== row.title)
  if (baseVersion !== row.version && differs) {
    return jsonResponse({ error: 'conflict', doc: rowToDoc(row) }, 409)
  }

  const input: RoomTextWrite = { baseVersion: baseVersion as number, docVersion: row.version }
  if (title !== undefined) input.title = title as string
  if (nextContent !== undefined) input.content = nextContent
  const result = await writeTextInRoom(env, params.id, input)

  if (!result) {
    const forward = { title, content: nextContent, baseVersion }
    return handleUpdateDoc(innerRequest(request, user, forward), env, ctx, params)
  }
  switch (result.type) {
    case 'ok':
      return jsonResponse(roomDocToV1(row, result.doc))
    case 'conflict':
      return jsonResponse({ error: 'conflict', doc: roomDocToV1(row, result.doc) }, 409)
    case 'too_large':
      return jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)
    case 'not_found':
      return errorResponse('not_found', 404)
    case 'unavailable':
      return errorResponse('unavailable', 503)
  }
}

export async function handleCreateAttachmentV1(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const user = await requireUser(request, env)

  const contentLength = request.headers.get('Content-Length')
  const declaredSize = contentLength ? Number(contentLength) : NaN
  if (!Number.isFinite(declaredSize) || declaredSize > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'too_large', limit: MAX_ATTACHMENT_BYTES }, 413)
  }

  const buffer = new Uint8Array(await request.arrayBuffer())
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'too_large', limit: MAX_ATTACHMENT_BYTES }, 413)
  }

  const id = generateAttachmentId()
  const result = await storeAttachment(env, user.id, id, buffer, null, ctx)
  if (!result.ok) {
    if (result.status === 400) return errorResponse(result.error, 400)
    return jsonResponse({ error: result.error, used: result.used, limit: result.limit }, 507)
  }

  const markdown = buildImageLine({
    id: result.row.id,
    ext: result.row.ext,
    alt: '이미지',
    width: Math.min(result.row.width, 800),
    align: 'center',
  })
  return jsonResponse({ ...result.row, markdown }, 201)
}

export async function handleCreateDocLinkV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const res = await handleCreateDocLink(request, env, ctx, params)
  if (res.status !== 200 && res.status !== 201) return res

  const { token } = (await res.json()) as { token: string }
  const url = `${new URL(request.url).origin}/#/p/${token}`
  return jsonResponse({ token, url }, res.status)
}

// 판정 순서는 F-2050.md 3.2 — 2번(금고)이 3번(소유자)보다 앞이지만 금고 비소유자는 1번에서 이미 404 다
export async function handleDeleteDocV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.doc.e2ee_key) return errorResponse('e2ee_doc', 403)
  if (access.role !== 'owner') return errorResponse('forbidden', 403)

  const title = access.doc.title
  await deleteDocRows(env, ctx, params.id, user.id)
  return jsonResponse({ id: params.id, title })
}

// 판정 순서는 F-2050.md 3.3 — 5번에서 목적지 금고 폴더를 403 으로 먼저 끝낸다(/api 의 409 는 여기서 나오지 않는다)
export async function handleMoveDocFolderV1(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { folderId } = body as Record<string, unknown>
  if (folderId !== null && !isValidUuid(folderId)) {
    return jsonResponse({ error: 'invalid', field: 'folderId' }, 400)
  }

  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access) return errorResponse('not_found', 404)
  if (access.doc.e2ee_key) return errorResponse('e2ee_doc', 403)
  if (access.role !== 'owner') return errorResponse('forbidden', 403)
  const existing = access.doc

  if (folderId !== null) {
    const folder = await getOwnedFolder<{ id: string; owner_id: string; e2ee?: number }>(env, folderId as string, user)
    if (!folder) return jsonResponse({ error: 'invalid', field: 'folderId' }, 400)
    if (folder.e2ee === 1) return jsonResponse({ error: 'e2ee_folder' }, 403)
  }

  const updated = await writeMoveDocFolder(env, existing, folderId as string | null)
  const { content: _content, ...summary } = rowToDoc(updated)
  return jsonResponse(summary)
}

// 판정 순서는 F-2050.md 3.4 — 금고가 낀 하위는 전부 403 (결정 9)
export async function handleDeleteFolderV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const existing = await getOwnedFolder<FolderRow>(env, params.id, user)
  if (!existing) return errorResponse('not_found', 404)

  const contents = new URL(request.url).searchParams.get('contents') ?? 'move-up'
  if (contents !== 'move-up' && contents !== 'delete-all') {
    return jsonResponse({ error: 'invalid', field: 'contents' }, 400)
  }

  if (await folderSubtreeHasE2ee(env, user, existing.id)) return jsonResponse({ error: 'e2ee_folder' }, 403)

  const result = await deleteFolderContents(env, ctx, user, existing, contents)
  // 금고가 낀 폴더는 이미 위에서 걸렀으니 여기서는 늘 ok — 방어적으로만 403 에 맞춘다
  if (!result.ok) return jsonResponse({ error: result.error }, 403)
  return jsonResponse({ id: existing.id, contents, parentId: existing.parent_id, docs: result.docs, folders: result.folders })
}

// 출처는 handleGetShared 하나 — 정렬만 다시 한다 (F-2050 3.7)
export async function handleListSharedV1(request: Request, env: Env): Promise<Response> {
  const res = await handleGetShared(request, env)
  if (res.status !== 200) return res
  const list = (await res.json()) as V1SharedDoc[]
  list.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return jsonResponse(list)
}
