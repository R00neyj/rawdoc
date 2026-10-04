// 저장소 그림 리졸버·받아 넣기 — 순수 함수와 의존 주입 (specs/features/F-2131.md 2장·5장)
import { GITHUB_IMAGE_SOURCES_MAX_PATHS, type GithubImageMap, type GithubImagePut, type GithubImageSource, type GithubImageSources } from '../lib/githubContract'
import { isRepoMdPath, repoImagePaths, resolveRepoPath } from '../lib/githubPath'
import type { ImageExt } from '../lib/imageBlock'
import { inspectImageBytes } from '../lib/imageFile'
import type { ImageTarget, ResolveImagePath } from '../lib/imageMarkdown'
import type { GithubResult } from './githubApi'

export type GithubImageScope =
  | { kind: 'doc'; docId: string }
  | { kind: 'pub'; token: string }
  | { kind: 'pubSet'; token: string; docId: string }
  | { kind: 'pubFolder'; token: string; docId: string }

export const GITHUB_IMAGE_IMPORT_MAX = 50
export const GITHUB_IMAGE_IMPORT_CONCURRENCY = 2
export const GITHUB_IMAGE_IMPORT_MAX_BYTES = 5_242_880 // worker MAX_ATTACHMENT_BYTES

const ATTACHMENT_RE = /^([0-9a-f]{16})\.(png|jpg|gif|webp)$/
const enc = encodeURIComponent

export function githubProxySrc(scope: GithubImageScope, repoPath: string): string {
  const q = `?path=${enc(repoPath)}`
  if (scope.kind === 'doc') return `/api/docs/${enc(scope.docId)}/github/img${q}`
  if (scope.kind === 'pub') return `/pub/docs/${enc(scope.token)}/gh${q}`
  if (scope.kind === 'pubSet') return `/pub/docs/${enc(scope.token)}/docs/${enc(scope.docId)}/gh${q}`
  return `/pub/folders/${enc(scope.token)}/docs/${enc(scope.docId)}/gh${q}`
}

export function parseGithubImageMap(raw: unknown): GithubImageMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { path, images } = raw as { path?: unknown; images?: unknown }
  if (!isRepoMdPath(path) || !images || typeof images !== 'object' || Array.isArray(images)) return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(images)) {
    if (typeof value === 'string' && ATTACHMENT_RE.test(value)) out[key] = value
  }
  return { path, images: out }
}

// 리졸버는 CM 갱신마다 문서 전체 이미지 줄을 다시 묻는다 — url 별로 메모한다 (r7)
export function githubImageResolver(map: GithubImageMap, scope: GithubImageScope): ResolveImagePath {
  const memo = new Map<string, ImageTarget | null>()
  return (url) => {
    const hit = memo.get(url)
    if (hit !== undefined) return hit
    const p = resolveRepoPath(map.path, url)
    const m = p === null ? null : ATTACHMENT_RE.exec(map.images[p] ?? '')
    const target: ImageTarget | null = p === null ? null : m ? { id: m[1], ext: m[2] as ImageExt } : { repoPath: p, src: githubProxySrc(scope, p) }
    memo.set(url, target)
    return target
  }
}

export function githubAttachmentOf(map: GithubImageMap, id: string): { ext: ImageExt } | null {
  for (const value of Object.values(map.images)) {
    const m = ATTACHMENT_RE.exec(value)
    if (m && m[1] === id) return { ext: m[2] as ImageExt }
  }
  return null
}

export function randomAttachmentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function planGithubImageImport(sources: GithubImageSource[]): GithubImageSource[] {
  return sources.filter((s) => !s.mapped && !/\.svg$/i.test(s.path) && s.size <= GITHUB_IMAGE_IMPORT_MAX_BYTES).slice(0, GITHUB_IMAGE_IMPORT_MAX)
}

export type GithubImageImportDeps = {
  imageSources: (paths: string[]) => Promise<GithubResult<GithubImageSources>>
  raw: (path: string) => Promise<GithubResult<Uint8Array>>
  putImage: (body: GithubImagePut) => Promise<GithubResult<true>>
  toWebp: (blob: Blob) => Promise<Blob>
  upload: (id: string, ext: ImageExt, blob: Blob) => Promise<unknown>
  newId: () => string
  onMapped: (path: string, attachment: string) => void
  signal?: AbortSignal
}

type Stop = 'sources' | 'quota' | 'rate' | 'blocked' | 'too_many' | 'not_found' | 'aborted'
export type GithubImageImportResult = { mapped: number; skipped: number; stopped: Stop | null }

const UPLOAD_STOPS: Record<string, Stop> = { quota_exceeded: 'quota', rate_limited: 'rate', account_blocked: 'blocked' }

async function importOne(source: GithubImageSource, deps: GithubImageImportDeps): Promise<'mapped' | 'skipped' | Stop> {
  const raw = await deps.raw(source.path)
  if (!raw.ok) return 'skipped'
  const info = inspectImageBytes(raw.value)
  if (!info) return 'skipped'
  const original = new Blob([raw.value as Uint8Array<ArrayBuffer>], { type: info.mime })
  let blob = original
  let ext = info.ext
  if (ext !== 'gif' && ext !== 'webp') {
    blob = await deps.toWebp(original)
    if (blob !== original) ext = 'webp'
  }
  const id = deps.newId()
  try {
    await deps.upload(id, ext, blob)
  } catch (err) {
    return UPLOAD_STOPS[(err as { kind?: string } | null)?.kind ?? ''] ?? 'skipped'
  }
  const attachment = `${id}.${ext}`
  const put = await deps.putImage({ path: source.path, blobSha: source.sha, attachment })
  if (!put.ok) {
    if (put.status === 409 && put.error === 'too_many') return 'too_many'
    return put.status === 404 ? 'not_found' : 'skipped'
  }
  deps.onMapped(source.path, attachment)
  return 'mapped'
}

// 멈춤이 걸리면 남은 것은 시작하지 않고 진행 중인 것은 끝낸다 (5.2 5번)
export async function runGithubImageImport(input: { content: string; mdPath: string }, deps: GithubImageImportDeps): Promise<GithubImageImportResult> {
  const result: GithubImageImportResult = { mapped: 0, skipped: 0, stopped: null }
  const paths = [...repoImagePaths(input.content, input.mdPath)].slice(0, GITHUB_IMAGE_SOURCES_MAX_PATHS)
  if (paths.length === 0) return result
  const sources = await deps.imageSources(paths)
  if (!sources.ok) return { ...result, stopped: 'sources' }
  const plan = planGithubImageImport(sources.value.sources)
  let next = 0
  const worker = async () => {
    while (result.stopped === null && next < plan.length) {
      if (deps.signal?.aborted) {
        result.stopped = 'aborted'
        return
      }
      const outcome = await importOne(plan[next++], deps)
      if (outcome === 'mapped') result.mapped++
      else if (outcome === 'skipped') result.skipped++
      else result.stopped ??= outcome
    }
  }
  await Promise.all(Array.from({ length: GITHUB_IMAGE_IMPORT_CONCURRENCY }, worker))
  return result
}
