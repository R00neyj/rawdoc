// 자동 업로드 API '/v1' 전용 핸들러 — 몸통 보정·응답 모양만 여기서 하고, 나머지는 기존 /api 핸들러를 그대로 부른다 (specs/features/F-223.md)
import { errorResponse, jsonResponse } from './http'
import { rememberUser, requireUser, type AuthUser } from './auth'
import { getDocAccess, roleAtLeast } from './access'
import { getActiveLock } from './locks'
import { badBody, handleCreateDoc, handleUpdateDoc, readJsonLimited } from './docs'
import { rowToDoc } from './docWrite'
import type { DocRow } from './docWrite'
import { writeTextInRoom } from './docRoomRpc'
import type { RoomDocState, RoomTextWrite } from './docRoomCore'
import { handleCreateDocLink } from './links'
import { MAX_ATTACHMENT_BYTES, generateAttachmentId, storeAttachment } from './attachments'
import { buildImageBlock } from '../src/lib/imageBlock'
import { fromEditorText, toEditorText } from '../src/lib/lineEnding'
import { MAX_BODY_BYTES, MAX_CONTENT_BYTES, isContentTooLarge, isValidLineEnding, isValidTitle } from './validate'
import { checkDocGrow, readUsage, usageOf, utf8Bytes } from './usage'

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

export async function handleCreateDocV1(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const record = body as Record<string, unknown>
  for (const field of ['id', 'createdAt', 'updatedAt', 'pinnedAt']) {
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

  return handleCreateDoc(innerRequest(request, user, forwardBody), env)
}

// DO 결과 값에 Worker 가 읽은 행의 나머지 열을 붙인다 (F-308 4장)
function roomDocToV1(row: DocRow, doc: RoomDocState) {
  return rowToDoc({ ...row, title: doc.title, content: doc.content, version: doc.version, updated_at: doc.updatedAt ?? row.updated_at })
}

// 문서의 DocRoom 을 거쳐 쓴다 — 판정 순서는 F-308 4장, DO 호출이 던지면 D1 직접 쓰기(9장), D1 잠금 423 은 F-309 까지
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
  if (access.blocked) return errorResponse('account_blocked', 403) // 쓸 수 있던 사람의 막힘 — 보낸 사람 또는 문서 소유자 (F-2028 4.3)
  if (!roleAtLeast(access.role, 'edit')) return errorResponse('forbidden', 403)
  const row = access.doc

  const activeLock = await getActiveLock(env, params.id)
  if (activeLock) {
    return jsonResponse({ error: 'locked', email: activeLock.email, expiresAt: activeLock.expires_at }, 423)
  }

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
    return handleUpdateDoc(innerRequest(request, user, forward, ['X-Lock-Session']), env, ctx, params)
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

export async function handleCreateAttachmentV1(request: Request, env: Env): Promise<Response> {
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
  const result = await storeAttachment(env, user.id, id, buffer, null)
  if (!result.ok) {
    if (result.status === 400) return errorResponse(result.error, 400)
    return jsonResponse({ error: result.error, used: result.used, limit: result.limit }, 507)
  }

  const markdown = buildImageBlock({
    id: result.row.id,
    ext: result.row.ext,
    alt: '이미지',
    width: Math.min(result.row.width, 800),
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
