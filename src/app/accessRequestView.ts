// 권한 요청 버튼의 순수 판정·문구 (specs/features/F-2135.md 2·4장)
import type { AccessRequestStatus, AccessRole } from '../lib/accessRequest'
import type { AccessRequestError } from './accessRequestApi'

export type AccessControlView = {
  openHref: string | null
  request: { mode: 'form'; roles: AccessRole[] } | { mode: 'pending'; role: AccessRole } | { mode: 'rejected'; retryAt: number } | null
}

export function accessControlView(s: AccessRequestStatus | null): AccessControlView {
  if (!s) return { openHref: null, request: null }
  const hasAccess = s.owner || s.memberRole !== null
  const openHref = hasAccess ? (s.target === 'doc' && s.targetId ? `/?app=1#/d/${s.targetId}` : '/?app=1#/') : null
  if (s.owner || s.memberRole === 'edit') return { openHref, request: null }
  if (s.request?.state === 'pending') return { openHref, request: { mode: 'pending', role: s.request.role } }
  if (s.request?.state === 'rejected' && s.request.retryAt !== null) return { openHref, request: { mode: 'rejected', retryAt: s.request.retryAt } }
  return { openHref, request: { mode: 'form', roles: s.memberRole === 'view' ? ['edit'] : ['view', 'edit'] } }
}

// 지역 시간 YYYY-MM-DD
export function formatLocalDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function accessRequestErrorMessage(e: AccessRequestError, retryAt: number | null): string {
  switch (e) {
    case 'gone':
      return '링크가 끊겨 권한을 요청할 수 없습니다.'
    case 'already_member':
      return '이미 이 권한이 있습니다.'
    case 'cooldown':
      return retryAt === null ? '잠시 뒤 다시 요청할 수 있습니다.' : `${formatLocalDate(retryAt)}부터 다시 요청할 수 있습니다.`
    case 'too_many_pending':
      return '기다리는 요청이 너무 많습니다. 보낸 요청이 처리된 뒤 다시 시도해 주세요.'
    case 'owner_full':
      return '소유자가 받은 요청이 많아 지금은 보낼 수 없습니다.'
    case 'blocked':
      return '계정이 제한되어 요청할 수 없습니다.'
    default:
      return '요청을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
  }
}
