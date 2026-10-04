// 저장소 고르기·파일 읽기 라우트 — repos·branches·tree·file (specs/features/F-3015.md 3.1·3.2)
import { jsonResponse } from './http'
import { requireUser, type AuthUser } from './auth'
import { badBody, readJsonLimited } from './docs'
import { checkGithubQuota, countGithubUse, loadEnabledGithub, type GithubConfig, type GithubSettings } from './githubSettings'
import { githubFailureResponse, githubFetch, isGithubFailure } from './githubClient'
import { MAX_CONTENT_BYTES } from './validate'
import { encodePathSegments, isBranchName, isRepoDir, isRepoFullName, isRepoMdPath } from '../src/lib/githubPath'
import type { GithubBranchList, GithubFile, GithubRepo, GithubRepoList, GithubTree, GithubTreeEntry } from '../src/lib/githubContract'

export type GithubCtx = { user: AuthUser; config: GithubConfig; settings: GithubSettings }

const REPO_CALLS_MAX = 10
const REPOS_MAX = 300
const TREE_TRUNCATED_AT = 1000
const BOM_BYTES = 3
const SHA_RE = /^[0-9a-f]{40}$/

export function invalid(field: string): Response {
  return jsonResponse({ error: 'invalid', field }, 400)
}

function unexpected(route: string, status: number): Response {
  console.error('github_unexpected', route, status)
  return jsonResponse({ error: 'github_unavailable' }, 502)
}

// 순서: 로그인 → 켜짐 (3.1)
export async function beginGithub(request: Request, env: Env): Promise<GithubCtx | Response> {
  const user = await requireUser(request, env)
  const enabled = await loadEnabledGithub(env)
  if (!enabled) return jsonResponse({ error: 'github_disabled' }, 503)
  return { user, ...enabled }
}

type Fetched = { res: Response } | { error: Response }

async function fetchGithub(env: Env, c: GithubCtx, path: string, route: string): Promise<Fetched> {
  const res = await githubFetch(env, c.config, c.user.id, path)
  if (isGithubFailure(res)) return { error: githubFailureResponse(res) }
  if (!res.ok) return { error: unexpected(route, res.status) }
  return { res }
}

async function fetchJson(env: Env, c: GithubCtx, path: string, route: string): Promise<{ body: unknown; res: Response } | { error: Response }> {
  const got = await fetchGithub(env, c, path, route)
  if ('error' in got) return got
  try {
    return { body: await got.res.json(), res: got.res }
  } catch {
    return { error: unexpected(route, got.res.status) }
  }
}

const hasNext = (res: Response) => /rel="next"/.test(res.headers.get('link') ?? '')
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function toRepo(item: unknown): GithubRepo | null {
  if (!isObject(item) || !Number.isSafeInteger(item.id) || typeof item.full_name !== 'string' || typeof item.default_branch !== 'string') return null
  const perms = isObject(item.permissions) ? item.permissions : {}
  return {
    id: item.id as number,
    fullName: item.full_name,
    defaultBranch: item.default_branch,
    private: item.private === true,
    canWrite: perms.push === true && item.archived !== true,
  }
}

export async function handleGithubRepos(request: Request, env: Env): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const route = 'repos'
  const installs = await fetchJson(env, c, '/user/installations?per_page=100', route)
  if ('error' in installs) return installs.error
  const list = isObject(installs.body) ? installs.body.installations : null
  if (!Array.isArray(list)) return unexpected(route, 200)

  const repos = new Map<number, GithubRepo>()
  let truncated = hasNext(installs.res)
  let calls = 0
  outer: for (const inst of list) {
    if (!isObject(inst) || !Number.isSafeInteger(inst.id)) return unexpected(route, 200)
    for (let page = 1; ; page++) {
      if (calls >= REPO_CALLS_MAX || repos.size >= REPOS_MAX) {
        truncated = true
        break outer
      }
      calls++
      const got = await fetchJson(env, c, `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`, route)
      if ('error' in got) return got.error
      const items = isObject(got.body) ? got.body.repositories : null
      if (!Array.isArray(items)) return unexpected(route, 200)
      for (const item of items) {
        const repo = toRepo(item)
        if (!repo) return unexpected(route, 200)
        if (!repos.has(repo.id)) repos.set(repo.id, repo)
      }
      if (!hasNext(got.res)) break
    }
  }
  const sorted = [...repos.values()].sort((a, b) => {
    const x = a.fullName.toLowerCase()
    const y = b.fullName.toLowerCase()
    return x < y ? -1 : x > y ? 1 : 0
  })
  const body: GithubRepoList = { repos: sorted.slice(0, REPOS_MAX), truncated }
  return jsonResponse(body)
}

export async function handleGithubBranches(request: Request, env: Env): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const repo = new URL(request.url).searchParams.get('repo')
  if (!isRepoFullName(repo)) return invalid('repo')
  const got = await fetchJson(env, c, `/repos/${repo}/branches?per_page=100`, 'branches')
  if ('error' in got) return got.error
  if (!Array.isArray(got.body) || !got.body.every((b) => isObject(b) && typeof b.name === 'string')) return unexpected('branches', 200)
  const body: GithubBranchList = { branches: got.body.map((b) => (b as { name: string }).name), truncated: hasNext(got.res) }
  return jsonResponse(body)
}

function contentsPath(repo: string, dirOrPath: string, branch: string): string {
  const middle = dirOrPath === '' ? '' : `/${encodePathSegments(dirOrPath)}`
  return `/repos/${repo}/contents${middle}?ref=${encodeURIComponent(branch)}`
}

const isMdName = (name: string) => /\.(md|markdown)$/i.test(name)
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export async function handleGithubTree(request: Request, env: Env): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const params = new URL(request.url).searchParams
  const repo = params.get('repo')
  const branch = params.get('branch')
  const dir = params.get('dir') ?? ''
  if (!isRepoFullName(repo)) return invalid('repo')
  if (!isBranchName(branch)) return invalid('branch')
  if (!isRepoDir(dir)) return invalid('dir')
  const got = await fetchJson(env, c, contentsPath(repo, dir, branch), 'tree')
  if ('error' in got) return got.error
  if (!Array.isArray(got.body)) return jsonResponse({ error: 'github_not_found' }, 404)
  const entries: GithubTreeEntry[] = []
  for (const item of got.body) {
    if (!isObject(item) || typeof item.name !== 'string') return unexpected('tree', 200)
    if (item.type === 'dir') entries.push({ name: item.name, type: 'dir', size: 0 })
    else if (item.type === 'file' && isMdName(item.name)) entries.push({ name: item.name, type: 'file', size: typeof item.size === 'number' ? item.size : 0 })
  }
  entries.sort((a, b) => (a.type === b.type ? byCodeUnit(a.name, b.name) : a.type === 'dir' ? -1 : 1))
  const body: GithubTree = { entries, truncated: got.body.length >= TREE_TRUNCATED_AT }
  return jsonResponse(body)
}

export type GithubContent = { sha: string; size: number; content: string }

const tooLarge = () => jsonResponse({ error: 'too_large', limit: MAX_CONTENT_BYTES }, 413)

// file·pull 이 같이 쓰는 Contents 한 번 — 판정은 3.2 file
export async function fetchGithubContent(
  env: Env,
  c: GithubCtx,
  target: { repo: string; branch: string; path: string },
  route: string,
): Promise<GithubContent | Response> {
  const got = await fetchJson(env, c, contentsPath(target.repo, target.path, target.branch), route)
  if ('error' in got) return got.error
  const f = got.body
  if (!isObject(f) || f.type !== 'file') return jsonResponse({ error: 'github_not_found' }, 404)
  if (typeof f.size !== 'number') return unexpected(route, 200)
  if (f.size > MAX_CONTENT_BYTES + BOM_BYTES || f.encoding !== 'base64') return tooLarge()
  if (typeof f.sha !== 'string' || !SHA_RE.test(f.sha) || typeof f.content !== 'string') return unexpected(route, 200)
  return { sha: f.sha, size: f.size, content: f.content }
}

export async function handleGithubFile(request: Request, env: Env): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const parsed = await readJsonLimited(request, 4096)
  if (!parsed.ok) return badBody(parsed)
  const body = isObject(parsed.data) ? parsed.data : {}
  const { repo, branch, path } = body
  if (!isRepoFullName(repo)) return invalid('repo')
  if (!isBranchName(branch)) return invalid('branch')
  if (!isRepoMdPath(path)) return invalid('path')

  const now = Date.now()
  const quota = await checkGithubQuota(env.DB, c.user.id, c.settings.monthlyLimit, now)
  if (quota) return quota
  const content = await fetchGithubContent(env, c, { repo, branch, path }, 'file')
  if (content instanceof Response) return content
  const linked = await env.DB.prepare('SELECT doc_id FROM github_links WHERE owner_id = ? AND repo = ? AND branch = ? AND path = ?')
    .bind(c.user.id, repo, branch, path)
    .first<{ doc_id: string }>()
  await countGithubUse(env.DB, c.user.id, now)
  const out: GithubFile = { ...content, linkedDocId: linked?.doc_id ?? null }
  return jsonResponse(out)
}
