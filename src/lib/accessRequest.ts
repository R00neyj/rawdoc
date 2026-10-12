// 권한 요청 상수·모양 — Worker·앱 공용 (specs/features/F-4005.md 3장)
export const ACCESS_REQUEST_PENDING_MAX = 20
export const ACCESS_REQUEST_OWNER_PENDING_MAX = 100
export const ACCESS_REQUEST_COOLDOWN_MS = 7 * 24 * 3_600_000
export const ACCESS_REQUEST_EXPIRE_MS = 30 * 24 * 3_600_000

export type AccessRole = 'view' | 'edit'

export type AccessRequestStatus = {
  target: 'doc' | 'folder'
  owner: boolean
  memberRole: AccessRole | null
  targetId: string | null
  request: { state: 'pending' | 'rejected'; role: AccessRole; retryAt: number | null } | null
}

export type AccessRequestRow = {
  id: string
  targetType: 'doc' | 'folder'
  targetId: string
  targetName: string
  email: string
  name: string
  role: AccessRole
  createdAt: number
}
