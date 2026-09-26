// 계정 삭제 — API 호출 둘, 다시 열기 표지, 이 기기 정리 순서 (specs/features/F-2038.md 6·7장). DOM 없이 도는 함수만
import { ACCOUNT_DELETE_FRESH_MS, type AccountDeletePreview } from '../lib/accountDeletion'
import type { AccountState } from './account'

// sessionStorage 키 — 제품명 없음. prefs.ts 는 localStorage 전용이라 거치지 않는다 (6.5)
export const ACCOUNT_DELETE_MARKER_KEY = 'md.accountDelete'
export const ACCOUNT_DELETE_DONE_MARKER = JSON.stringify({ step: 'done' })
export const AFTER_ACCOUNT_DELETE_URL = '/?app=1'
export const CLEANUP_WAIT_MS = 3_000

export function resumeMarker(userId: string, now: number): string {
  return JSON.stringify({ step: 'resume', userId, at: now })
}

export function reauthLoginUrl(hash: string): string {
  return `/login?return=${encodeURIComponent(hash)}&reauth=1`
}

export type MarkerDecision = { action: 'open' | 'warn' | 'done' | 'none'; clear: boolean }

// 6.5 부팅 판정 — offline 이면 resume 을 남겨 다음 in 을 기다린다
export function decideAccountDeleteMarker(raw: string | null, account: AccountState, now: number): MarkerDecision {
  if (raw === null) return { action: 'none', clear: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { action: 'none', clear: true }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { action: 'none', clear: true }
  const marker = parsed as { step?: unknown; userId?: unknown; at?: unknown }
  if (marker.step === 'done') return { action: 'done', clear: true }
  if (marker.step !== 'resume' || typeof marker.userId !== 'string' || typeof marker.at !== 'number') return { action: 'none', clear: true }
  if (account.state === 'offline') return { action: 'none', clear: false }
  if (account.state === 'out') return { action: 'none', clear: true }
  if (marker.userId !== account.id) return { action: 'warn', clear: true }
  if (now - marker.at >= ACCOUNT_DELETE_FRESH_MS) return { action: 'none', clear: true }
  return { action: 'open', clear: true }
}

export type PreviewResult = { kind: 'ok'; preview: AccountDeletePreview } | { kind: 'out' } | { kind: 'offline' } | { kind: 'failed' }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

function toPreview(raw: unknown): AccountDeletePreview | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const att = r.attachments as Record<string, unknown> | null | undefined
  if (typeof r.email !== 'string') return null
  if (![r.docs, r.e2eeDocs, r.sharedDocs, r.folders, r.tokens].every(isCount)) return null
  if (!att || typeof att !== 'object' || !isCount(att.count) || !isCount(att.bytes)) return null
  if (typeof r.fresh !== 'boolean') return null
  if (r.freshUntil !== null && !isCount(r.freshUntil)) return null
  return {
    email: r.email,
    docs: r.docs as number,
    e2eeDocs: r.e2eeDocs as number,
    sharedDocs: r.sharedDocs as number,
    folders: r.folders as number,
    attachments: { count: att.count, bytes: att.bytes },
    tokens: r.tokens as number,
    fresh: r.fresh,
    freshUntil: r.freshUntil as number | null,
  }
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)

export async function fetchAccountPreview(fetchImpl: typeof fetch = defaultFetch): Promise<PreviewResult> {
  let res: Response
  try {
    res = await fetchImpl('/api/account', { credentials: 'same-origin', redirect: 'manual' })
  } catch {
    return { kind: 'offline' }
  }
  if (res.status === 401) return { kind: 'out' }
  if (!res.ok) return { kind: 'failed' }
  try {
    const preview = toPreview(await res.json())
    return preview ? { kind: 'ok', preview } : { kind: 'failed' }
  } catch {
    return { kind: 'failed' }
  }
}

export type DeleteResult = 'ok' | 'reauth' | 'network' | 'failed'

// 401 도 reauth — 판정 사이에 세션이 사라졌다. 다시 로그인하면 된다 (6.2)
export async function requestAccountDelete(fetchImpl: typeof fetch = defaultFetch): Promise<DeleteResult> {
  let res: Response
  try {
    res = await fetchImpl('/api/account', { method: 'DELETE', credentials: 'same-origin', redirect: 'manual' })
  } catch {
    return 'network'
  }
  if (res.status === 204) return 'ok'
  if (res.status === 401) return 'reauth'
  if (res.status === 403) {
    try {
      const body = (await res.json()) as { error?: unknown }
      if (body.error === 'reauth_required') return 'reauth'
    } catch {
      return 'failed'
    }
  }
  return 'failed'
}

// 6.4 — 둘 중 하나라도 읽지 못하면 참(안내를 보인다)
export async function hasUnsyncedChanges(readers: { outboxCount: () => Promise<number>; unsyncedDocCount: () => Promise<number> }): Promise<boolean> {
  const results = await Promise.allSettled([readers.outboxCount(), readers.unsyncedDocCount()])
  return results.some((r) => r.status === 'rejected' || r.value > 0)
}

export type CleanupDeps = {
  lockVault: () => void
  clearRemoteCache: () => Promise<void>
  clearYjs: () => Promise<void>
  clearE2eeRow: () => Promise<void>
  setPref: (key: 'md.account' | 'md.lastDocId', value: string) => void
  writeMarker: (value: string) => void
  navigate: (url: string) => void
  waitMs?: number
}

// 7.2 순서 — 서버는 이미 지웠으므로 정리가 실패하거나 늦어도 되돌리지 않는다
export async function cleanUpAfterAccountDelete(deps: CleanupDeps): Promise<void> {
  deps.lockVault()
  const quiet = (task: () => Promise<void>) =>
    Promise.resolve()
      .then(task)
      .catch((err: unknown) => console.error('account_delete_cleanup_failed', err))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deps.waitMs ?? CLEANUP_WAIT_MS)
  })
  await Promise.race([Promise.all([quiet(deps.clearRemoteCache), quiet(deps.clearYjs), quiet(deps.clearE2eeRow)]), timeout])
  clearTimeout(timer)
  deps.setPref('md.account', '')
  deps.setPref('md.lastDocId', '')
  deps.writeMarker(ACCOUNT_DELETE_DONE_MARKER)
  deps.navigate(AFTER_ACCOUNT_DELETE_URL)
}
