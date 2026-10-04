// 문서 ↔ GitHub 파일 연결 라우트 — GET·PUT·DELETE github, pull, synced (specs/features/F-3015.md 3.3)
import { errorResponse, jsonResponse } from './http'
import { getDocAccess, type DocAccess, type DocRowLike } from './access'
import { badBody, readJsonLimited } from './docs'
import { beginGithub, fetchGithubContent, invalid, type GithubCtx } from './githubRepos'
import { checkGithubQuota, countGithubUse } from './githubSettings'
import { githubFailureResponse, githubFetch, isGithubFailure } from './githubClient'
import { dayUsageStatement } from './usage'
import { githubBlobUrl, isBranchName, isRepoFullName, isRepoMdPath } from '../src/lib/githubPath'
import type { GithubLink, GithubPulled } from '../src/lib/githubContract'

type LinkRow = { repo_id: number; repo: string; branch: string; path: string; remote_sha: string | null; remote_bom: number; synced_at: number | null }

const SHA_RE = /^[0-9a-f]{40}$/
const BODY_LIMIT = 4096

const UPSERT_SQL = `INSERT INTO github_links (doc_id, owner_id, repo_id, repo, branch, path, remote_sha, remote_bom, synced_at, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
WHERE EXISTS (SELECT 1 FROM docs WHERE id = ?1 AND owner_id = ?2 AND e2ee_key IS NULL)
ON CONFLICT (doc_id) DO UPDATE SET repo_id = excluded.repo_id, repo = excluded.repo, branch = excluded.branch, path = excluded.path,
  remote_sha = excluded.remote_sha, remote_bom = excluded.remote_bom, synced_at = excluded.synced_at`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const notFound = () => errorResponse('not_found', 404)
const forbidden = () => errorResponse('forbidden', 403)

type DocAccessRow = DocRowLike & { e2ee_key: string | null }

async function openDoc(env: Env, c: GithubCtx, docId: string, owner: boolean): Promise<DocAccess<DocAccessRow> | Response> {
  const access = await getDocAccess<DocAccessRow>(env, docId, c.user, 'id, owner_id, folder_id, e2ee_key')
  if (!access) return notFound()
  if (owner ? access.doc.owner_id !== c.user.id : access.role === 'view' && !access.blocked) return forbidden()
  return access
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const parsed = await readJsonLimited(request, BODY_LIMIT)
  if (!parsed.ok) return badBody(parsed)
  return isObject(parsed.data) ? parsed.data : {}
}

function readLink(env: Env, docId: string): Promise<LinkRow | null> {
  return env.DB.prepare('SELECT repo_id, repo, branch, path, remote_sha, remote_bom, synced_at FROM github_links WHERE doc_id = ?').bind(docId).first<LinkRow>()
}

async function linkResponse(env: Env, docId: string, row: LinkRow): Promise<Response> {
  const { results } = await env.DB.prepare('SELECT path, attachment_id, ext FROM github_images WHERE doc_id = ?')
    .bind(docId)
    .all<{ path: string; attachment_id: string; ext: string }>()
  const body: GithubLink = {
    repo: row.repo,
    branch: row.branch,
    path: row.path,
    remoteSha: row.remote_sha,
    remoteBom: row.remote_bom === 1,
    syncedAt: row.synced_at,
    htmlUrl: githubBlobUrl(row.repo, row.branch, row.path),
    images: Object.fromEntries(results.map((r) => [r.path, `${r.attachment_id}.${r.ext}`])),
  }
  return jsonResponse(body)
}

export async function handleGetDocGithub(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const access = await openDoc(env, c, params.id, false)
  if (access instanceof Response) return access
  const row = await readLink(env, params.id)
  return row ? linkResponse(env, params.id, row) : notFound()
}

export async function handlePutDocGithub(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const body = await readBody(request)
  if (body instanceof Response) return body
  const { repo, branch, path, sha, bom } = body
  if (!isRepoFullName(repo)) return invalid('repo')
  if (!isBranchName(branch)) return invalid('branch')
  if (!isRepoMdPath(path)) return invalid('path')
  if (sha !== null && !(typeof sha === 'string' && SHA_RE.test(sha))) return invalid('sha')
  if (typeof bom !== 'boolean') return invalid('bom')

  const access = await openDoc(env, c, params.id, true)
  if (access instanceof Response) return access
  if (access.doc.e2ee_key) return jsonResponse({ error: 'e2ee' }, 409)

  const got = await githubFetch(env, c.config, c.user.id, `/repos/${repo}`)
  if (isGithubFailure(got)) return githubFailureResponse(got)
  const info: unknown = got.ok ? await got.json().catch(() => null) : null
  if (!isObject(info) || !Number.isSafeInteger(info.id) || typeof info.full_name !== 'string') {
    console.error('github_unexpected', 'link_put', got.status)
    return jsonResponse({ error: 'github_unavailable' }, 502)
  }
  const perms = isObject(info.permissions) ? info.permissions : {}
  if (perms.push !== true || info.archived === true) return jsonResponse({ error: 'github_forbidden' }, 403)

  const repoId = info.id as number
  const taken = await env.DB.prepare('SELECT 1 AS x FROM github_links WHERE owner_id = ? AND repo_id = ? AND branch = ? AND path = ? AND doc_id <> ?')
    .bind(c.user.id, repoId, branch, path, params.id)
    .first()
  if (taken) return jsonResponse({ error: 'github_target_taken' }, 409)

  const existing = await readLink(env, params.id)
  const retargeted = existing !== null && (existing.repo_id !== repoId || existing.branch !== branch || existing.path !== path)
  const now = Date.now()
  const statements = []
  if (retargeted) statements.push(env.DB.prepare('DELETE FROM github_images WHERE doc_id = ?').bind(params.id))
  statements.push(
    env.DB.prepare(UPSERT_SQL).bind(params.id, c.user.id, repoId, info.full_name, branch, path, sha, bom ? 1 : 0, sha ? now : null, now),
    dayUsageStatement(env.DB, c.user.id, now),
  )
  let results
  try {
    results = await env.DB.batch(statements)
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return jsonResponse({ error: 'github_target_taken' }, 409)
    throw err
  }
  if (results[statements.length - 2].meta.changes === 0) {
    const doc = await env.DB.prepare('SELECT e2ee_key FROM docs WHERE id = ?').bind(params.id).first<{ e2ee_key: string | null }>()
    return doc ? jsonResponse({ error: 'e2ee' }, 409) : notFound()
  }
  const row = await readLink(env, params.id)
  return row ? linkResponse(env, params.id, row) : notFound()
}

export async function handleDeleteDocGithub(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const access = await openDoc(env, c, params.id, true)
  if (access instanceof Response) return access
  await env.DB.batch([
    env.DB.prepare('DELETE FROM github_images WHERE doc_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM github_links WHERE doc_id = ?').bind(params.id),
    dayUsageStatement(env.DB, c.user.id, Date.now()),
  ])
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

export async function handlePullDocGithub(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const access = await openDoc(env, c, params.id, true)
  if (access instanceof Response) return access
  const row = await readLink(env, params.id)
  if (!row) return notFound()
  const now = Date.now()
  const quota = await checkGithubQuota(env.DB, c.user.id, c.settings.monthlyLimit, now)
  if (quota) return quota
  const content = await fetchGithubContent(env, c, row, 'pull')
  if (content instanceof Response) return content
  await countGithubUse(env.DB, c.user.id, now)
  const out: GithubPulled = content
  return jsonResponse(out)
}

export async function handleSyncedDocGithub(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const body = await readBody(request)
  if (body instanceof Response) return body
  const { sha, bom } = body
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) return invalid('sha')
  if (typeof bom !== 'boolean') return invalid('bom')
  const access = await openDoc(env, c, params.id, true)
  if (access instanceof Response) return access
  const now = Date.now()
  const [updated] = await env.DB.batch([
    env.DB.prepare('UPDATE github_links SET remote_sha = ?, remote_bom = ?, synced_at = ? WHERE doc_id = ? AND owner_id = ?').bind(sha, bom ? 1 : 0, now, params.id, c.user.id),
    dayUsageStatement(env.DB, c.user.id, now),
  ])
  if (updated.meta.changes === 0) return notFound()
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
