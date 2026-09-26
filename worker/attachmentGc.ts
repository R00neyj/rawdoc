// 어떤 문서 원문에도 없고 24시간 지난 첨부를 매일 지운다 (specs/features/F-219.md 2.1, 2.2, F-402.md 4장)
import { extractAttachmentRefs } from '../src/lib/imageBlock'

const PAGE_SIZE = 200
const MAX_DELETE = 500
export const GRACE_MS = 24 * 60 * 60 * 1000
const REF_ID_RE = /^[0-9a-f]{16}$/

type AttachmentRow = { owner_id: string; id: string; ext: string; created_at: number }

// (A) 일반 문서 본문 참조 — id 기준 쪽 나누기 (OFFSET 은 쪽마다 앞을 다시 세어 N²/400행을 읽는다)
async function collectPlainReferencedIds(env: Env, refs: Set<string>): Promise<void> {
  let afterId = ''
  for (;;) {
    const { results } = await env.DB.prepare(
      'SELECT id, content FROM docs WHERE e2ee_key IS NULL AND id > ? ORDER BY id LIMIT ?',
    )
      .bind(afterId, PAGE_SIZE)
      .all<{ id: string; content: string }>()
    for (const row of results) {
      for (const id of extractAttachmentRefs(row.content)) refs.add(id)
    }
    if (results.length < PAGE_SIZE) break
    afterId = results[results.length - 1].id
  }
}

// (B) 금고 문서 attachment_refs — 풀지 못한 행의 소유자는 이번 실행에서 지우지 않는 쪽으로 넘어간다 (결정 7·9)
async function collectE2eeDocReferencedIds(env: Env, refs: Set<string>, protectedOwners: Set<string>): Promise<void> {
  let afterId = ''
  for (;;) {
    const { results } = await env.DB.prepare(
      'SELECT id, owner_id, attachment_refs FROM docs WHERE e2ee_key IS NOT NULL AND id > ? ORDER BY id LIMIT ?',
    )
      .bind(afterId, PAGE_SIZE)
      .all<{ id: string; owner_id: string; attachment_refs: string | null }>()
    for (const row of results) {
      let parsed: unknown
      try {
        parsed = row.attachment_refs === null ? undefined : JSON.parse(row.attachment_refs)
      } catch {
        parsed = undefined
      }
      if (!Array.isArray(parsed)) {
        protectedOwners.add(row.owner_id)
        console.error('e2ee_refs_unreadable', row.id)
        continue
      }
      for (const item of parsed) {
        if (typeof item === 'string' && REF_ID_RE.test(item)) refs.add(item)
      }
    }
    if (results.length < PAGE_SIZE) break
    afterId = results[results.length - 1].id
  }
}

async function collectReferencedIds(env: Env): Promise<{ refs: Set<string>; protectedOwners: Set<string> }> {
  const refs = new Set<string>()
  const protectedOwners = new Set<string>()
  await collectPlainReferencedIds(env, refs)
  await collectE2eeDocReferencedIds(env, refs, protectedOwners)
  return { refs, protectedOwners }
}

export async function cleanupServerAttachments(env: Env, now: number): Promise<{ deleted: number; failed: number }> {
  const { refs, protectedOwners } = await collectReferencedIds(env)

  const threshold = now - GRACE_MS
  const { results: rows } = await env.DB.prepare(
    'SELECT owner_id, id, ext, created_at FROM attachments WHERE created_at < ? ORDER BY id',
  )
    .bind(threshold)
    .all<AttachmentRow>()

  const candidates = rows.filter((row) => !refs.has(row.id) && !protectedOwners.has(row.owner_id)).slice(0, MAX_DELETE)

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
