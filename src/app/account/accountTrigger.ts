// 사이드바 하단 계정 자리에 무엇을 그릴지 — DOM·React 없는 순수 함수 (F-2090 3.1)
import type { AccountState } from './account'

export type AccountTrigger = { kind: 'login'; label: '로그인' } | { kind: 'menu'; text: string; ariaLabel: string }

export function accountTrigger(account: AccountState, storedEmail: string | null): AccountTrigger {
  if (account.state === 'out') return { kind: 'login', label: '로그인' }
  if (account.state === 'in') return { kind: 'menu', text: account.email, ariaLabel: `계정: ${account.email}` }
  if (storedEmail) return { kind: 'menu', text: storedEmail, ariaLabel: `계정: ${storedEmail} (오프라인)` }
  return { kind: 'menu', text: '계정', ariaLabel: '계정' }
}
