// 금고로 옮기기·금고에서 빼기 — PUT /api/docs/:id/e2ee (specs/features/F-401.md 3.4)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { getDocAccess, getOwnedFolder } from './access'
import { badBody, checkTitleContent, fieldErrorResponse, hasE2eeKeys, readJsonLimited } from './docs'
import { rowToDoc } from './docWrite'
import type { DocRow } from './docWrite'
import { e2eeCommentDeleteStatements } from './commentRows'
import { checkDocGrow, docUsageStatements, usageOf, utf8Bytes } from './usage'
import { MAX_BODY_BYTES, isValidAttachmentRefs, isValidWrappedKey } from './validate'

const MOVE_ROW_SQL =
  'UPDATE docs SET title = ?, content = ?, e2ee_key = ?, attachment_refs = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?'
// 3·4·5 는 1번이 이번 요청의 감싼 키를 실제로 썼을 때만 — 새 키는 무작위라 이 요청이 쓴 행만 맞는다
const WROTE_KEY = 'EXISTS (SELECT 1 FROM docs WHERE id = ? AND e2ee_key = ?)'
const REVOKE_LINKS_SQL = `UPDATE share_links SET revoked_at = ? WHERE target_type = 'doc' AND target_id = ? AND revoked_at IS NULL AND ${WROTE_KEY}`
const DROP_SET_ROWS_SQL = `DELETE FROM share_link_docs WHERE doc_id = ? AND ${WROTE_KEY}`
const DROP_GRANTS_SQL = `DELETE FROM grants WHERE target_type = 'doc' AND target_id = ? AND ${WROTE_KEY}`

export type SetDocE2eeInput = {
  docId: string
  ownerId: string
  title: string
  content: string
  e2eeKey: string | null
  attachmentRefs: string[] | null
  baseVersion: number
  now: number
  deltaBytes: number
}

// batch 순서가 계약이다 — 사용량 줄의 changes() 는 바로 앞 문장(1번)을 본다 (F-2025 5.1)
export function setDocE2eeStatements(db: D1Database, p: SetDocE2eeInput): D1PreparedStatement[] {
  const refs = p.e2eeKey === null ? null : JSON.stringify(p.attachmentRefs ?? [])
  const statements = [
    db.prepare(MOVE_ROW_SQL).bind(p.title, p.content, p.e2eeKey, refs, p.baseVersion + 1, p.now, p.docId, p.ownerId, p.baseVersion),
    ...docUsageStatements(db, { actorId: p.ownerId, ownerId: p.ownerId, now: p.now, deltaBytes: p.deltaBytes, deltaDocs: 0 }),
  ]
  if (p.e2eeKey === null) return statements
  return [
    ...statements,
    db.prepare(REVOKE_LINKS_SQL).bind(p.now, p.docId, p.docId, p.e2eeKey),
    db.prepare(DROP_SET_ROWS_SQL).bind(p.docId, p.docId, p.e2eeKey),
    db.prepare(DROP_GRANTS_SQL).bind(p.docId, p.docId, p.e2eeKey),
    // 6~8 댓글 복사본·알림과 그 바이트 — 같은 WROTE_KEY 조건 (F-502 8.3)
    ...e2eeCommentDeleteStatements(db, p.ownerId, p.docId, p.e2eeKey),
  ]
}

type PurgeStub = { purgeRoom(): Promise<void> }

// 응답 전에 DO 저장소를 비운다, 최대 2번. 바인딩이 없으면 성공으로 친다 (11장 Q4)
async function purgeBeforeResponse(env: Env, docId: string): Promise<boolean> {
  const ns = (env as unknown as { DOC_ROOM?: { getByName(name: string): unknown } }).DOC_ROOM
  if (!ns) return true
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await (ns.getByName(docId) as PurgeStub).purgeRoom()
      return true
    } catch {
      continue
    }
  }
  console.error('e2ee_purge_failed', docId)
  return false
}

function invalid(field: string): Response {
  return jsonResponse({ error: 'invalid', field }, 400)
}

export async function handleSetDocE2ee(
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
  const { e2eeKey, title, content, attachmentRefs, baseVersion } = body as Record<string, unknown>

  // 판정 순서는 3.4 표의 위에서 아래 — 모두 batch 전이라 하루 카운터가 오르지 않는다
  if (e2eeKey !== null && !isValidWrappedKey(e2eeKey)) return invalid('e2eeKey')
  const moving = e2eeKey !== null
  const fieldError = checkTitleContent(title, content, moving, true)
  if (fieldError) return fieldErrorResponse(fieldError)
  if (moving ? !isValidAttachmentRefs(attachmentRefs) : attachmentRefs !== null && attachmentRefs !== undefined) {
    return invalid('attachmentRefs')
  }
  if (!Number.isInteger(baseVersion)) return invalid('baseVersion')

  const access = await getDocAccess<DocRow>(env, params.id, user)
  if (!access || access.doc.owner_id !== user.id) return errorResponse('not_found', 404)
  if (access.blocked) return errorResponse('account_blocked', 403)
  const existing = access.doc

  const rowIsE2ee = typeof existing.e2ee_key === 'string'
  if (moving && rowIsE2ee) return jsonResponse({ error: 'e2ee_doc' }, 409)
  if (!moving && !rowIsE2ee) return jsonResponse({ error: 'not_e2ee' }, 409)
  if (!moving && existing.folder_id) {
    const folder = await getOwnedFolder<{ id: string; owner_id: string; e2ee?: number }>(env, existing.folder_id, user)
    if (folder?.e2ee === 1) return jsonResponse({ error: 'e2ee_folder' }, 409)
  }
  if (moving && !(await hasE2eeKeys(env, user.id))) return jsonResponse({ error: 'no_vault' }, 409)
  if (existing.version !== baseVersion) return jsonResponse({ error: 'conflict', doc: rowToDoc(existing) }, 409)

  const deltaBytes = utf8Bytes(content as string) - utf8Bytes(existing.content)
  const quota = checkDocGrow(await usageOf(env, user), deltaBytes)
  if (quota) return jsonResponse(quota, 413)

  const now = Date.now()
  const input: SetDocE2eeInput = {
    docId: params.id,
    ownerId: user.id,
    title: title as string,
    content: content as string,
    e2eeKey: moving ? (e2eeKey as string) : null,
    attachmentRefs: moving ? (attachmentRefs as string[]) : null,
    baseVersion: baseVersion as number,
    now,
    deltaBytes,
  }
  const [written] = await env.DB.batch(setDocE2eeStatements(env.DB, input))
  if (written.meta.changes !== 1) {
    const latest = await env.DB.prepare('SELECT * FROM docs WHERE id = ? AND owner_id = ?').bind(params.id, user.id).first<DocRow>()
    if (!latest) return errorResponse('not_found', 404)
    return jsonResponse({ error: 'conflict', doc: rowToDoc(latest) }, 409)
  }

  // D1 batch 는 이미 커밋됐다 — 지우기가 실패해도 되돌리지 않고 purged: false 로 알린다
  const purged = await purgeBeforeResponse(env, params.id)
  const row: DocRow = {
    ...existing,
    title: input.title,
    content: input.content,
    e2ee_key: input.e2eeKey,
    attachment_refs: input.e2eeKey === null ? null : JSON.stringify(input.attachmentRefs ?? []),
    version: input.baseVersion + 1,
    updated_at: now,
  }
  return jsonResponse({ ...rowToDoc(row), purged })
}
