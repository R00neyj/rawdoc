// 문서 접근 집합 — 소유자 + 문서 초대 + 폴더 사슬 초대 (specs/features/F-502.md 7장, F-500.md 3.6). 질의 3번 이하
import { FOLDER_CHAIN_SQL, higherRole } from './access'
import type { GrantRole } from './access'
import { folderAncestors } from '../src/lib/folderTree'

export type DocPerson = { email: string; role: 'owner' | 'edit' | 'view' }

const DOC_OWNER_SQL =
  'SELECT d.owner_id, d.folder_id, u.email FROM docs d JOIN users u ON u.id = d.owner_id WHERE d.id = ? AND d.e2ee_key IS NULL'
const GRANTS_SQL =
  "SELECT grantee_email, role FROM grants WHERE owner_id = ?1 AND ((target_type = 'doc' AND target_id = ?2) OR (target_type = 'folder' AND target_id IN (SELECT value FROM json_each(?3))))"

// 막힌 계정·아직 가입하지 않은 초대 이메일도 들어 있다. 없는 문서·금고 문서는 null
export async function loadDocPeople(env: Env, docId: string): Promise<DocPerson[] | null> {
  const doc = await env.DB.prepare(DOC_OWNER_SQL)
    .bind(docId)
    .first<{ owner_id: string; folder_id: string | null; email: string }>()
  if (!doc) return null

  let chain: string[] = []
  if (doc.folder_id) {
    const { results } = await env.DB.prepare(FOLDER_CHAIN_SQL)
      .bind(doc.folder_id, doc.owner_id, doc.owner_id)
      .all<{ id: string; parent_id: string | null }>()
    chain = folderAncestors(
      results.map((f) => ({ id: f.id, name: '', parentId: f.parent_id })),
      doc.folder_id,
    )
  }

  const { results: grants } = await env.DB.prepare(GRANTS_SQL)
    .bind(doc.owner_id, docId, JSON.stringify(chain))
    .all<{ grantee_email: string; role: GrantRole }>()
  const ownerEmail = doc.email.toLowerCase()
  const roles = new Map<string, GrantRole>()
  for (const g of grants) {
    const email = g.grantee_email.toLowerCase()
    if (email === ownerEmail) continue
    roles.set(email, higherRole(roles.get(email) ?? null, g.role) as GrantRole)
  }
  const others = [...roles].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([email, role]) => ({ email, role }))
  return [{ email: ownerEmail, role: 'owner' }, ...others]
}
