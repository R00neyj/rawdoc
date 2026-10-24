// 이미지 첨부 올리기·받기 — 서버 판정을 믿고 클라이언트 Content-Type 은 쓰지 않는다 (specs/features/F-209.md 2.3, 2.4)
// 공유 문서의 첨부 열람 판정은 F-212.md 2.2 로 넓힌다. 사용량 줄·GET /api/usage 확장은 F-2025.md 6.4·6.5
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import type { AuthUser } from './auth'
import { isValidToken } from './token'
import { sniffImage, MAX_PIXELS, IMAGE_MIME, type ImageExt } from './imageSniff'
import { extractAttachmentRefs } from '../src/lib/image/imageBlock'
import { isDocAttachmentRef, isGithubImageInUse } from './githubImages'
import { findPublicLink, folderTreeIds, isDocInLinkSet } from './links'
import { getDocAccess } from './access'
import { DAILY_WRITE_LIMIT, DOC_BYTES_QUOTA, DOC_COUNT_QUOTA, dayUsageStatement, quotaPushInBackground, usageOf, writesToday } from './usage'
import { E2EE_ATTACHMENT_OVERHEAD, E2EE_FORMAT_VERSION, E2EE_SERVER_MAX_ATTACHMENT_BYTES } from '../src/lib/vault/e2eeLimits'

export const MAX_ATTACHMENT_BYTES = E2EE_SERVER_MAX_ATTACHMENT_BYTES
// 계정당 첨부 저장 한도 300MB (specs/features/F-221.md 2.1)
export const ATTACHMENT_QUOTA_BYTES = 314_572_800
const ID_EXT_RE = /^([0-9a-f]{16})\.(png|jpg|gif|webp)$/
// w·h 쿼리 — 10진 정수 1 이상, 앞에 0 없음 (F-402.md 3.1)
const DIMENSION_RE = /^[1-9][0-9]{0,7}$/

export type AttachmentRow = {
  owner_id: string
  id: string
  ext: string
  mime: string
  size: number
  width: number
  height: number
  created_at: number
  e2ee?: number
}


export function parseIdExt(idext: string): { id: string; ext: 'png' | 'jpg' | 'gif' | 'webp' } | null {
  const match = ID_EXT_RE.exec(idext)
  if (!match) return null
  return { id: match[1], ext: match[2] as 'png' | 'jpg' | 'gif' | 'webp' }
}

function rowToAttachment(row: AttachmentRow) {
  const base = { id: row.id, ext: row.ext, mime: row.mime, size: row.size, width: row.width, height: row.height }
  return row.e2ee === 1 ? { ...base, e2ee: true as const } : base
}

function invalidField(field: string): Response {
  return jsonResponse({ error: 'invalid', field }, 400)
}

// 문서 소유자의 평문 첨부, 또는 올린 사람이 그 소유자의 문서에 직접 넣어 둔 첨부(attachment_docs)만 — 금고 첨부는 늘 뺀다 (F-4012 3.1)
export async function findDocAttachment(
  env: Env,
  doc: { id: string; owner_id: string; content: string },
  id: string,
  ext: string,
): Promise<AttachmentRow | null> {
  if (!(await isDocAttachmentRef(env, doc, id))) return null
  return env.DB.prepare(
    `SELECT a.* FROM attachments a WHERE a.id = ?1 AND a.ext = ?2 AND a.e2ee = 0 AND (
       a.owner_id = ?3 OR EXISTS (SELECT 1 FROM attachment_docs ad WHERE ad.owner_id = a.owner_id AND ad.attachment_id = a.id AND ad.doc_owner_id = ?3)
     ) ORDER BY (a.owner_id = ?3) DESC LIMIT 1`,
  )
    .bind(id, ext, doc.owner_id)
    .first<AttachmentRow>()
}

// 공동 편집자(edit, 막힘 아님)가 남의 문서에 올릴 때만 연결 기록 문장을 낸다 — 그 외에는 null 이고 올리기 응답은 같다 (F-4012 3.1)
export async function attachmentLinkStatement(env: Env, user: AuthUser, docId: string | null, attachmentId: string): Promise<D1PreparedStatement | null> {
  if (!docId) return null
  const access = await getDocAccess<{ id: string; owner_id: string; folder_id: string | null }>(env, docId, user, 'id, owner_id, folder_id')
  if (!access || access.role !== 'edit') return null
  return env.DB.prepare(
    'INSERT INTO attachment_docs (owner_id, attachment_id, doc_owner_id, doc_id, created_at) SELECT ?1,?2,?3,?4,?5 WHERE EXISTS (SELECT 1 FROM attachments WHERE owner_id = ?1 AND id = ?2) ON CONFLICT DO NOTHING',
  ).bind(user.id, attachmentId, access.doc.owner_id, access.doc.id, Date.now())
}

async function getUsedBytes(env: Env, ownerId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size),0) as used FROM attachments WHERE owner_id = ?')
    .bind(ownerId)
    .first<{ used: number }>()
  return row?.used ?? 0
}

// 넣기 문장 안의 한도 재판정 — ?1 owner, ?5 size, ?9 한도 (F-4014 3.3)
const WITHIN_QUOTA_SQL = '(SELECT COALESCE(SUM(size),0) FROM attachments WHERE owner_id = ?1) + ?5 <= ?9'

// 넣기에 진 업로드의 R2 키를 지운다 — 같은 id 행이 있으면(재전송이 이김) 그 객체라 둔다. 다시 읽은 사용량을 돌려준다
async function rollbackLostUpload(env: Env, ownerId: string, id: string, key: string): Promise<number> {
  const winner = await env.DB.prepare('SELECT 1 as hit FROM attachments WHERE owner_id = ? AND id = ?').bind(ownerId, id).first<{ hit: number }>()
  if (!winner) await env.BUCKET.delete(key)
  return getUsedBytes(env, ownerId)
}

export function attachmentResponse(object: R2ObjectBody, mime: string, cacheControl: string): Response {
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
  ctx?: ExecutionContext,
  linkStatements: D1PreparedStatement[] = [],
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
  const [inserted] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at) SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE ${WITHIN_QUOTA_SQL}`,
    ).bind(ownerId, id, sniffed.ext, sniffed.mime, buffer.length, sniffed.width, sniffed.height, now, ATTACHMENT_QUOTA_BYTES),
    ...linkStatements,
    dayUsageStatement(env.DB, ownerId, now),
  ])
  if (inserted.meta.changes === 0) {
    const raced = await rollbackLostUpload(env, ownerId, id, key)
    return { ok: false, status: 507, error: 'quota_exceeded', used: raced, limit: ATTACHMENT_QUOTA_BYTES }
  }
  await quotaPushInBackground(env, ctx, ownerId, { images: { used: used + buffer.length, limit: ATTACHMENT_QUOTA_BYTES } }, now)

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
  ctx: ExecutionContext,
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

  // 금고 올리기 — ?e2ee=1&w=&h=, 없으면 평문 경로(나머지 쿼리는 보지 않는다) (F-402.md 3.1)
  const url = new URL(request.url)
  const e2eeParam = url.searchParams.get('e2ee')
  const isE2ee = e2eeParam !== null
  if (isE2ee && e2eeParam !== '1') return invalidField('e2ee')

  let width = 0
  let height = 0
  if (isE2ee) {
    const wRaw = url.searchParams.get('w')
    if (!wRaw || !DIMENSION_RE.test(wRaw)) return invalidField('w')
    const hRaw = url.searchParams.get('h')
    if (!hRaw || !DIMENSION_RE.test(hRaw)) return invalidField('h')
    width = Number(wRaw)
    height = Number(hRaw)
    if (width * height > MAX_PIXELS) return jsonResponse({ error: 'unsupported' }, 400)
  }

  const docParam = url.searchParams.get('doc')
  const existing = await env.DB.prepare('SELECT * FROM attachments WHERE owner_id = ? AND id = ?')
    .bind(user.id, id)
    .first<AttachmentRow>()
  if (existing) {
    if ((existing.e2ee === 1) !== isE2ee) return jsonResponse({ error: 'e2ee_mismatch' }, 409)
    if (!isE2ee) {
      const linkStatement = await attachmentLinkStatement(env, user, docParam, id)
      if (linkStatement) await linkStatement.run()
    }
    return jsonResponse(rowToAttachment(existing), 200)
  }

  const buffer = new Uint8Array(await request.arrayBuffer())
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'too_large', limit: MAX_ATTACHMENT_BYTES }, 413)
  }

  if (isE2ee) {
    if (buffer.length < E2EE_ATTACHMENT_OVERHEAD || buffer[0] !== E2EE_FORMAT_VERSION) {
      return invalidField('body')
    }
    const used = await getUsedBytes(env, user.id)
    if (used + buffer.length > ATTACHMENT_QUOTA_BYTES) {
      return jsonResponse({ error: 'quota_exceeded', used, limit: ATTACHMENT_QUOTA_BYTES }, 507)
    }
    const mime = IMAGE_MIME[ext]
    const key = `att/${user.id}/${id}.${ext}`
    await env.BUCKET.put(key, buffer, { httpMetadata: { contentType: 'application/octet-stream' } })
    const now = Date.now()
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO attachments (owner_id, id, ext, mime, size, width, height, created_at, e2ee) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,1 WHERE ${WITHIN_QUOTA_SQL}`,
      ).bind(user.id, id, ext, mime, buffer.length, width, height, now, ATTACHMENT_QUOTA_BYTES),
      dayUsageStatement(env.DB, user.id, now),
    ])
    if (inserted.meta.changes === 0) {
      const raced = await rollbackLostUpload(env, user.id, id, key)
      return jsonResponse({ error: 'quota_exceeded', used: raced, limit: ATTACHMENT_QUOTA_BYTES }, 507)
    }
    await quotaPushInBackground(env, ctx, user.id, { images: { used: used + buffer.length, limit: ATTACHMENT_QUOTA_BYTES } }, now)
    return jsonResponse({ id, ext, mime, size: buffer.length, width, height, e2ee: true as const }, 201)
  }

  const linkStatement = await attachmentLinkStatement(env, user, docParam, id)
  const result = await storeAttachment(env, user.id, id, buffer, ext, ctx, linkStatement ? [linkStatement] : [])
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
    const mime = own.e2ee === 1 ? 'application/octet-stream' : own.mime
    return attachmentResponse(object, mime, 'private, max-age=31536000, immutable')
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
  const row = await findDocAttachment(env, access.doc, id, ext)
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

  // 링크 주인의 문서만 (리뷰 W2)
  const doc = await env.DB.prepare('SELECT id, owner_id, content, folder_id FROM docs WHERE id = ? AND owner_id = ? AND e2ee_key IS NULL AND deleted_at IS NULL')
    .bind(link.target_id, link.owner_id)
    .first<{ id: string; owner_id: string; content: string; folder_id: string | null }>()
  if (!doc) return errorResponse('not_found', 404)
  const row = await findDocAttachment(env, doc, id, ext)
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

  const doc = await env.DB.prepare('SELECT id, owner_id, content, folder_id FROM docs WHERE id = ? AND owner_id = ? AND e2ee_key IS NULL AND deleted_at IS NULL')
    .bind(params.docId, link.owner_id)
    .first<{ id: string; owner_id: string; content: string; folder_id: string | null }>()
  if (!doc) return errorResponse('not_found', 404)
  const row = await findDocAttachment(env, doc, id, ext)
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

  const doc = await env.DB.prepare('SELECT id, owner_id, content, folder_id FROM docs WHERE id = ? AND owner_id = ? AND e2ee_key IS NULL AND deleted_at IS NULL')
    .bind(params.docId, link.owner_id)
    .first<{ id: string; owner_id: string; content: string; folder_id: string | null }>()
  if (!doc) return errorResponse('not_found', 404)

  const treeIds = await folderTreeIds(env, link.target_id, link.owner_id)
  if (!doc.folder_id || !treeIds.includes(doc.folder_id)) return errorResponse('not_found', 404)
  const row = await findDocAttachment(env, doc, id, ext)
  if (!row) return errorResponse('not_found', 404)

  const object = await env.BUCKET.get(`att/${row.owner_id}/${id}.${ext}`)
  if (!object) return errorResponse('not_found', 404)

  return attachmentResponse(object, row.mime, 'private, max-age=300')
}

// "쓰는 중" — 내 문서(편집 초대 준 사람 문서 포함) 본문 참조, 내 금고 attachment_refs, 본문 경로의 대응 (F-402.md 3.3, F-3017 3.2)
async function isAttachmentInUse(env: Env, user: AuthUser, id: string): Promise<boolean> {
  const { results: granters } = await env.DB.prepare(
    "SELECT DISTINCT owner_id FROM grants WHERE grantee_email = ? AND role = 'edit'",
  )
    .bind(user.email)
    .all<{ owner_id: string }>()
  const ownerIds = [user.id, ...granters.map((g) => g.owner_id)]
  const needle = `attachments/${id}.`
  const { results: candidateDocs } = await env.DB.prepare(
    'SELECT content FROM docs WHERE e2ee_key IS NULL AND owner_id IN (SELECT value FROM json_each(?)) AND instr(content, ?) > 0',
  )
    .bind(JSON.stringify(ownerIds), needle)
    .all<{ content: string }>()
  for (const doc of candidateDocs) {
    if (extractAttachmentRefs(doc.content).has(id)) return true
  }

  const refHit = await env.DB.prepare(
    'SELECT 1 as hit FROM docs, json_each(docs.attachment_refs) refs WHERE docs.owner_id = ? AND docs.e2ee_key IS NOT NULL AND refs.value = ? LIMIT 1',
  )
    .bind(user.id, id)
    .first<{ hit: number }>()
  if (refHit !== null) return true
  return isGithubImageInUse(env, user.id, id)
}

export async function handleDeleteAttachment(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  params: Record<string, string>,
): Promise<Response> {
  const user = await requireUser(request, env)
  const parsedName = parseIdExt(params.idext)
  if (!parsedName) return errorResponse('not_found', 404)
  const { id, ext } = parsedName

  const row = await env.DB.prepare('SELECT * FROM attachments WHERE owner_id = ? AND id = ?')
    .bind(user.id, id)
    .first<AttachmentRow>()
  if (!row || row.ext !== ext) return errorResponse('not_found', 404)

  if (await isAttachmentInUse(env, user, id)) {
    return jsonResponse({ error: 'in_use' }, 409)
  }

  try {
    await env.BUCKET.delete(`att/${user.id}/${id}.${ext}`)
  } catch (err) {
    console.error(err)
    return errorResponse('internal', 500)
  }

  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attachments WHERE owner_id = ? AND id = ?').bind(user.id, id),
    env.DB.prepare('DELETE FROM attachment_docs WHERE owner_id = ? AND attachment_id = ?').bind(user.id, id),
    env.DB.prepare('DELETE FROM github_images WHERE owner_id = ? AND attachment_id = ?').bind(user.id, id),
    dayUsageStatement(env.DB, user.id, now),
  ])

  return new Response(null, { status: 204 })
}
