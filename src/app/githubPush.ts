// GitHub 푸시 순수 규칙 — 몸통 만들기·문구·push-plan → blobs → push 순서 (specs/features/F-2130.md 3장)
import { GITHUB_BLOB_MAX_BYTES, GITHUB_PUSH_MAX_IMAGES, type GithubBlobCreated, type GithubPushBody, type GithubPushed, type GithubPushPlan } from '../lib/githubContract'
import type { GithubResult } from './githubApi'
import { githubErrorMessage, type GithubFailure } from './githubUi'

export type PushStep = { kind: 'md' } | { kind: 'image'; index: number; total: number } | { kind: 'commit' }
export type PushDeps = {
  plan(names: string[]): Promise<GithubResult<GithubPushPlan>>
  blob(body: string): Promise<GithubResult<GithubBlobCreated>>
  push(body: GithubPushBody): Promise<GithubResult<GithubPushed>>
  readAttachment(name: string): Promise<Uint8Array | null>
  progress(step: PushStep): void
}
export type PushOutcome =
  | { kind: 'pushed'; sha: string; commitUrl: string | null; left: number }
  | { kind: 'conflict'; gone: boolean }
  | { kind: 'failed'; message: string }

export const PUSH_OFFLINE_MESSAGE = '온라인일 때 푸시할 수 있습니다'
export const PUSH_MAX_REFS = 1000

const REF_RE = /attachments\/([0-9a-f]{16}\.(?:png|jpg|gif|webp))/g

export function pushImageNames(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(REF_RE)) seen.add(m[1])
  return [...seen]
}

export function pushMdBytes(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text)
  if (!bom) return body
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(body, 3)
  return out
}

export function blobBody(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x2000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x2000))
  return JSON.stringify({ encoding: 'base64', content: btoa(bin) })
}

export function readConflict(r: GithubFailure): { gone: boolean } | null {
  if (r.status !== 409 || r.error !== 'github_conflict') return null
  const b = r.body
  const gone = typeof b === 'object' && b !== null && 'remoteSha' in b && (b as { remoteSha: unknown }).remoteSha === null
  return { gone }
}

export function pushFailureMessage(r: GithubFailure): string {
  if (r.error === 'github_empty_repo') return '빈 저장소에는 푸시할 수 없습니다. GitHub에서 파일을 하나 만든 뒤 다시 해 주세요'
  if (r.error === 'github_forbidden') return 'GitHub에서 이 브랜치에 쓸 수 없습니다. 브랜치 보호 규칙과 권한을 확인해 주세요'
  return githubErrorMessage(r)
}

export function planSummary(plan: GithubPushPlan): { newLine: string; skippedLine: string | null } {
  const n = plan.missing.length
  const newLine =
    n === 0 ? '새 그림 없음' : n <= GITHUB_PUSH_MAX_IMAGES ? `새 그림 ${n}장` : `새 그림 ${n}장 — 이번에 ${GITHUB_PUSH_MAX_IMAGES}장, 나머지는 다음 푸시에 올라갑니다`
  const m = plan.skipped.length
  return { newLine, skippedLine: m === 0 ? null : `올리지 않는 그림 ${m}장 (금고 그림이거나 아직 서버에 올라가지 않은 그림)` }
}

export function pushedNotice(o: Extract<PushOutcome, { kind: 'pushed' }>): string {
  if (o.commitUrl === null) return 'GitHub 파일과 같습니다'
  return o.left > 0 ? `푸시했습니다. 남은 그림 ${o.left}장은 한 번 더 푸시하면 올라갑니다` : '푸시했습니다'
}

async function sendBlob(deps: PushDeps, body: string): Promise<GithubResult<GithubBlobCreated>> {
  const r = await deps.blob(body)
  if (r.ok || (r.status !== 502 && r.status !== 0)) return r
  return deps.blob(body)
}

const failed = (r: GithubFailure): PushOutcome => {
  const c = readConflict(r)
  return c ? { kind: 'conflict', gone: c.gone } : { kind: 'failed', message: pushFailureMessage(r) }
}

export async function runGithubPush(input: { md: Uint8Array; names: string[]; message: string }, deps: PushDeps): Promise<PushOutcome> {
  if (input.names.length > PUSH_MAX_REFS) return { kind: 'failed', message: '그림이 너무 많아 푸시할 수 없습니다 (최대 1,000장)' }
  const plan = await deps.plan(input.names)
  if (!plan.ok) return failed(plan)
  deps.progress({ kind: 'md' })
  const mdBody = blobBody(input.md)
  if (mdBody.length > GITHUB_BLOB_MAX_BYTES) return { kind: 'failed', message: 'GitHub 파일이 너무 큽니다 (최대 1MB)' }
  const md = await sendBlob(deps, mdBody)
  if (!md.ok) return failed(md)
  const batch = plan.value.missing.slice(0, GITHUB_PUSH_MAX_IMAGES)
  const images: GithubPushBody['images'] = []
  for (const [i, name] of batch.entries()) {
    deps.progress({ kind: 'image', index: i + 1, total: batch.length })
    const bytes = await deps.readAttachment(name).catch(() => null)
    const body = bytes ? blobBody(bytes) : null
    if (body === null || body.length > GITHUB_BLOB_MAX_BYTES) return { kind: 'failed', message: `그림을 읽지 못해 푸시하지 않았습니다 (${name})` }
    const r = await sendBlob(deps, body)
    if (!r.ok) return failed(r)
    images.push({ name, sha: r.value.sha })
  }
  deps.progress({ kind: 'commit' })
  const pushed = await deps.push({ message: input.message.trim(), mdSha: md.value.sha, images })
  if (!pushed.ok) return failed(pushed)
  return { kind: 'pushed', sha: pushed.value.sha, commitUrl: pushed.value.commitUrl, left: Math.max(0, plan.value.missing.length - GITHUB_PUSH_MAX_IMAGES) }
}
