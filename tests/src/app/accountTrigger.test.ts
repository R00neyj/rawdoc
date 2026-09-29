import { describe, expect, it } from 'vitest'
import { accountTrigger } from '../../../src/app/accountTrigger'
import type { AccountState } from '../../../src/app/account'

const signedIn = { state: 'in', email: 'a@b.com' } as AccountState

describe('F-2090 A2 accountTrigger', () => {
  it('in 은 저장값을 보지 않고 현재 이메일', () => {
    expect(accountTrigger(signedIn, 'x@y.com')).toEqual({ kind: 'menu', text: 'a@b.com', ariaLabel: '계정: a@b.com' })
  })
  it('offline + 저장된 이메일', () => {
    expect(accountTrigger({ state: 'offline' }, 'a@b.com')).toEqual({ kind: 'menu', text: 'a@b.com', ariaLabel: '계정: a@b.com (오프라인)' })
  })
  it('offline + 이메일 없음(null·빈 문자열)', () => {
    expect(accountTrigger({ state: 'offline' }, null)).toEqual({ kind: 'menu', text: '계정', ariaLabel: '계정' })
    expect(accountTrigger({ state: 'offline' }, '')).toEqual({ kind: 'menu', text: '계정', ariaLabel: '계정' })
  })
  it('out 은 저장값이 있어도 login', () => {
    expect(accountTrigger({ state: 'out' }, 'a@b.com')).toEqual({ kind: 'login', label: '로그인' })
  })
  it('menu 결과의 ariaLabel 이 보이는 글자를 품는다', () => {
    for (const [acc, stored] of [[signedIn, null], [{ state: 'offline' }, 'q@w.com'], [{ state: 'offline' }, null]] as [AccountState, string | null][]) {
      const t = accountTrigger(acc, stored)
      if (t.kind === 'menu') expect(t.ariaLabel.includes(t.text)).toBe(true)
    }
  })
})
