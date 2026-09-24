// 로그인 상태 조회·이동 주소 (specs/features/F-205.md 2.4, 로그아웃은 F-2034)
import { getPref, setPref } from './prefs'

export type Account = { id: string; email: string }
export type AccountState =
  | { state: 'in'; id: string; email: string; blocked: boolean; warned: boolean }
  | { state: 'out' }
  | { state: 'offline' }

// `/api/me` 조회 — 응답 형태가 문서화되지 않아 401·403·리다이렉트를 모두 out 으로 본다 (F-205.md 2.4)
export async function fetchAccount(): Promise<AccountState> {
  let response: Response
  try {
    response = await fetch('/api/me', { redirect: 'manual', credentials: 'same-origin' })
  } catch {
    return { state: 'offline' }
  }

  if (response.type === 'opaqueredirect') {
    setPref('md.account', '')
    return { state: 'out' }
  }
  if (response.status === 401 || response.status === 403) {
    setPref('md.account', '')
    return { state: 'out' }
  }
  if (response.status >= 500) {
    return { state: 'offline' }
  }
  if (!response.ok) {
    return { state: 'offline' }
  }

  let raw: { id: string; email: string; blocked?: unknown; warned?: unknown }
  try {
    raw = await response.json()
  } catch {
    return { state: 'offline' }
  }
  // md.account 에는 id·email 두 필드만 쓴다 — 응답이 늘어도 저장 값은 그대로 (F-2030 3.4)
  const account: Account = { id: raw.id, email: raw.email }
  setPref('md.account', JSON.stringify(account))
  // blocked·warned 는 응답 값이 정확히 true 일 때만 true (F-2030 3.4)
  return { state: 'in', id: account.id, email: account.email, blocked: raw.blocked === true, warned: raw.warned === true }
}

// 저장된 마지막 in 상태 (offline 일 때 화면에 쓴다)
export function storedAccount(): Account | null {
  const raw = getPref('md.account', '')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.id === 'string' && typeof parsed.email === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function loginUrl(hash: string): string {
  return `/api/login?return=${encodeURIComponent(hash)}`
}

// 로그아웃 뒤 가는 곳 — 해시를 버린다 (F-2034 3.1)
export const AFTER_LOGOUT_URL = '/?app=1'
export const LOGOUT_FAILED_MESSAGE = '로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'

// true = 서버가 세션을 끝냈다(2xx). false = 그 밖 전부 (F-2034 3.1)
export async function logout(): Promise<boolean> {
  let response: Response
  try {
    response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'manual',
    })
  } catch {
    return false
  }

  if (response.type === 'opaqueredirect' || !response.ok) {
    return false
  }

  setPref('md.account', '')
  return true
}
