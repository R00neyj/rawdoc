// 댓글 API — 접근 집합·댓글 수·로그인 이관 (specs/features/F-503.md 6.2~6.4)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { getDocAccess } from './access'
import { readJsonLimited } from './docs'
import { loadDocPeople } from './docPeople'
import { importCommentsInRoom } from './docRoomRpc'
import { dayUsageStatement } from './usage'
import { COMMENTS_PER_DOC_MAX, parseCommentRecords } from '../src/lib/docComments'
import type { CommentCountResponse, CommentImportResponse, DocPeopleResponse } from '../src/lib/docComments'

// 모든 칸을 끝까지 채운 첫 댓글 500개가 4,318,013 B (F-503 t7)
export const COMMENT_IMPORT_MAX_BODY_BYTES = 5_000_000

type AccessRow = { id: string; owner_id: string; folder_id: string | null; e2ee_key?: string | null }

const COUNT_SQL =
  'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN parent_id IS NULL AND resolved_at IS NULL THEN 1 ELSE 0 END), 0) AS open FROM doc_comments WHERE doc_id = ?'

// 읽기 둘의 1~3번 — 로그인·접근·금고. 막힌 계정도 본다
async function readableDoc(request: Request, env: Env, docId: string): Promise<Response | null> {
  const user = await requireUser(request, env)
  const access = await getDocAccess<AccessRow>(env, docId, user, 'id, owner_id, folder_id')
  if (!access) return errorResponse('not_found', 404)
  if (access.doc.e2ee_key) return errorResponse('e2ee_doc', 409)
  return null
}

export async function handleGetDocPeople(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const denied = await readableDoc(request, env, params.id)
  if (denied) return denied
  const people = await loadDocPeople(env, params.id)
  if (!people) return errorResponse('not_found', 404)
  return jsonResponse({ people } satisfies DocPeopleResponse)
}

export async function handleGetCommentCount(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const denied = await readableDoc(request, env, params.id)
  if (denied) return denied
  const row = await env.DB.prepare(COUNT_SQL).bind(params.id).first<{ total: number; open: number }>()
  return jsonResponse({ total: row?.total ?? 0, open: row?.open ?? 0 } satisfies CommentCountResponse)
}

function isRecordsBody(body: unknown): body is { records: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const keys = Object.keys(body)
  return keys.length === 1 && keys[0] === 'records'
}

// 판정 순서가 계약이다 (6.4 표). 쓰기 관문은 index.ts 가 먼저 돌았다
export async function handleImportComments(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, COMMENT_IMPORT_MAX_BODY_BYTES)
  if (!parsed.ok) {
    return parsed.reason === 'too_large' ? jsonResponse({ error: 'too_large', limit: COMMENT_IMPORT_MAX_BODY_BYTES }, 413) : errorResponse('invalid', 400)
  }
  const access = await getDocAccess<AccessRow & { version: number }>(env, params.id, user, 'id, owner_id, folder_id, version')
  if (!access) return errorResponse('not_found', 404)
  if (access.doc.e2ee_key) return errorResponse('e2ee_doc', 409)
  if (access.role !== 'owner') return errorResponse('forbidden', 403)
  if (!isRecordsBody(parsed.data)) return errorResponse('invalid', 400)
  const checked = parseCommentRecords(parsed.data.records)
  if (!checked.ok) {
    return checked.reason === 'too_many' ? jsonResponse({ error: 'too_many', limit: COMMENTS_PER_DOC_MAX }, 413) : errorResponse('invalid', 400)
  }

  const countWrite = () => dayUsageStatement(env.DB, user.id, Date.now()).run()
  if (checked.records.length === 0) {
    await countWrite()
    return jsonResponse({ imported: 0, orphaned: 0 } satisfies CommentImportResponse)
  }
  const result = await importCommentsInRoom(env, params.id, {
    records: checked.records,
    user: { id: user.id, email: user.email },
    docVersion: access.doc.version,
  })
  if (!result || result.type === 'unavailable') return errorResponse('unavailable', 503)
  if (result.type === 'exists') return errorResponse('comments_exist', 409)
  if (result.type === 'not_found') return errorResponse('not_found', 404)
  await countWrite()
  return jsonResponse({ imported: result.imported, orphaned: result.orphaned } satisfies CommentImportResponse)
}
