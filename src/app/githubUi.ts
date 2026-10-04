// GitHub 연결·가져오기 화면의 순수 규칙·문구 (specs/features/F-2128.md 3.2, 5장)
import { GITHUB_ERROR_PARAM, GITHUB_RETURN_PARAM, type GithubStatus } from '../lib/githubContract'
import { isRepoMdPath } from '../lib/githubPath'
import { ACCOUNT_BLOCKED_MESSAGE } from '../lib/usageLimits'

export const GITHUB_RESUME_KEY = 'md.githubResume'
export const GITHUB_RESUME_TTL_MS = 1_800_000
export const GITHUB_LINK_FRESH_MS = 60_000
export const GITHUB_UNTITLED = '제목 없는 문서'

export type GithubResume = { kind: 'import' } | { kind: 'link'; docId: string }
export type GithubFailure = { status: number; error: string | null; body: unknown }

export function parseGithubStatus(raw: unknown): GithubStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.enabled !== 'boolean' || typeof r.connected !== 'boolean') return null
  const month = r.month as Record<string, unknown> | null | undefined
  if (!month || typeof month !== 'object' || typeof month.used !== 'number') return null
  if (month.limit !== null && typeof month.limit !== 'number') return null
  const status: GithubStatus = { enabled: r.enabled, connected: r.connected, month: { used: month.used, limit: month.limit } }
  if (typeof r.login === 'string') status.login = r.login
  if (typeof r.reconnect === 'boolean') status.reconnect = r.reconnect
  if (typeof r.installUrl === 'string') status.installUrl = r.installUrl
  return status
}

export function githubDocRole(doc: { role?: 'owner' | 'edit' | 'view'; e2ee?: unknown } | null): 'owner' | 'editor' | null {
  if (!doc || doc.e2ee) return null
  if (doc.role === undefined || doc.role === 'owner') return 'owner'
  return doc.role === 'edit' ? 'editor' : null
}

export function githubConnectUrl(hash: string): string {
  return '/api/github/connect?return=' + encodeURIComponent(hash || '#/')
}

export function readGithubReturn(search: string): { kind: 'connected' } | { kind: 'error'; code: string } | null {
  const params = new URLSearchParams(search)
  if (params.get(GITHUB_RETURN_PARAM) === 'connected') return { kind: 'connected' }
  const code = params.get(GITHUB_ERROR_PARAM)
  return code ? { kind: 'error', code } : null
}

export function urlWithoutGithubParams(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search)
  params.delete(GITHUB_RETURN_PARAM)
  params.delete(GITHUB_ERROR_PARAM)
  const rest = params.toString()
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`
}

export function resumeMarker(r: GithubResume, userId: string, now: number): string {
  return JSON.stringify({ ...r, userId, at: now })
}

export function decideGithubResume(raw: string | null, userId: string, now: number): GithubResume | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const m = parsed as { kind?: unknown; docId?: unknown; userId?: unknown; at?: unknown }
  if (m.userId !== userId || typeof m.at !== 'number' || now - m.at >= GITHUB_RESUME_TTL_MS) return null
  if (m.kind === 'import') return { kind: 'import' }
  if (m.kind === 'link' && typeof m.docId === 'string') return { kind: 'link', docId: m.docId }
  return null
}

const UNAVAILABLE = 'GitHub에 연결하지 못했습니다. 잠시 뒤에 다시 해 주세요'
export const GITHUB_TOO_LARGE_MESSAGE = 'GitHub 파일이 너무 큽니다 (최대 1MB)'
export const GITHUB_RECONNECT_MESSAGE = 'GitHub 연결이 만료됐습니다. 다시 연결해 주세요'

function quotaMessage(body: unknown): string {
  const b = (body ?? {}) as { limit?: unknown; resetAt?: unknown }
  if (typeof b.limit !== 'number' || typeof b.resetAt !== 'number') return UNAVAILABLE
  return `이번 달 GitHub 사용 ${b.limit}회를 모두 썼습니다. ${new Date(b.resetAt).getUTCMonth() + 1}월 1일에 다시 쓸 수 있습니다`
}

export function githubErrorMessage(r: GithubFailure): string {
  switch (r.error) {
    case 'github_disabled': return '지금은 GitHub 기능을 쓸 수 없습니다'
    case 'github_reconnect': return GITHUB_RECONNECT_MESSAGE
    case 'github_quota': return quotaMessage(r.body)
    case 'github_rate_limited': return 'GitHub 요청이 많아 잠시 뒤에 다시 해 주세요'
    case 'too_large': return GITHUB_TOO_LARGE_MESSAGE
    case 'e2ee': return '금고 문서는 GitHub에 연결할 수 없습니다'
    case 'github_forbidden': return 'GitHub에서 이 저장소에 쓸 수 없습니다'
    case 'github_not_found': return 'GitHub에서 찾지 못했습니다. 저장소·브랜치·경로를 확인해 주세요'
    case 'github_target_taken': return '이 GitHub 파일은 이미 다른 문서에 연결돼 있습니다'
    case 'account_blocked': return ACCOUNT_BLOCKED_MESSAGE
    case 'rate_limited': return '요청이 많아 잠시 뒤에 다시 해 주세요'
    default: return UNAVAILABLE
  }
}

export function githubConnectErrorMessage(code: string): string {
  switch (code) {
    case 'denied': return 'GitHub 연결을 취소했습니다'
    case 'state': return 'GitHub 연결이 중간에 끊겼습니다. 다시 해 주세요'
    case 'github_taken': return '이 GitHub 계정은 이미 다른 계정에 연결돼 있습니다'
    case 'disabled': return '지금은 GitHub 기능을 쓸 수 없습니다'
    default: return UNAVAILABLE
  }
}

export function githubDocTitle(path: string): string {
  const name = (path.split('/').pop() ?? '').replace(/\.(md|markdown)$/i, '')
  return name === '' ? GITHUB_UNTITLED : name
}

export function decodeGithubContent(content: string): Uint8Array {
  const bin = atob(content)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function branchChoices(branches: readonly string[], defaultBranch: string): string[] {
  return branches.includes(defaultBranch) ? [...branches] : [defaultBranch, ...branches]
}

export function linkTargetPath(dir: string, name: string): string | null {
  const n = name.trim()
  if (n === '' || n.includes('/')) return null
  const path = dir === '' ? n : `${dir}/${n}`
  return isRepoMdPath(path) ? path : null
}
