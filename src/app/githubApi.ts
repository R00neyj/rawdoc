// GitHub 계정·저장소·연결 API 호출 — 던지지 않고 결과 값으로 돌려준다 (specs/features/F-2128.md 3.1)
import type { GithubBranchList, GithubFile, GithubLink, GithubLinkPut, GithubPulled, GithubRepoList, GithubStatus, GithubSyncedBody, GithubTree } from '../lib/githubContract'
import type { GithubBlobCreated, GithubPushBody, GithubPushed, GithubPushPlan } from '../lib/githubContract'
import type { GithubImageMap, GithubImagePut, GithubImageSources, GithubImageSourcesBody } from '../lib/githubContract'
import { parseGithubStatus } from './githubUi'
import { parseGithubImageMap } from './githubImages'

export type GithubResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string | null; body: unknown }

async function call<T>(url: string, init: RequestInit | undefined, read: (body: unknown) => T | null): Promise<GithubResult<T>> {
  let res: Response
  try {
    res = await fetch(url, { credentials: 'same-origin', redirect: 'manual', ...init })
  } catch {
    return { ok: false, status: 0, error: null, body: null }
  }
  let body: unknown = null
  if (res.status !== 204) {
    try {
      body = await res.json()
    } catch {
      body = null
    }
  }
  if (res.ok) {
    const value = read(body)
    if (value !== null) return { ok: true, value }
    return { ok: false, status: res.status, error: null, body }
  }
  const error = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : null
  return { ok: false, status: res.status, error, body }
}

const asObject = <T>(body: unknown): T | null => (body && typeof body === 'object' && !Array.isArray(body) ? (body as T) : null)
const asList = <T extends { truncated: boolean }>(key: string) => (body: unknown): T | null => {
  const o = asObject<Record<string, unknown>>(body)
  return o && Array.isArray(o[key]) && typeof o.truncated === 'boolean' ? (o as unknown as T) : null
}
const asLink = (body: unknown): GithubLink | null => {
  const o = asObject<GithubLink>(body)
  return o && typeof o.repo === 'string' && typeof o.path === 'string' ? o : null
}
const asFile = (body: unknown): GithubFile | null => {
  const o = asObject<GithubFile>(body)
  return o && typeof o.content === 'string' && typeof o.sha === 'string' && typeof o.size === 'number' ? o : null
}
const asPulled = (body: unknown): GithubPulled | null => {
  const o = asObject<GithubPulled>(body)
  return o && typeof o.content === 'string' && typeof o.sha === 'string' && typeof o.size === 'number' ? { sha: o.sha, size: o.size, content: o.content } : null
}
const asEmpty = (): true => true
const json = (method: string, payload: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
const q = (params: Record<string, string>) => new URLSearchParams(params).toString()

export const fetchGithubStatus = (): Promise<GithubResult<GithubStatus>> => call('/api/github/status', undefined, parseGithubStatus)
export const fetchGithubRepos = (): Promise<GithubResult<GithubRepoList>> => call('/api/github/repos', undefined, asList<GithubRepoList>('repos'))
export const fetchGithubBranches = (repo: string): Promise<GithubResult<GithubBranchList>> => call(`/api/github/branches?${q({ repo })}`, undefined, asList<GithubBranchList>('branches'))
export const fetchGithubTree = (repo: string, branch: string, dir: string): Promise<GithubResult<GithubTree>> => call(`/api/github/tree?${q({ repo, branch, dir })}`, undefined, asList<GithubTree>('entries'))
export const postGithubFile = (p: { repo: string; branch: string; path: string }): Promise<GithubResult<GithubFile>> => call('/api/github/file', json('POST', p), asFile)
export const getDocGithub = (id: string): Promise<GithubResult<GithubLink>> => call(`/api/docs/${encodeURIComponent(id)}/github`, undefined, asLink)
export const putDocGithub = (id: string, put: GithubLinkPut): Promise<GithubResult<GithubLink>> => call(`/api/docs/${encodeURIComponent(id)}/github`, json('PUT', put), asLink)
export const deleteDocGithub = (id: string): Promise<GithubResult<true>> => call(`/api/docs/${encodeURIComponent(id)}/github`, { method: 'DELETE' }, asEmpty)
export const deleteGithubAccount = (): Promise<GithubResult<true>> => call('/api/github/account', { method: 'DELETE' }, asEmpty)
export const postDocGithubPull = (id: string): Promise<GithubResult<GithubPulled>> => call(`/api/docs/${encodeURIComponent(id)}/github/pull`, { method: 'POST' }, asPulled)
export const postDocGithubSynced = (id: string, body: GithubSyncedBody): Promise<GithubResult<true>> => call(`/api/docs/${encodeURIComponent(id)}/github/synced`, json('POST', body), asEmpty)

// F-2130 푸시 — push-plan → blobs → push (F-3016)
const docGithub = (id: string, tail: string) => `/api/docs/${encodeURIComponent(id)}/github/${tail}`
const asPlan = (body: unknown): GithubPushPlan | null => {
  const o = asObject<GithubPushPlan>(body)
  return o && Array.isArray(o.missing) && Array.isArray(o.skipped) ? o : null
}
const asBlob = (body: unknown): GithubBlobCreated | null => {
  const o = asObject<GithubBlobCreated>(body)
  return o && typeof o.sha === 'string' ? o : null
}
const asPushed = (body: unknown): GithubPushed | null => {
  const o = asObject<GithubPushed>(body)
  return o && typeof o.sha === 'string' ? o : null
}
export const postDocGithubPlan = (id: string, attachments: string[]): Promise<GithubResult<GithubPushPlan>> => call(docGithub(id, 'push-plan'), json('POST', { attachments }), asPlan)
export const postDocGithubBlob = (id: string, body: string): Promise<GithubResult<GithubBlobCreated>> =>
  call(docGithub(id, 'blobs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, asBlob)
export const postDocGithubPush = (id: string, body: GithubPushBody): Promise<GithubResult<GithubPushed>> => call(docGithub(id, 'push'), json('POST', body), asPushed)

// F-2131 저장소 그림 — 출처 찾기·받기·대응 기록·대응표 (F-3017 2장)
const asSources = (body: unknown): GithubImageSources | null => {
  const o = asObject<GithubImageSources>(body)
  if (!o || !Array.isArray(o.sources) || typeof o.truncated !== 'boolean') return null
  const sources = o.sources.filter((s) => s && typeof s.path === 'string' && typeof s.sha === 'string' && typeof s.size === 'number' && typeof s.mapped === 'boolean')
  return { sources, truncated: o.truncated }
}
export const postDocGithubImageSources = (id: string, body: GithubImageSourcesBody): Promise<GithubResult<GithubImageSources>> => call(docGithub(id, 'image-sources'), json('POST', body), asSources)
export const putDocGithubImage = (id: string, body: GithubImagePut): Promise<GithubResult<true>> => call(docGithub(id, 'images'), json('PUT', body), asEmpty)
export const getDocGithubImages = (id: string): Promise<GithubResult<GithubImageMap>> => call(docGithub(id, 'images'), undefined, parseGithubImageMap)

// 몸통이 JSON 이 아니라 바이트다 — 실패만 call 과 같은 꼴로
export async function getDocGithubRaw(id: string, path: string): Promise<GithubResult<Uint8Array>> {
  let res: Response
  try {
    res = await fetch(docGithub(id, `raw?path=${encodeURIComponent(path)}`), { credentials: 'same-origin', redirect: 'manual' })
    if (res.ok) return { ok: true, value: new Uint8Array(await res.arrayBuffer()) }
  } catch {
    return { ok: false, status: 0, error: null, body: null }
  }
  const body: unknown = await res.json().catch(() => null)
  const error = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : null
  return { ok: false, status: res.status, error, body }
}
