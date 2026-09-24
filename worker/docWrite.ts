// 문서 행 모양과 조건부 쓰기 한 벌 — /api·/v1 폴백 PUT 과 DocRoom idle 경로가 같이 쓴다 (specs/features/F-308.md 6.1)

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
}

const UPDATE_ROW_SQL =
  'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?'

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
  }
}

// 사용량 카운터(F-2025)가 붙을 자리 (F-308 12장)
export async function updateDocRow(
  env: Env,
  existing: DocRow,
  patch: { title?: string; content?: string },
): Promise<{ ok: true; row: DocRow } | { ok: false }> {
  const title = patch.title !== undefined ? patch.title : existing.title
  const content = patch.content !== undefined ? patch.content : existing.content
  const version = existing.version + 1
  const now = Date.now()
  const result = await env.DB.prepare(UPDATE_ROW_SQL)
    .bind(title, content, version, now, existing.id, existing.owner_id, existing.version)
    .run()
  if (result.meta.changes !== 1) return { ok: false }
  return { ok: true, row: { ...existing, title, content, version, updated_at: now } }
}
