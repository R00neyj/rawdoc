// 저장소 그림 — 출처 찾기·받기·대응 기록·프록시·대응표, 첨부 판정·정리 도우미 (specs/features/F-3017.md 2·3장)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { getDocAccess, type DocRowLike } from './access'
import { readJsonLimited } from './docs'
import { beginGithub, invalid, type GithubCtx } from './githubRepos'
import { githubFailureResponse, githubFetch, isGithubFailure, type GithubFailure } from './githubClient'
import { loadEnabledGithub } from './githubSettings'
import { dayUsageStatement } from './usage'
import { attachmentResponse } from './attachments'
import { findPublicLink, folderTreeIds, isDocInLinkSet } from './links'
import { isValidToken } from './token'
import { IMAGE_MIME, sniffImage } from './imageSniff'
import { extractAttachmentRefs } from '../src/lib/imageBlock'
import { encodePathSegments, isRepoDir, repoImagePaths } from '../src/lib/githubPath'
import {
  GITHUB_IMAGES_PER_DOC,
  GITHUB_IMAGE_SOURCES_MAX_DIRS,
  GITHUB_IMAGE_SOURCES_MAX_PATHS,
  GITHUB_PROXY_MAX_BYTES,
  GITHUB_RAW_MAX_BYTES,
  type GithubImageMap,
  type GithubImageSource,
  type GithubImageSources,
} from '../src/lib/githubContract'

type LinkRow = { repo_id: number; repo: string; branch: string; path: string }
type DocRow = DocRowLike & { content: string }
type DocBody = { id: string; owner_id: string; content: string }

const SHA_RE = /^[0-9a-f]{40}$/
const ATTACHMENT_NAME_RE = /^([0-9a-f]{16})\.(png|jpg|gif|webp)$/
const SOURCES_BODY_LIMIT = 262_144
const PUT_BODY_LIMIT = 4096
const SVG_SNIFF_BYTES = 4096
const GC_PAGE_SIZE = 200
const GC_MAX_ROWS = 500
const GC_BATCH = 100
const RAW_ACCEPT = 'application/vnd.github.raw+json'
const PROXY_CACHE_CONTROL = 'private, max-age=300'
const PROXY_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; sandbox"
const SVG_MIME = 'image/svg+xml'
const PROXY_TYPES = new Set([...Object.values(IMAGE_MIME), SVG_MIME])
const UNAVAILABLE: GithubFailure = { code: 'github_unavailable', status: 502 }

const UPSERT_SQL = `INSERT INTO github_images (doc_id, path, owner_id, attachment_id, ext, blob_sha, created_at)
SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
WHERE EXISTS (SELECT 1 FROM github_links WHERE doc_id = ?1 AND owner_id = ?3)
  AND (EXISTS (SELECT 1 FROM github_images WHERE doc_id = ?1 AND path = ?2) OR (SELECT COUNT(*) FROM github_images WHERE doc_id = ?1) < ?8)
ON CONFLICT (doc_id, path) DO UPDATE SET owner_id = excluded.owner_id, attachment_id = excluded.attachment_id, ext = excluded.ext,
  blob_sha = excluded.blob_sha, created_at = excluded.created_at`

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isRepoFile = (path: unknown): path is string => isRepoDir(path) && path !== ''
const notFound = () => errorResponse('not_found', 404)
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

function contentsUrl(repo: string, dirOrPath: string, branch: string): string {
  const middle = dirOrPath === '' ? '' : `/${encodePathSegments(dirOrPath)}`
  return `/repos/${repo}/contents${middle}?ref=${encodeURIComponent(branch)}`
}

function readLink(env: Env, docId: string, ownerId: string): Promise<LinkRow | null> {
  return env.DB.prepare('SELECT repo_id, repo, branch, path FROM github_links WHERE doc_id = ? AND owner_id = ?').bind(docId, ownerId).first<LinkRow>()
}

async function readBody(request: Request, limit: number): Promise<Record<string, unknown> | Response> {
  const parsed = await readJsonLimited(request, limit)
  if (!parsed.ok) return parsed.reason === 'too_large' ? jsonResponse({ error: 'too_large', limit }, 413) : errorResponse('invalid', 400)
  return isObject(parsed.data) ? parsed.data : {}
}

// F-3015 3.1 순서의 뒤 절반 — 문서 404 → 주인 아니면 403 → 연결 없음 404
async function openOwnedLink(env: Env, c: GithubCtx, docId: string): Promise<LinkRow | Response> {
  const access = await getDocAccess<DocRowLike>(env, docId, c.user, 'id, owner_id, folder_id')
  if (!access) return notFound()
  if (access.doc.owner_id !== c.user.id) return errorResponse('forbidden', 403)
  return (await readLink(env, docId, c.user.id)) ?? notFound()
}

// 머리·읽은 길이가 max 를 넘으면 null — Content-Length 가 없을 수 있어 읽으면서도 센다 (7장 3)
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get('Content-Length') ?? NaN) > max) {
    await res.body?.cancel()
    return null
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

type DirListing = unknown[] | 'skip' | GithubFailure

async function listDir(env: Env, c: GithubCtx, link: LinkRow, dir: string): Promise<DirListing> {
  const got = await githubFetch(env, c.config, c.user.id, contentsUrl(link.repo, dir, link.branch))
  if (isGithubFailure(got)) return got.code === 'github_not_found' ? 'skip' : got
  if (!got.ok) {
    console.error('github_unexpected', 'image_sources', got.status)
    return UNAVAILABLE
  }
  const body: unknown = await got.json().catch(() => null)
  return Array.isArray(body) ? body : 'skip'
}

export async function handleGithubImageSources(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const body = await readBody(request, SOURCES_BODY_LIMIT)
  if (body instanceof Response) return body
  const { paths } = body
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > GITHUB_IMAGE_SOURCES_MAX_PATHS || !paths.every(isRepoFile)) return invalid('paths')
  const link = await openOwnedLink(env, c, params.id)
  if (link instanceof Response) return link

  const wanted = new Set<string>(paths)
  const dirs = [...new Set(paths.map(dirOf))]
  const found = new Map<string, GithubImageSource>()
  let truncated = dirs.length > GITHUB_IMAGE_SOURCES_MAX_DIRS
  let answered = false
  for (const dir of dirs.slice(0, GITHUB_IMAGE_SOURCES_MAX_DIRS)) {
    const listing = await listDir(env, c, link, dir)
    if (listing === 'skip') continue
    if (isGithubFailure(listing)) {
      // 아직 한 폴더도 답을 못 받았으면 빈 결과 대신 원인을 돌려준다
      if (!answered) return githubFailureResponse(listing)
      truncated = true
      break
    }
    answered = true
    for (const item of listing) {
      if (!isObject(item) || item.type !== 'file' || typeof item.path !== 'string' || !wanted.has(item.path)) continue
      if (typeof item.sha !== 'string' || !SHA_RE.test(item.sha) || typeof item.size !== 'number') continue
      found.set(item.path, { path: item.path, sha: item.sha, size: item.size, mapped: false })
    }
  }
  const { results: rows } = await env.DB.prepare('SELECT path, blob_sha FROM github_images WHERE doc_id = ?').bind(params.id).all<{ path: string; blob_sha: string }>()
  for (const row of rows) {
    const source = found.get(row.path)
    if (source && source.sha === row.blob_sha) source.mapped = true
  }
  const out: GithubImageSources = { sources: [...wanted].flatMap((p) => found.get(p) ?? []), truncated }
  return jsonResponse(out)
}

const RAW_HEADERS: HeadersInit = {
  'Content-Type': 'application/octet-stream',
  'X-Content-Type-Options': 'nosniff',
  'Content-Disposition': 'attachment',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'no-store',
}

export async function handleGithubRaw(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const path = new URL(request.url).searchParams.get('path')
  if (!isRepoFile(path)) return invalid('path')
  const link = await openOwnedLink(env, c, params.id)
  if (link instanceof Response) return link
  const got = await githubFetch(env, c.config, c.user.id, contentsUrl(link.repo, path, link.branch), { headers: { Accept: RAW_ACCEPT } })
  if (isGithubFailure(got)) return githubFailureResponse(got)
  if (!got.ok) {
    await got.body?.cancel()
    console.error('github_unexpected', 'raw', got.status)
    return jsonResponse({ error: 'github_unavailable' }, 502)
  }
  const bytes = await readCapped(got, GITHUB_RAW_MAX_BYTES)
  if (!bytes) return jsonResponse({ error: 'too_large', limit: GITHUB_RAW_MAX_BYTES }, 413)
  return new Response(bytes, { headers: RAW_HEADERS })
}

export async function handlePutGithubImage(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const c = await beginGithub(request, env)
  if (c instanceof Response) return c
  const body = await readBody(request, PUT_BODY_LIMIT)
  if (body instanceof Response) return body
  const { path, blobSha, attachment } = body
  if (!isRepoFile(path)) return invalid('path')
  if (typeof blobSha !== 'string' || !SHA_RE.test(blobSha)) return invalid('blobSha')
  const name = typeof attachment === 'string' ? ATTACHMENT_NAME_RE.exec(attachment) : null
  if (!name) return invalid('attachment')
  const link = await openOwnedLink(env, c, params.id)
  if (link instanceof Response) return link
  const [, attachmentId, ext] = name
  const own = await env.DB.prepare('SELECT 1 AS x FROM attachments WHERE owner_id = ? AND id = ? AND ext = ? AND e2ee = 0').bind(c.user.id, attachmentId, ext).first()
  if (!own) return notFound()

  const now = Date.now()
  const [put] = await env.DB.batch([
    env.DB.prepare(UPSERT_SQL).bind(params.id, path, c.user.id, attachmentId, ext, blobSha, now, GITHUB_IMAGES_PER_DOC),
    dayUsageStatement(env.DB, c.user.id, now),
  ])
  if (put.meta.changes === 0) {
    if (!(await readLink(env, params.id, c.user.id))) return notFound()
    return jsonResponse({ error: 'too_many', limit: GITHUB_IMAGES_PER_DOC }, 409)
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}

// 연결이 없으면 null. filter 면 본문에 있는 경로만 (2.6)
export async function githubImageMapOf(env: Env, doc: DocBody, opts: { filter: boolean }): Promise<GithubImageMap | null> {
  const link = await env.DB.prepare('SELECT path FROM github_links WHERE doc_id = ? AND owner_id = ?').bind(doc.id, doc.owner_id).first<{ path: string }>()
  if (!link) return null
  const { results } = await env.DB.prepare('SELECT path, attachment_id, ext FROM github_images WHERE doc_id = ?')
    .bind(doc.id)
    .all<{ path: string; attachment_id: string; ext: string }>()
  const inBody = opts.filter ? repoImagePaths(doc.content, link.path) : null
  const rows = inBody ? results.filter((r) => inBody.has(r.path)) : results
  return { path: link.path, images: Object.fromEntries(rows.map((r) => [r.path, `${r.attachment_id}.${r.ext}`])) }
}

export async function handleGetGithubImages(request: Request, env: Env, _ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const access = await getDocAccess<DocRow>(env, params.id, user, 'id, owner_id, folder_id, content')
  if (!access) return notFound()
  const map = await githubImageMapOf(env, access.doc, { filter: access.role === 'view' })
  return map ? jsonResponse(map) : notFound()
}

function proxyHeaders(type: string, cacheControl = PROXY_CACHE_CONTROL): Headers {
  return new Headers({
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': PROXY_CSP,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Disposition': 'inline',
    'Cache-Control': cacheControl,
    'Referrer-Policy': 'no-referrer',
  })
}

// GitHub·클라이언트가 준 Content-Type 은 보지 않는다. SVG 는 확장자와 내용 둘 다 (2.5 10번)
function imageTypeOf(bytes: Uint8Array, path: string): string | null {
  const sniffed = sniffImage(bytes)
  if (sniffed) return IMAGE_MIME[sniffed.ext]
  if (!/\.svg$/i.test(path)) return null
  const head = String.fromCharCode(...bytes.subarray(0, SVG_SNIFF_BYTES))
  return /<svg/i.test(head) ? SVG_MIME : null
}

async function mappedImage(env: Env, docId: string, ownerId: string, path: string): Promise<Response | null> {
  const row = await env.DB.prepare(
    'SELECT a.id, a.ext, a.mime FROM github_images g JOIN attachments a ON a.owner_id = g.owner_id AND a.id = g.attachment_id AND a.ext = g.ext WHERE g.doc_id = ? AND g.path = ? AND g.owner_id = ? AND a.e2ee = 0',
  )
    .bind(docId, path, ownerId)
    .first<{ id: string; ext: string; mime: string }>()
  if (!row) return null
  const object = await env.BUCKET.get(`att/${ownerId}/${row.id}.${row.ext}`)
  if (!object) return null
  const res = attachmentResponse(object, row.mime, PROXY_CACHE_CONTROL)
  res.headers.set('Content-Security-Policy', PROXY_CSP)
  res.headers.set('Referrer-Policy', 'no-referrer')
  return res
}

// 2.5 3~11번. 권한(1·2번)은 부르는 쪽이 끝냈다
async function proxyImage(request: Request, env: Env, ctx: ExecutionContext, doc: DocBody, path: string): Promise<Response> {
  const link = await readLink(env, doc.id, doc.owner_id)
  if (!link || !repoImagePaths(doc.content, link.path).has(path)) return notFound()
  const mapped = await mappedImage(env, doc.id, doc.owner_id, path)
  if (mapped) return mapped

  const enabled = await loadEnabledGithub(env)
  if (!enabled) return notFound()
  const account = await env.DB.prepare('SELECT refresh_expires_at FROM github_accounts WHERE user_id = ?').bind(doc.owner_id).first<{ refresh_expires_at: number }>()
  if (!account || account.refresh_expires_at <= Date.now()) return notFound()

  const cache = typeof caches === 'undefined' ? null : caches.default
  const key = `${new URL(request.url).origin}/api/github-cache/${link.repo_id}/${encodeURIComponent(link.branch)}/${encodePathSegments(path)}`
  const hit = cache ? await cache.match(key) : undefined
  const hitType = hit?.headers.get('Content-Type')
  if (hit && hitType && PROXY_TYPES.has(hitType)) return new Response(hit.body, { headers: proxyHeaders(hitType) })

  const got = await githubFetch(env, enabled.config, doc.owner_id, contentsUrl(link.repo, path, link.branch), { headers: { Accept: RAW_ACCEPT } })
  if (isGithubFailure(got)) return notFound()
  if (!got.ok) {
    await got.body?.cancel()
    return notFound()
  }
  const bytes = await readCapped(got, GITHUB_PROXY_MAX_BYTES)
  if (!bytes) return notFound()
  const type = imageTypeOf(bytes, path)
  if (!type) return notFound()
  // private 사본은 Cache API 가 저장하지 않을 수 있어 넣을 때만 public (7장 2)
  if (cache) ctx.waitUntil(cache.put(key, new Response(bytes, { headers: proxyHeaders(type, 'public, max-age=300') })))
  return new Response(bytes, { headers: proxyHeaders(type) })
}

const pathParam = (request: Request) => new URL(request.url).searchParams.get('path')

export async function handleGithubImg(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const user = await requireUser(request, env)
  const path = pathParam(request)
  if (!isRepoFile(path)) return notFound()
  const access = await getDocAccess<DocRow>(env, params.id, user, 'id, owner_id, folder_id, content')
  if (!access) return notFound()
  return proxyImage(request, env, ctx, access.doc, path)
}

function publicDoc(env: Env, docId: string, ownerId: string): Promise<DocRow | null> {
  return env.DB.prepare('SELECT id, owner_id, folder_id, content FROM docs WHERE id = ? AND owner_id = ? AND e2ee_key IS NULL').bind(docId, ownerId).first<DocRow>()
}

// 검사 순서는 같은 자리의 공개 첨부 핸들러와 같다 (2.5 2번)
export async function handlePublicGithubImg(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const path = pathParam(request)
  if (!isRepoFile(path) || !isValidToken(params.token)) return notFound()
  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'doc') return notFound()
  const doc = await publicDoc(env, link.target_id, link.owner_id)
  return doc ? proxyImage(request, env, ctx, doc, path) : notFound()
}

export async function handlePublicDocSetGithubImg(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const path = pathParam(request)
  if (!isRepoFile(path) || !isValidToken(params.token)) return notFound()
  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'doc') return notFound()
  if (!(await isDocInLinkSet(env, params.token, link.target_id, params.docId))) return notFound()
  const doc = await publicDoc(env, params.docId, link.owner_id)
  return doc ? proxyImage(request, env, ctx, doc, path) : notFound()
}

export async function handlePublicFolderGithubImg(request: Request, env: Env, ctx: ExecutionContext, params: Record<string, string>): Promise<Response> {
  const path = pathParam(request)
  if (!isRepoFile(path) || !isValidToken(params.token)) return notFound()
  const link = await findPublicLink(env, params.token)
  if (!link || link.target_type !== 'folder') return notFound()
  const doc = await publicDoc(env, params.docId, link.owner_id)
  if (!doc) return notFound()
  const treeIds = await folderTreeIds(env, link.target_id, link.owner_id)
  if (!doc.folder_id || !treeIds.includes(doc.folder_id)) return notFound()
  return proxyImage(request, env, ctx, doc, path)
}

// 원문 글자 참조면 D1 읽기 없이 참, 아니면 본문에 있는 경로의 대응 (3.1)
export async function isDocAttachmentRef(env: Env, doc: { id: string; content: string }, attachmentId: string): Promise<boolean> {
  if (extractAttachmentRefs(doc.content).has(attachmentId)) return true
  const { results } = await env.DB.prepare(
    'SELECT g.path, l.path AS md_path FROM github_images g JOIN github_links l ON l.doc_id = g.doc_id WHERE g.doc_id = ? AND g.attachment_id = ?',
  )
    .bind(doc.id, attachmentId)
    .all<{ path: string; md_path: string }>()
  if (results.length === 0) return false
  const inBody = repoImagePaths(doc.content, results[0].md_path)
  return results.some((r) => inBody.has(r.path))
}

// 내 대응 행 중 본문에 있는 경로가 이 첨부를 쓰면 참 (3.2)
export async function isGithubImageInUse(env: Env, ownerId: string, attachmentId: string): Promise<boolean> {
  const { results } = await env.DB.prepare(
    'SELECT g.doc_id, g.path, l.path AS md_path, d.content FROM github_images g JOIN github_links l ON l.doc_id = g.doc_id JOIN docs d ON d.id = g.doc_id WHERE g.owner_id = ? AND g.attachment_id = ?',
  )
    .bind(ownerId, attachmentId)
    .all<{ doc_id: string; path: string; md_path: string; content: string }>()
  const byDoc = new Map<string, Set<string>>()
  for (const row of results) {
    const inBody = byDoc.get(row.doc_id) ?? repoImagePaths(row.content, row.md_path)
    byDoc.set(row.doc_id, inBody)
    if (inBody.has(row.path)) return true
  }
  return false
}

export type StaleGithubImage = { doc_id: string; path: string; created_at: number }

// 3.3 (C) — 지금 있는 행의 첨부는 모두 refs 에. 정리할 행 = 연결 없음, 또는 본문에 없고 threshold 전
export async function collectGithubImageRefs(env: Env, refs: Set<string>, threshold: number): Promise<StaleGithubImage[]> {
  const stale: StaleGithubImage[] = []
  let afterId = ''
  for (;;) {
    const { results: docs } = await env.DB.prepare(
      'SELECT d.id, d.content, l.path AS md_path FROM docs d LEFT JOIN github_links l ON l.doc_id = d.id WHERE d.id > ? AND EXISTS (SELECT 1 FROM github_images g WHERE g.doc_id = d.id) ORDER BY d.id LIMIT ?',
    )
      .bind(afterId, GC_PAGE_SIZE)
      .all<{ id: string; content: string; md_path: string | null }>()
    if (docs.length === 0) break
    const lastId = docs[docs.length - 1].id
    // 쪽이 id 로 이어져 있어 범위 질의가 그 문서들의 행을 모두 잡는다 — IN (…) 바인딩 한도를 피한다
    const { results: rows } = await env.DB.prepare('SELECT doc_id, path, attachment_id, created_at FROM github_images WHERE doc_id > ? AND doc_id <= ?')
      .bind(afterId, lastId)
      .all<StaleGithubImage & { attachment_id: string }>()
    const byId = new Map(docs.map((d) => [d.id, d]))
    const inBody = new Map<string, Set<string>>()
    for (const row of rows) {
      refs.add(row.attachment_id)
      const doc = byId.get(row.doc_id)
      if (!doc || doc.md_path === null) {
        stale.push({ doc_id: row.doc_id, path: row.path, created_at: row.created_at })
        continue
      }
      const paths = inBody.get(doc.id) ?? repoImagePaths(doc.content, doc.md_path)
      inBody.set(doc.id, paths)
      if (!paths.has(row.path) && row.created_at < threshold) stale.push({ doc_id: row.doc_id, path: row.path, created_at: row.created_at })
    }
    if (docs.length < GC_PAGE_SIZE) break
    afterId = lastId
  }
  return stale
}

// 3.3 (D) — 실행당 500행. created_at 이 바뀐 행(그사이 다시 대응됨)은 지우지 않는다
export async function deleteGithubImageRows(env: Env, rows: StaleGithubImage[]): Promise<number> {
  let deleted = 0
  const picked = rows.slice(0, GC_MAX_ROWS)
  for (let i = 0; i < picked.length; i += GC_BATCH) {
    const results = await env.DB.batch(
      picked
        .slice(i, i + GC_BATCH)
        .map((r) => env.DB.prepare('DELETE FROM github_images WHERE doc_id = ? AND path = ? AND created_at = ?').bind(r.doc_id, r.path, r.created_at)),
    )
    for (const result of results) deleted += result.meta.changes
  }
  return deleted
}
