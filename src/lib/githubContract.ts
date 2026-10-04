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
  | 'github_empty_repo'

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

// F-3016 6장 — 푸시 (push-plan → blobs → push)
export const GITHUB_PUSH_MAX_IMAGES = 50
export const GITHUB_BLOB_MAX_BYTES = 7_000_000
export type GithubPushPlanBody = { attachments: string[] } // '{16hex}.{ext}'
export type GithubPushPlan = { missing: string[]; skipped: string[] }
export type GithubBlobCreated = { sha: string }
export type GithubPushImage = { name: string; sha: string }
export type GithubPushBody = { message: string; mdSha: string; images: GithubPushImage[] }
export type GithubPushed = { sha: string; commitSha: string | null; commitUrl: string | null } // null = 바뀐 것 없음
export type GithubConflictBody = { error: 'github_conflict'; remoteSha?: string | null } // null = 원격에 파일 없음, 없음 = ref 경합

// F-3017 4장 — 저장소 그림 대응·프록시
export const GITHUB_PROXY_MAX_BYTES = 10_000_000
export const GITHUB_RAW_MAX_BYTES = 20_000_000
export const GITHUB_IMAGE_SOURCES_MAX_PATHS = 500
export const GITHUB_IMAGE_SOURCES_MAX_DIRS = 20
export const GITHUB_IMAGES_PER_DOC = 1000
export type GithubImageSourcesBody = { paths: string[] }
export type GithubImageSource = { path: string; sha: string; size: number; mapped: boolean } // mapped: 같은 sha 로 이미 대응됨 (F-2131 5.4)
export type GithubImageSources = { sources: GithubImageSource[]; truncated: boolean }
export type GithubImagePut = { path: string; blobSha: string; attachment: string } // attachment: '{id}.{ext}'
export type GithubImageMap = { path: string; images: Record<string, string> } // 저장소 경로 → '{attachment_id}.{ext}'
