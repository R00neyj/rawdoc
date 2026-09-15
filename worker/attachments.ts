// 이미지 첨부 올리기·받기 — 서버 판정을 믿고 클라이언트 Content-Type 은 쓰지 않는다 (specs/features/F-209.md 2.3, 2.4)
// 공유 문서의 첨부 열람 판정은 F-212.md 2.2 로 넓힌다
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { isValidToken } from './token'
import { sniffImage } from './imageSniff'
import { extractAttachmentRefs } from '../src/lib/imageBlock'
import { folderTreeIds } from './links'
import { getDocAccess, isDocAttachmentOwner } from './access'

const MAX_ATTACHMENT_BYTES = 5_242_880
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

function attachmentResponse(object: R2ObjectBody, mime: string, cacheControl: string): Response {
  const headers = new Headers()
  headers.set('Content-Type', mime)
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  headers.set('Content-Disposition', 'inline')
  headers.set('Cache-Control', cacheControl)
  return new Response(object.body, { headers })
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

  const sniffed = sniffImage(buffer)
  if (!sniffed) return errorResponse('unsupported', 400)
  if (sniffed.ext !== ext) return errorResponse('type_mismatch', 400)

  const key = `att/${user.id}/${id}.${ext}`
  await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: sniffed.mime } })

  const now = Date.now()
  await env.DB.prepare(
    'INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(user.id, id, ext, sniffed.mime, buffer.length, sniffed.width, sniffed.height, now)
    .run()

  return jsonResponse(
    { id, ext, mime: sniffed.mime, size: buffer.length, width: sniffed.width, height: sniffed.height },
    201,
  )
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

  const link = await env.DB.prepare('SELECT target_type, target_id FROM share_links WHERE token = ? AND revoked_at IS NULL')
    .bind(params.token)
    .first<{ target_type: string; target_id: string }>()
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

export async function handlePublicGetFolderAttachment(
  _request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const parsedName = parseIdExt(params.idext)
  if (!parsedName || !isValidToken(params.token)) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const link = await env.DB.prepare('SELECT target_type, target_id, owner_id FROM share_links WHERE token = ? AND revoked_at IS NULL')
    .bind(params.token)
    .first<{ target_type: string; target_id: string; owner_id: string }>()
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
