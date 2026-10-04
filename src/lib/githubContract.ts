// GitHub 연결 계약 — 서버·앱 공용 타입·질의 이름·달 계산 (specs/features/F-3014.md 6장). 순수, import 없음

export type GithubStatus = {
  enabled: boolean
  connected: boolean
  login?: string
  reconnect?: boolean
  installUrl?: string
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

// F-3015 5장 — 저장소 고르기·파일·연결
export type GithubRepo = { id: number; fullName: string; defaultBranch: string; private: boolean; canWrite: boolean }
export type GithubRepoList = { repos: GithubRepo[]; truncated: boolean }
export type GithubBranchList = { branches: string[]; truncated: boolean }
export type GithubTreeEntry = { name: string; type: 'dir' | 'file'; size: number }
export type GithubTree = { entries: GithubTreeEntry[]; truncated: boolean }
export type GithubFile = { sha: string; size: number; content: string; linkedDocId: string | null } // content: base64, \n 섞임
export type GithubPulled = { sha: string; size: number; content: string }
export type GithubLink = {
  repo: string
  branch: string
  path: string
  remoteSha: string | null
  remoteBom: boolean
  syncedAt: number | null
  htmlUrl: string
  images: Record<string, string>
}
export type GithubLinkPut = { repo: string; branch: string; path: string; sha: string | null; bom: boolean }
export type GithubSyncedBody = { sha: string; bom: boolean }
