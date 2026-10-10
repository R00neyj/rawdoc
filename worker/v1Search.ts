// GET /v1/search — 내 문서의 제목·본문 부분 문자열 찾기. 금고 문서는 개수만 센다
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { getOwnedFolder, type FolderRowLike } from './access'
import { isValidUuid } from './validate'
import { SEARCH_MAX_DOCS, SEARCH_MAX_QUERY_CHARS, findMatchingLines } from './searchLines'
import type { V1SearchHit, V1SearchResult } from './v1Contract'

// 본문은 1MB 까지라 매칭 문서를 한꺼번에 읽지 않는다
const CONTENT_CHUNK = 10

// 재귀 단계는 owner_id 를 sub 행에서 이어받는다 (revalidateTargets.ts 와 같은 모양)
const SUBTREE_CTE = `WITH RECURSIVE sub(id, owner_id) AS (
  SELECT id, owner_id FROM folders WHERE id = ? AND owner_id = ?
  UNION
  SELECT f.id, f.owner_id FROM folders f JOIN sub s ON f.parent_id = s.id AND f.owner_id = s.owner_id
)
`

// lower() 는 영문만 접는다 — 줄 추출(searchLines.ts)도 같은 규칙
const MATCH_SQL = 'd.e2ee_key IS NULL AND (instr(lower(d.title), lower(?)) > 0 OR instr(lower(d.content), lower(?)) > 0)'

type Scope = { cte: string; from: string; binds: string[] }
type HitRow = { id: string; title: string; folder_id: string | null; version: number; updated_at: number }

export async function handleSearchV1(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const params = new URL(request.url).searchParams
  const query = params.get('q')
  if (query === null || query.length < 1 || query.length > SEARCH_MAX_QUERY_CHARS) {
    return jsonResponse({ error: 'invalid', field: 'q' }, 400)
  }
  const folderId = params.get('folder')
  if (folderId !== null && !isValidUuid(folderId)) return jsonResponse({ error: 'invalid', field: 'folder' }, 400)
  if (folderId !== null && !(await getOwnedFolder<FolderRowLike>(env, folderId, user))) return errorResponse('not_found', 404)

  const scope: Scope =
    folderId === null
      ? { cte: '', from: 'docs d WHERE d.owner_id = ?', binds: [user.id] }
      : { cte: SUBTREE_CTE, from: 'sub s JOIN docs d ON d.owner_id = s.owner_id AND d.folder_id = s.id WHERE 1', binds: [folderId, user.id] }

  const [hitRows, vault] = await Promise.all([
    env.DB.prepare(
      `${scope.cte}SELECT d.id, d.title, d.folder_id, d.version, d.updated_at FROM ${scope.from} AND ${MATCH_SQL} ORDER BY d.updated_at DESC, d.id LIMIT ?`,
    )
      .bind(...scope.binds, query, query, SEARCH_MAX_DOCS + 1)
      .all<HitRow>(),
    env.DB.prepare(`${scope.cte}SELECT COUNT(*) AS c FROM ${scope.from} AND d.e2ee_key IS NOT NULL`)
      .bind(...scope.binds)
      .first<{ c: number }>(),
  ])

  const rows = hitRows.results.slice(0, SEARCH_MAX_DOCS)
  const contentById = new Map<string, Pick<V1SearchHit, 'lines' | 'matchedLines'>>()
  for (let i = 0; i < rows.length; i += CONTENT_CHUNK) {
    const ids = rows.slice(i, i + CONTENT_CHUNK).map((r) => r.id)
    const { results } = await env.DB.prepare(`SELECT id, content FROM docs WHERE owner_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
      .bind(user.id, ...ids)
      .all<{ id: string; content: string }>()
    for (const r of results) contentById.set(r.id, findMatchingLines(r.content, query))
  }

  const body: V1SearchResult = {
    docs: rows.map((r) => ({
      id: r.id,
      title: r.title,
      folderId: r.folder_id,
      version: r.version,
      updatedAt: r.updated_at,
      ...(contentById.get(r.id) ?? { lines: [], matchedLines: 0 }),
    })),
    truncated: hitRows.results.length > SEARCH_MAX_DOCS,
    e2eeSkipped: vault?.c ?? 0,
  }
  return jsonResponse(body)
}
