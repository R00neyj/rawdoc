// 이미지 첨부 올리기·받기 — 서버 판정을 믿고 클라이언트 Content-Type 은 쓰지 않는다 (specs/features/F-209.md 2.3, 2.4)
// 공유 문서의 첨부 열람 판정은 F-212.md 2.2 로 넓힌다. 사용량 줄·GET /api/usage 확장은 F-2025.md 6.4·6.5
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { isValidToken } from './token'
import { sniffImage, type ImageExt } from './imageSniff'
import { extractAttachmentRefs } from '../src/lib/imageBlock'
import { findPublicLink, folderTreeIds, isDocInLinkSet } from './links'
import { getDocAccess, isDocAttachmentOwner } from './access'
import { DAILY_WRITE_LIMIT, DOC_BYTES_QUOTA, DOC_COUNT_QUOTA, dayUsageStatement, usageOf, writesToday } from './usage'

export const MAX_ATTACHMENT_BYTES = 5_242_880
// 계정당 첨부 저장 한도 300MB (specs/features/F-221.md 2.1)
export const ATTACHMENT_QUOTA_BYTES = 314_572_800
const ID_EXT_RE = /^([0-9a-f]{16})\.(png|jpg|gif|webp)$/

type AttachmentRow = {
  owner_id: string
  id: string
  ext: string
  mime: string
  size: number
  width: number
  height: number
  created_at: number
}


function parseIdExt(idext: string): { id: string; ext: 'png' | 'jpg' | 'gif' | 'webp' } | null {
  const match = ID_EXT_RE.exec(idext)
  if (!match) return null
  return { id: match[1], ext: match[2] as 'png' | 'jpg' | 'gif' | 'webp' }
}

function rowToAttachment(row: AttachmentRow) {
  return { id: row.id, ext: row.ext, mime: row.mime, size: row.size, width: row.width, height: row.height }
}

async function getUsedBytes(env: Env, ownerId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size),0) as used FROM attachments WHERE owner_id = ?')
    .bind(ownerId)
    .first<{ used: number }>()
  return row?.used ?? 0
}

function attachmentResponse(object: R2ObjectBody, mime: string, cacheControl: string): Response {
  const headers = new Headers()
  headers.set('Content-Type', mime)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  headers.set('Content-Disposition', 'inline')
  headers.set('Cache-Control', cacheControl)
  return new Response(object.body, { headers })
}

// 이미지를 저장한다(시그니처 판정·계정 한도 검사·R2 put·D1 insert). id 는 호출하는 쪽이 정한다(F-223 2.2)
export type StoreAttachmentResult =
  | { ok: true; row: { id: string; ext: ImageExt; mime: string; size: number; width: number; height: number } }
  | { ok: false; status: 400; error: 'unsupported' | 'type_mismatch' }
  | { ok: false; status: 507; error: 'quota_exceeded'; used: number; limit: number }

export async function storeAttachment(
  env: Env,
  ownerId: string,
  id: string,
  buffer: Uint8Array,
  expectedExt: ImageExt | null,
): Promise<StoreAttachmentResult> {
  const sniffed = sniffImage(buffer)
  if (!sniffed) return { ok: false, status: 400, error: 'unsupported' }
  if (expectedExt && sniffed.ext !== expectedExt) return { ok: false, status: 400, error: 'type_mismatch' }

  const used = await getUsedBytes(env, ownerId)
  if (used + buffer.length > ATTACHMENT_QUOTA_BYTES) {
    return { ok: false, status: 507, error: 'quota_exceeded', used, limit: ATTACHMENT_QUOTA_BYTES }
  }

  const key = `att/${ownerId}/${id}.${sniffed.ext}`
  await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: sniffed.mime } })

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)',
    ).bind(ownerId, id, sniffed.ext, sniffed.mime, buffer.length, sniffed.width, sniffed.height, now),
    dayUsageStatement(env.DB, ownerId, now),
  ])

  return {
    ok: true,
    row: { id, ext: sniffed.ext, mime: sniffed.mime, size: buffer.length, width: sniffed.width, height: sniffed.height },
  }
}

// 첨부 id(16 hex) — 서버가 만들 때 쓴다(F-223 2.2)
export function generateAttachmentId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function handleUploadAttachment(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsedName = parseIdExt(params.idext)
  if (!parsedName) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const contentLength = request.headers.get('Content-Length')
  const declaredSize = contentLength ? Number(contentLength) : NaN
  if (!Number.isFinite(declaredSize) || declaredSize > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'too_large', limit: MAX_ATTACHMENT_BYTES }, 413)
  }

  const existing = await env.DB.prepare('SELECT * FROM attachments WHERE owner_id = ? AND id = ?')
    .bind(user.id, id)
    .first<AttachmentRow>()
  if (existing) return jsonResponse(rowToAttachment(existing), 200)

  const buffer = new Uint8Array(await request.arrayBuffer())
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'too_large', limit: MAX_ATTACHMENT_BYTES }, 413)
  }

  const result = await storeAttachment(env, user.id, id, buffer, ext)
  if (!result.ok) {
    if (result.status === 400) return errorResponse(result.error, 400)
    return jsonResponse({ error: result.error, used: result.used, limit: result.limit }, 507)
  }

  return jsonResponse(result.row, 201)
}

export async function handleGetUsage(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const [used, usage] = await Promise.all([getUsedBytes(env, user.id), usageOf(env, user)])
  return jsonResponse({
    used,
    limit: ATTACHMENT_QUOTA_BYTES,
    docs: {
      bytes: usage.contentBytes,
      bytesLimit: DOC_BYTES_QUOTA,
      count: usage.docCount,
      countLimit: DOC_COUNT_QUOTA,
    },
    writes: { today: writesToday(usage, Date.now()), limit: DAILY_WRITE_LIMIT },
  })
}

export async function handleGetAttachment(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsedName = parseIdExt(params.idext)
  if (!parsedName) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const own = await env.DB.prepare('SELECT * FROM attachments WHERE owner_id = ? AND id = ?')
    .bind(user.id, id)
    .first<AttachmentRow>()
  if (own) {
    if (own.ext !== ext) return errorResponse('not_found', 404)
    const object = await env.BUCKET.get(`att/${user.id}/${id}.${ext}`)
    if (!object) return errorResponse('not_found', 404)
    return attachmentResponse(object, own.mime, 'private, max-age=31536000, immutable')
  }

  // 내 것이 아니면 문서 조회 권한 + 그 문서 원문의 참조가 있어야 한다 (F-212 2.2, ?doc= 로 문서를 지정)
  const docId = new URL(request.url).searchParams.get('doc')
  if (!docId) return errorResponse('not_found', 404)
  const access = await getDocAccess<{ id: string; owner_id: string; folder_id: string | null; content: string }>(
    env,
    docId,
    user,
    'id, owner_id, folder_id, content',
  )
  if (!access) return errorResponse('not_found', 404)
  if (!extractAttachmentRefs(access.doc.content).has(id)) return errorResponse('not_found', 404)

  const { results: candidates } = await env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND ext = ?')
    .bind(id, ext)
    .all<AttachmentRow>()
  let row: AttachmentRow | null = null
  for (const candidate of candidates) {
    if (await isDocAttachmentOwner(env, access.doc, candidate.owner_id)) {
      row = candidate
      break
    }
  }
  if (!row) return errorResponse('not_found', 404)

  const object = await env.BUCKET.get(`att/${row.owner_id}/${id}.${ext}`)
  if (!object) return errorResponse('not_found', 404)

  return attachmentResponse(object, row.mime, 'private, max-age=31536000, immutable')
}

export async function handlePublicGetAttachment(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const parsedName = parseIdExt(params.idext)
  if (!parsedName || !isValidToken(params.token)) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'doc') return errorResponse('not_found', 404)

  const doc = await env.DB.prepare('SELECT id, owner_id, content, folder_id FROM docs WHERE id = ?')
    .bind(link.target_id)
    .first<{ id: string; owner_id: string; content: string; folder_id: string | null }>()
  if (!doc) return errorResponse('not_found', 404)
  if (!extractAttachmentRefs(doc.content).has(id)) return errorResponse('not_found', 404)

  const { results: candidates } = await env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND ext = ?')
    .bind(id, ext)
    .all<AttachmentRow>()
  let row: AttachmentRow | null = null
  for (const candidate of candidates) {
    if (await isDocAttachmentOwner(env, doc, candidate.owner_id)) {
      row = candidate
      break
    }
  }
  if (!row) return errorResponse('not_found', 404)

  const object = await env.BUCKET.get(`att/${row.owner_id}/${id}.${ext}`)
  if (!object) return errorResponse('not_found', 404)

  return attachmentResponse(object, row.mime, 'private, max-age=300')
}

// 위키링크 묶음 문서 이미지 — 검사 순서는 handlePublicGetFolderAttachment 와 같다 (F-252 2.6)
export async function handlePublicGetDocSetAttachment(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const parsedName = parseIdExt(params.idext)
  if (!parsedName || !isValidToken(params.token)) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'doc') return errorResponse('not_found', 404)

  if (!(await isDocInLinkSet(env, params.token, link.target_id, params.docId))) return errorResponse('not_found', 404)

  const doc = await env.DB.prepare('SELECT id, owner_id, content, folder_id FROM docs WHERE id = ?')
    .bind(params.docId)
    .first<{ id: string; owner_id: string; content: string; folder_id: string | null }>()
  if (!doc) return errorResponse('not_found', 404)
  if (!extractAttachmentRefs(doc.content).has(id)) return errorResponse('not_found', 404)

  const { results: candidates } = await env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND ext = ?')
    .bind(id, ext)
    .all<AttachmentRow>()
  let row: AttachmentRow | null = null
  for (const candidate of candidates) {
    if (await isDocAttachmentOwner(env, doc, candidate.owner_id)) {
      row = candidate
      break
    }
  }
  if (!row) return errorResponse('not_found', 404)

  const object = await env.BUCKET.get(`att/${row.owner_id}/${id}.${ext}`)
  if (!object) return errorResponse('not_found', 404)

  return attachmentResponse(object, row.mime, 'private, max-age=300')
}

export async function handlePublicGetFolderAttachment(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const parsedName = parseIdExt(params.idext)
  if (!parsedName || !isValidToken(params.token)) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'folder') return errorResponse('not_found', 404)

  const doc = await env.DB.prepare('SELECT id, owner_id, content, folder_id FROM docs WHERE id = ? AND owner_id = ?')
    .bind(params.docId, link.owner_id)
    .first<{ id: string; owner_id: string; content: string; folder_id: string | null }>()
  if (!doc) return errorResponse('not_found', 404)

  const treeIds = await folderTreeIds(env, link.target_id, link.owner_id)
  if (!doc.folder_id || !treeIds.includes(doc.folder_id)) return errorResponse('not_found', 404)
  if (!extractAttachmentRefs(doc.content).has(id)) return errorResponse('not_found', 404)

  const { results: candidates } = await env.DB.prepare('SELECT * FROM attachments WHERE id = ? AND ext = ?')
    .bind(id, ext)
    .all<AttachmentRow>()
  let row: AttachmentRow | null = null
  for (const candidate of candidates) {
    if (await isDocAttachmentOwner(env, doc, candidate.owner_id)) {
      row = candidate
      break
    }
  }
  if (!row) return errorResponse('not_found', 404)

  const object = await env.BUCKET.get(`att/${row.owner_id}/${id}.${ext}`)
  if (!object) return errorResponse('not_found', 404)

  return attachmentResponse(object, row.mime, 'private, max-age=300')
}
