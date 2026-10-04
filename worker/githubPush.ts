// GitHub 푸시 라우트 — push-plan·blobs·push (specs/features/F-3016.md 3~5장)
import { errorResponse, jsonResponse } from './http'
import { getDocAccess, type DocRowLike } from './access'
import { badBody, readJsonLimited } from './docs'
import { beginGithub, invalid, type GithubCtx } from './githubRepos'
import { checkGithubQuota } from './githubSettings'
import {
  GITHUB_API,
  classifyGithubResponse,
  githubAccessToken,
  githubApiHeaders,
  githubFailureResponse,
  githubFetch,
  isGithubFailure,
} from './githubClient'
import { dayUsageStatement } from './usage'
import { E2EE_MAX_ATTACHMENT_REFS } from '../src/lib/e2eeLimits'
import { encodePathSegments } from '../src/lib/githubPath'
import {
  GITHUB_BLOB_MAX_BYTES,
  GITHUB_PUSH_MAX_IMAGES,
  githubMonth,
  type GithubBlobCreated,
  type GithubConflictBody,
  type GithubPushBody,
  type GithubPushed,
  type GithubPushImage,
  type GithubPushPlan,
} from '../src/lib/githubContract'

type LinkRow = { repo_id: number; repo: string; branch: string; path: string; remote_sha: string | null }
type Head = { head: string; tree: string }
type Remote = Head & { mdSha: string | null }
type Route = 'push-plan' | 'push'

const SHA_RE = /^[0-9a-f]{40}$/
const ATTACHMENT_NAME_RE = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/
const OBJECT_ACCEPT = 'application/vnd.github.object+json'
const PLAN_BODY_LIMIT = 32_768
const PUSH_BODY_LIMIT = 16_384
const MESSAGE_MAX = 1000
const FILE_MODE = '100644'
// githubSettings.countGithubUse 와 같은 SQL — 푸시 성공 batch 에 같이 싣는다
const COUNT_USE_SQL = 'INSERT INTO github_usage (user_id, month, count) VALUES (?, ?, 1) ON CONFLICT (user_id, month) DO UPDATE SET count = count + 1'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isSha = (v: unknown): v is string => typeof v === 'string' && SHA_RE.test(v)
const unavailable = () => jsonResponse({ error: 'github_unavailable' }, 502)
const githubNotFound = () => jsonResponse({ error: 'github_not_found' }, 404)
const emptyRepo = () => jsonResponse({ error: 'github_empty_repo' }, 409)
const conflict = (body: GithubConflictBody) => jsonResponse(body, 409)

function unexpected(...where: (string | number)[]): Response {
  console.error('github_unexpected', ...where)
  return unavailable()
}

async function readBody(request: Request, limit: number): Promise<unknown | Response> {
  const parsed = await readJsonLimited(request, limit)
  if (parsed.ok) return parsed.data
  return parsed.reason === 'too_large' ? jsonResponse({ error: 'too_large', limit }, 413) : badBody(parsed)
}

function attachmentsDir(mdPath: string): string {
  const slash = mdPath.lastIndexOf('/')
  return slash < 0 ? 'attachments' : `${mdPath.slice(0, slash)}/attachments`
}

// 공통 앞부분의 권한·금고·연결 행 (3장)
async function openLink(env: Env, c: GithubCtx, docId: string): Promise<LinkRow | Response> {
  const access = await getDocAccess<DocRowLike & { e2ee_key: string | null }>(env, docId, c.user, 'id, owner_id, folder_id, e2ee_key')
  if (!access) return errorResponse('not_found', 404)
  if (access.doc.owner_id !== c.user.id) return errorResponse('forbidden', 403)
  if (access.doc.e2ee_key) return jsonResponse({ error: 'e2ee' }, 409)
  const link = await env.DB.prepare('SELECT repo_id, repo, branch, path, remote_sha FROM github_links WHERE doc_id = ?').bind(docId).first<LinkRow>()
  return link ?? errorResponse('not_found', 404)
}

async function branchMissing(env: Env, c: GithubCtx, link: LinkRow): Promise<Response> {
  const got = await githubFetch(env, c.config, c.user.id, `/repos/${link.repo}/git/ref/heads/${encodePathSegments(link.branch)}`)
  if (isGithubFailure(got)) return got.code === 'github_not_found' ? githubNotFound() : githubFailureResponse(got)
  return got.status === 409 ? emptyRepo() : githubNotFound()
}

async function readBranch(env: Env, c: GithubCtx, link: LinkRow, route: Route): Promise<Head | Response> {
  const got = await githubFetch(env, c.config, c.user.id, `/repos/${link.repo}/branches/${encodePathSegments(link.branch)}`)
  if (isGithubFailure(got)) return got.code === 'github_not_found' ? branchMissing(env, c, link) : githubFailureResponse(got)
  if (!got.ok) return unexpected(route, 'branch', got.status)
  const body: unknown = await got.json().catch(() => null)
  const commit = isObject(body) && isObject(body.commit) ? body.commit : {}
  const tree = isObject(commit.commit) && isObject(commit.commit.tree) ? commit.commit.tree : {}
  if (!isObject(body) || typeof body.name !== 'string' || !isSha(commit.sha) || !isSha(tree.sha)) return unexpected(route, 'branch', got.status)
  if (body.name !== link.branch) return githubNotFound()
  return { head: commit.sha, tree: tree.sha }
}

// Contents object 형식 — 1MB 넘는 파일도 sha 를, 폴더는 entries 를 준다. null = 404
async function readObject(env: Env, c: GithubCtx, repo: string, path: string, ref: string, route: Route): Promise<Record<string, unknown> | null | Response> {
  const got = await githubFetch(env, c.config, c.user.id, `/repos/${repo}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(ref)}`, {
    headers: { Accept: OBJECT_ACCEPT },
  })
  if (isGithubFailure(got)) return got.code === 'github_not_found' ? null : githubFailureResponse(got)
  if (!got.ok) return unexpected(route, 'contents', got.status)
  const body: unknown = await got.json().catch(() => null)
  return isObject(body) ? body : unexpected(route, 'contents', got.status)
}

// 3장 원격 확인 ①~③
async function checkRemote(env: Env, c: GithubCtx, link: LinkRow, route: Route): Promise<Remote | Response> {
  const head = await readBranch(env, c, link, route)
  if (head instanceof Response) return head
  const md = await readObject(env, c, link.repo, link.path, head.head, route)
  if (md instanceof Response) return md
  if (md !== null && md.type !== 'file') return conflict({ error: 'github_conflict', remoteSha: null })
  if (md !== null && !isSha(md.sha)) return unexpected(route, 'contents', 200)
  const mdSha = md === null ? null : (md.sha as string)
  if (mdSha !== link.remote_sha) return conflict({ error: 'github_conflict', remoteSha: mdSha })
  return { ...head, mdSha }
}

function readAttachmentNames(data: unknown): string[] | null {
  const list = isObject(data) ? data.attachments : null
  if (!Array.isArray(list) || list.length > E2EE_MAX_ATTACHMENT_REFS) return null
  if (!list.every((name) => typeof name === 'string' && ATTACHMENT_NAME_RE.test(name))) return null
  return [...new Set(list as string[])]
}

async function uploadableNames(env: Env, names: string[]): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  const ids = [...new Set(names.map((name) => name.slice(0, 16)))]
  const { results } = await env.DB.prepare('SELECT id, ext FROM attachments WHERE e2ee = 0 AND id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids))
    .all<{ id: string; ext: string }>()
  return new Set(results.map((r) => `${r.id}.${r.ext}`))
}

async function remoteAttachmentNames(env: Env, c: GithubCtx, link: LinkRow, head: string): Promise<Set<string> | Response> {
  const dir = await readObject(env, c, link.repo, attachmentsDir(link.path), head, 'push-plan')
  if (dir instanceof Response) return dir
  if (dir === null) return new Set()
  if (dir.type !== 'dir') return unexpected('push-plan', 'attachments_not_dir')
  if (!Array.isArray(dir.entries)) return unexpected('push-plan', 'attachments', 200)
  const names = new Set<string>()
  for (const entry of dir.entries) if (isObject(entry) && entry.type === 'file' && typeof entry.name === 'string') names.add(entry.name)
  return names
}

export async function handleGithubPushPlan(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const data = await readBody(request, PLAN_BODY_LIMIT)
  if (data instanceof Response) return data
  const names = readAttachmentNames(data)
  if (!names) return invalid('attachments')
  const link = await openLink(env, c, params.id)
  if (link instanceof Response) return link
  const quota = await checkGithubQuota(env.DB, c.user.id, c.settings.monthlyLimit, Date.now())
  if (quota) return quota
  const remote = await checkRemote(env, c, link, 'push-plan')
  if (remote instanceof Response) return remote

  const uploadable = await uploadableNames(env, names)
  const skipped = names.filter((name) => !uploadable.has(name))
  let missing = names.filter((name) => uploadable.has(name))
  if (missing.length > 0) {
    const present = await remoteAttachmentNames(env, c, link, remote.head)
    if (present instanceof Response) return present
    missing = missing.filter((name) => !present.has(name))
  }
  const out: GithubPushPlan = { missing, skipped }
  return jsonResponse(out)
}

// 몸통을 읽지 않고 GitHub 로 흘려보낸다 — 스트림은 다시 못 보내 githubFetch(401 재시도)를 쓰지 않는다 (4장)
export async function handleGithubBlobs(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const length = request.headers.get('Content-Length')
  if (!length || !/^\d+$/.test(length)) return jsonResponse({ error: 'length_required' }, 411)
  const size = Number(length)
  if (size > GITHUB_BLOB_MAX_BYTES) return jsonResponse({ error: 'too_large', limit: GITHUB_BLOB_MAX_BYTES }, 413)
  const link = await openLink(env, c, params.id)
  if (link instanceof Response) return link

  const access = await githubAccessToken(env.DB, c.config, c.user.id)
  if (isGithubFailure(access)) return githubFailureResponse(access)
  let res: Response
  try {
    res = await fetch(`${GITHUB_API}/repos/${link.repo}/git/blobs`, {
      method: 'POST',
      headers: githubApiHeaders(access.token, { 'Content-Type': 'application/json' }),
      body: request.body ? request.body.pipeThrough(new FixedLengthStream(size)) : '',
    })
  } catch (err) {
    // 오류 객체에 머리(토큰)가 실릴 수 있어 이름만 남긴다. 길이를 속인 몸통도 여기로 온다
    console.error('github_fetch_failed', err instanceof Error ? err.name : 'unknown')
    return unavailable()
  }

  if (res.status === 201) {
    const body: unknown = await res.json().catch(() => null)
    if (!isObject(body) || !isSha(body.sha)) return unexpected('blobs', res.status)
    const out: GithubBlobCreated = { sha: body.sha }
    return jsonResponse(out)
  }
  if (res.status === 400 || res.status === 422) return invalid('content')
  if (res.status === 409) return emptyRepo()
  if (res.status === 401) {
    const again = await githubAccessToken(env.DB, c.config, c.user.id, access.rev)
    return isGithubFailure(again) ? githubFailureResponse(again) : unavailable()
  }
  const failure = classifyGithubResponse(res)
  return isGithubFailure(failure) ? githubFailureResponse(failure) : unexpected('blobs', res.status)
}

function readPushBody(data: unknown): GithubPushBody | string {
  const { message, mdSha, images } = isObject(data) ? data : ({} as Record<string, unknown>)
  if (typeof message !== 'string' || message.trim() === '' || message.length > MESSAGE_MAX) return 'message'
  if (!isSha(mdSha)) return 'mdSha'
  if (!Array.isArray(images) || images.length > GITHUB_PUSH_MAX_IMAGES) return 'images'
  const out: GithubPushImage[] = []
  const seen = new Set<string>()
  for (const image of images) {
    if (!isObject(image) || typeof image.name !== 'string' || !ATTACHMENT_NAME_RE.test(image.name) || !isSha(image.sha) || seen.has(image.name)) return 'images'
    seen.add(image.name)
    out.push({ name: image.name, sha: image.sha })
  }
  return { message, mdSha, images: out }
}

function sendJson(env: Env, c: GithubCtx, method: string, path: string, payload: unknown) {
  return githubFetch(env, c.config, c.user.id, path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}

async function createdSha(res: Response, step: string): Promise<string | Response> {
  if (res.status !== 201) return unexpected('push', step, res.status)
  const body: unknown = await res.json().catch(() => null)
  return isObject(body) && isSha(body.sha) ? body.sha : unexpected('push', step, res.status)
}

export async function handleGithubPush(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const data = await readBody(request, PUSH_BODY_LIMIT)
  if (data instanceof Response) return data
  const body = readPushBody(data)
  if (typeof body === 'string') return invalid(body)
  const link = await openLink(env, c, params.id)
  if (link instanceof Response) return link
  const now = Date.now()
  const quota = await checkGithubQuota(env.DB, c.user.id, c.settings.monthlyLimit, now)
  if (quota) return quota
  const remote = await checkRemote(env, c, link, 'push')
  if (remote instanceof Response) return remote
  if (remote.mdSha === body.mdSha && body.images.length === 0) {
    const same: GithubPushed = { sha: body.mdSha, commitSha: null, commitUrl: null }
    return jsonResponse(same)
  }

  const dir = attachmentsDir(link.path)
  const tree = [
    { path: link.path, mode: FILE_MODE, type: 'blob', sha: body.mdSha },
    ...body.images.map((image) => ({ path: `${dir}/${image.name}`, mode: FILE_MODE, type: 'blob', sha: image.sha })),
  ]
  const treeRes = await sendJson(env, c, 'POST', `/repos/${link.repo}/git/trees`, { base_tree: remote.tree, tree })
  if (isGithubFailure(treeRes)) return githubFailureResponse(treeRes)
  if (treeRes.status === 422) return invalid('sha')
  const treeSha = await createdSha(treeRes, 'tree')
  if (treeSha instanceof Response) return treeSha

  // author·committer 를 빼면 GitHub 가 토큰 주인과 지금 시각으로 채운다 (d1)
  const commitRes = await sendJson(env, c, 'POST', `/repos/${link.repo}/git/commits`, { message: body.message, tree: treeSha, parents: [remote.head] })
  if (isGithubFailure(commitRes)) return githubFailureResponse(commitRes)
  const commitSha = await createdSha(commitRes, 'commit')
  if (commitSha instanceof Response) return commitSha

  const refRes = await sendJson(env, c, 'PATCH', `/repos/${link.repo}/git/refs/heads/${encodePathSegments(link.branch)}`, { sha: commitSha, force: false })
  if (isGithubFailure(refRes)) return githubFailureResponse(refRes)
  if (refRes.status === 422 || refRes.status === 409) {
    const again = await readBranch(env, c, link, 'push')
    if (again instanceof Response) return again
    return again.head === remote.head ? jsonResponse({ error: 'github_forbidden' }, 403) : conflict({ error: 'github_conflict' })
  }
  if (refRes.status !== 200) return unexpected('push', 'ref', refRes.status)

  // 그사이 다시 연결됐으면 0행 — 옛 대상으로 간 푸시가 새 연결을 건드리지 않는다
  await env.DB.batch([
    env.DB.prepare('UPDATE github_links SET remote_sha = ?, synced_at = ? WHERE doc_id = ? AND owner_id = ? AND repo_id = ? AND branch = ? AND path = ?').bind(
      body.mdSha,
      now,
      params.id,
      c.user.id,
      link.repo_id,
      link.branch,
      link.path,
    ),
    env.DB.prepare(COUNT_USE_SQL).bind(c.user.id, githubMonth(now)),
    dayUsageStatement(env.DB, c.user.id, now),
  ])
  const out: GithubPushed = { sha: body.mdSha, commitSha, commitUrl: `https://github.com/${link.repo}/commit/${commitSha}` }
  return jsonResponse(out)
}
