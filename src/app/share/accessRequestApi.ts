// 권한 요청 요청자 라우트 호출 (specs/features/F-2135.md 2장, F-4005 4장)
import type { AccessRequestStatus, AccessRole } from '../../lib/share/accessRequest'

export type AccessRequestError = 'gone' | 'already_member' | 'cooldown' | 'too_many_pending' | 'owner_full' | 'blocked' | 'rate_limited' | 'failed'

type SendResult = { ok: true; status: AccessRequestStatus } | { ok: false; error: AccessRequestError; retryAt: number | null }

const STATUS_KEYS = ['memberRole', 'owner', 'request', 'targetId', 'target']
const REQUEST_KEYS = ['retryAt', 'role', 'state']

function isRole(v: unknown): v is AccessRole {
  return v === 'view' || v === 'edit'
}

function hasExactKeys(o: object, keys: string[]): boolean {
  const own = Object.keys(o).sort()
  return own.length === keys.length && [...keys].sort().every((k, i) => own[i] === k)
}

function parseStatus(raw: unknown): AccessRequestStatus | null {
  if (typeof raw !== 'object' || raw === null || !hasExactKeys(raw, STATUS_KEYS)) return null
  const s = raw as Record<string, unknown>
  if (s.target !== 'doc' && s.target !== 'folder') return null
  if (typeof s.owner !== 'boolean') return null
  if (s.memberRole !== null && !isRole(s.memberRole)) return null
  if (s.targetId !== null && typeof s.targetId !== 'string') return null
  let request: AccessRequestStatus['request'] = null
  if (s.request !== null) {
    if (typeof s.request !== 'object' || !hasExactKeys(s.request as object, REQUEST_KEYS)) return null
    const r = s.request as Record<string, unknown>
    if ((r.state !== 'pending' && r.state !== 'rejected') || !isRole(r.role)) return null
    if (r.state === 'rejected' ? typeof r.retryAt !== 'number' : r.retryAt !== null) return null
    request = { state: r.state, role: r.role, retryAt: r.retryAt as number | null }
  }
  return { target: s.target, owner: s.owner, memberRole: s.memberRole, targetId: s.targetId, request }
}

function linkUrl(token: string, docId: string | null): string {
  const base = `/api/access-requests/link/${encodeURIComponent(token)}`
  return docId ? `${base}?docId=${encodeURIComponent(docId)}` : base
}

export async function fetchAccessStatus(token: string, docId: string | null): Promise<AccessRequestStatus | null> {
  try {
    const res = await fetch(linkUrl(token, docId), { credentials: 'same-origin' })
    if (res.status !== 200) return null
    return parseStatus(await res.json())
  } catch {
    return null
  }
}

const CONFLICT_ERRORS: AccessRequestError[] = ['already_member', 'cooldown', 'too_many_pending', 'owner_full']

export async function sendAccessRequest(token: string, docId: string | null, role: AccessRole): Promise<SendResult> {
  const failed: SendResult = { ok: false, error: 'failed', retryAt: null }
  try {
    const res = await fetch(linkUrl(token, null), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(docId ? { role, docId } : { role }),
    })
    const body: unknown = await res.json().catch(() => null)
    if (res.status === 200 || res.status === 201) {
      const status = parseStatus(body)
      return status ? { ok: true, status } : failed
    }
    if (res.status === 404) return { ok: false, error: 'gone', retryAt: null }
    if (res.status === 429) return { ok: false, error: 'rate_limited', retryAt: null }
    const code = typeof body === 'object' && body !== null ? (body as { error?: unknown; retryAt?: unknown }) : {}
    if (res.status === 403 && code.error === 'account_blocked') return { ok: false, error: 'blocked', retryAt: null }
    if (res.status === 409 && CONFLICT_ERRORS.includes(code.error as AccessRequestError)) {
      return { ok: false, error: code.error as AccessRequestError, retryAt: typeof code.retryAt === 'number' ? code.retryAt : null }
    }
    return failed
  } catch {
    return failed
  }
}

export async function cancelAccessRequest(token: string, docId: string | null): Promise<boolean> {
  try {
    const res = await fetch(linkUrl(token, docId), { method: 'DELETE', credentials: 'same-origin' })
    return res.status === 204
  } catch {
    return false
  }
}
