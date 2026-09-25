// 문서 행 모양과 조건부 쓰기 한 벌 — /api·/v1 폴백 PUT 과 DocRoom idle 경로가 같이 쓴다 (specs/features/F-308.md 6.1, F-2025.md 6.1, 금고는 F-401.md 3.3·3.5)
import { docUsageStatements, utf8Bytes } from './usage'

export type DocRow = {
  id: string
  owner_id: string
  title: string
  content: string
  line_ending: 'crlf' | 'lf'
  folder_id: string | null
  pinned_at: number | null
  version: number
  created_at: number
  updated_at: number
  e2ee_key?: string | null // 선택 — 테스트·DO 가 만드는 행 글자를 고치지 않게 (F-401 3.5)
  attachment_refs?: string | null
}

const UPDATE_ROW_SQL =
  'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?'

const UPDATE_E2EE_ROW_SQL =
  'UPDATE docs SET title = ?, content = ?, attachment_refs = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ? AND e2ee_key IS NOT NULL'

function parseAttachmentRefs(raw: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((ref): ref is string => typeof ref === 'string') : []
  } catch {
    return []
  }
}

// 금고 문서일 때만 두 필드 — 일반 문서 응답은 키까지 그대로 (F-401 3.5)
export function e2eeDocFields(row: Pick<DocRow, 'e2ee_key' | 'attachment_refs'>): { e2eeKey?: string; attachmentRefs?: string[] } {
  if (typeof row.e2ee_key !== 'string') return {}
  return { e2eeKey: row.e2ee_key, attachmentRefs: parseAttachmentRefs(row.attachment_refs) }
}

export function rowToDoc(row: DocRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    lineEnding: row.line_ending,
    folderId: row.folder_id,
    pinnedAt: row.pinned_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...e2eeDocFields(row),
  }
}

export async function updateDocRow(
  env: Env,
  existing: DocRow,
  patch: { title?: string; content?: string },
  actorId?: string, // 없으면 existing.owner_id — DO idle 경로가 이 모양으로 부른다 (F-2025 6.1)
): Promise<{ ok: true; row: DocRow } | { ok: false }> {
  const title = patch.title !== undefined ? patch.title : existing.title
  const content = patch.content !== undefined ? patch.content : existing.content
  const version = existing.version + 1
  const now = Date.now()
  const deltaBytes = patch.content !== undefined ? utf8Bytes(patch.content) - utf8Bytes(existing.content) : 0
  const [result] = await env.DB.batch([
    env.DB.prepare(UPDATE_ROW_SQL).bind(title, content, version, now, existing.id, existing.owner_id, existing.version),
    ...docUsageStatements(env.DB, {
      actorId: actorId ?? existing.owner_id,
      ownerId: existing.owner_id,
      now,
      deltaBytes,
      deltaDocs: 0,
    }),
  ])
  if (result.meta.changes !== 1) return { ok: false }
  return { ok: true, row: { ...existing, title, content, version, updated_at: now } }
}

// 금고 행 조건부 쓰기 — 금고 문서는 소유자만 쓰므로 보낸 사람 = 소유자. attachmentRefs 는 받았을 때만 바꾼다 (F-401 3.3 11번)
export async function updateE2eeDocRow(
  env: Env,
  existing: DocRow,
  patch: { title?: string; content?: string; attachmentRefs?: string[] },
): Promise<{ ok: true; row: DocRow } | { ok: false }> {
  const title = patch.title !== undefined ? patch.title : existing.title
  const content = patch.content !== undefined ? patch.content : existing.content
  const refs = patch.attachmentRefs !== undefined ? JSON.stringify(patch.attachmentRefs) : (existing.attachment_refs ?? '[]')
  const version = existing.version + 1
  const now = Date.now()
  const deltaBytes = patch.content !== undefined ? utf8Bytes(patch.content) - utf8Bytes(existing.content) : 0
  const [result] = await env.DB.batch([
    env.DB.prepare(UPDATE_E2EE_ROW_SQL).bind(title, content, refs, version, now, existing.id, existing.owner_id, existing.version),
    ...docUsageStatements(env.DB, { actorId: existing.owner_id, ownerId: existing.owner_id, now, deltaBytes, deltaDocs: 0 }),
  ])
  if (result.meta.changes !== 1) return { ok: false }
  return { ok: true, row: { ...existing, title, content, attachment_refs: refs, version, updated_at: now } }
}
