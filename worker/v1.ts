// 자동 업로드 API '/v1' 전용 핸들러 — 몸통 보정·응답 모양만 여기서 하고, 나머지는 기존 /api 핸들러를 그대로 부른다 (specs/features/F-223.md)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { badBody, handleCreateDoc, handleUpdateDoc, readJsonLimited } from './docs'
import { handleCreateDocLink } from './links'
import { MAX_ATTACHMENT_BYTES, generateAttachmentId, storeAttachment } from './attachments'
import { buildImageBlock } from '../src/lib/imageBlock'
import { MAX_BODY_BYTES, isValidLineEnding } from './validate'

// 헤더는 그대로(Authorization 포함), 몸통만 새 JSON 으로 바꿔 아래 핸들러에 넘긴다
function jsonRequest(request: Request, bodyObj: unknown, dropHeaders: string[] = []): Request {
  const headers = new Headers(request.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.delete('Content-Length')
  for (const name of dropHeaders) headers.delete(name)
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify(bodyObj ?? {}) })
}

export async function handleCreateDocV1(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env)
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

  return handleCreateDoc(jsonRequest(request, forwardBody), env)
}

// 잠금이 살아 있으면 항상 423 — 토큰 요청에는 잠금 세션이 없다(X-Lock-Session 을 지운다) (F-223 2.2)
export async function handleUpdateDocV1(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_BODY_BYTES)
  if (!parsed.ok) return badBody(parsed)

  return handleUpdateDoc(jsonRequest(request, parsed.data, ['X-Lock-Session']), env, ctx, params)
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
