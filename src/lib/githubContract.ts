// GitHub 연결 계약 — 서버·앱 공용 타입·질의 이름·달 계산 (specs/features/F-3014.md 6장). 순수, import 없음

export type GithubStatus = {
  enabled: boolean
  connected: boolean
  login?: string
  reconnect?: boolean
  month: { used: number; limit: number | null }
}

export type GithubConnectError = 'denied' | 'state' | 'github_taken' | 'exchange_failed' | 'disabled'

export type GithubErrorCode =
  | 'github_disabled'
  | 'github_reconnect'
  | 'github_quota'
  | 'github_rate_limited'
  | 'github_forbidden'
  | 'github_not_found'
  | 'github_unavailable'
  | 'github_conflict'
  | 'github_target_taken'
  | 'e2ee'
  | 'github_linked'

export const GITHUB_RETURN_PARAM = 'github' // 값 'connected'
export const GITHUB_ERROR_PARAM = 'github_error'

export function githubMonth(now: number): string {
  const d = new Date(now)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function githubQuotaResetAt(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
