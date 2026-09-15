// 로그인 상태 조회·이동 주소 (specs/features/F-205.md 2.4)
import { getPref, setPref } from './prefs'

export type Account = { id: string; email: string }
export type AccountState =
  | { state: 'in'; id: string; email: string }
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

  let account: Account
  try {
    account = await response.json()
  } catch {
    return { state: 'offline' }
  }
  setPref('md.account', JSON.stringify(account))
  return { state: 'in', id: account.id, email: account.email }
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

export function logoutUrl(): string {
  return '/cdn-cgi/access/logout'
}
