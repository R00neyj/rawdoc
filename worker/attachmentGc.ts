// 어떤 문서 원문에도 없고 24시간 지난 첨부를 매일 지운다 (specs/features/F-219.md 2.1, 2.2)
import { extractAttachmentRefs } from '../src/lib/imageBlock'

const PAGE_SIZE = 200
const MAX_DELETE = 500
const GRACE_MS = 24 * 60 * 60 * 1000

type AttachmentRow = { owner_id: string; id: string; ext: string; created_at: number }

async function collectReferencedIds(env: Env): Promise<Set<string>> {
  const refs = new Set<string>()
  let offset = 0
  for (;;) {
    const { results } = await env.DB.prepare('SELECT content FROM docs ORDER BY id LIMIT ? OFFSET ?')
      .bind(PAGE_SIZE, offset)
      .all<{ content: string }>()
    for (const row of results) {
      for (const id of extractAttachmentRefs(row.content)) refs.add(id)
    }
    if (results.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return refs
}

export async function cleanupServerAttachments(env: Env, now: number): Promise<{ deleted: number; failed: number }> {
  const refs = await collectReferencedIds(env)

  const threshold = now - GRACE_MS
  const { results: rows } = await env.DB.prepare(
    'SELECT owner_id, id, ext, created_at FROM attachments WHERE created_at < ? ORDER BY id',
  )
    .bind(threshold)
    .all<AttachmentRow>()

  const candidates = rows.filter((row) => !refs.has(row.id)).slice(0, MAX_DELETE)

  let deleted = 0
  let failed = 0
  for (const row of candidates) {
    try {
      await env.BUCKET.delete(`att/${row.owner_id}/${row.id}.${row.ext}`)
    } catch (err) {
      console.error(err)
      failed++
      continue
    }
    try {
      await env.DB.prepare('DELETE FROM attachments WHERE owner_id = ? AND id = ?')
        .bind(row.owner_id, row.id)
        .run()
      deleted++
    } catch (err) {
      console.error(err)
      failed++
    }
  }

  console.log(`attachment gc: deleted=${deleted} failed=${failed}`)
  return { deleted, failed }
}
