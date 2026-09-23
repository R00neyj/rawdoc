// md_app 쿠키·md.landingDone 등 앱 진입 판정 상수·순수 함수 (specs/features/F-271.md 3장)
import { describe, expect, it } from 'vitest'
import { APP_COOKIE, APP_COOKIE_VALUE, LANDING_DONE_KEY, EARLY_APP_KEYS, buildAppCookie, hasAppCookie } from './appEntry'

describe('F-271 appEntry 상수', () => {
  it('이름·값이 고정돼 있다', () => {
    expect(APP_COOKIE).toBe('md_app')
    expect(APP_COOKIE_VALUE).toBe('1')
    expect(LANDING_DONE_KEY).toBe('md.landingDone')
    expect(EARLY_APP_KEYS).toEqual(['md.landingDone', 'md.firstRunDone', 'md.account'])
  })
})

describe('F-271 A4 buildAppCookie', () => {
  it('secure:true 면 Secure 를 붙인다', () => {
    expect(buildAppCookie({ secure: true })).toBe('md_app=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure')
  })

  it('secure:false 면 Secure 가 없다 — 나머지는 같다', () => {
    expect(buildAppCookie({ secure: false })).toBe('md_app=1; Path=/; Max-Age=31536000; SameSite=Lax')
  })
})

describe('F-271 hasAppCookie', () => {
  it('md_app=1 이 있으면 true', () => {
    expect(hasAppCookie('md_app=1')).toBe(true)
  })

  it('다른 쿠키와 섞여 있어도 true', () => {
    expect(hasAppCookie('a=1; md_app=1')).toBe(true)
  })

  it('접두 일치(md_appx)는 false', () => {
    expect(hasAppCookie('md_appx=1')).toBe(false)
  })

  it('쿠키 헤더가 없으면 false', () => {
    expect(hasAppCookie(null)).toBe(false)
    expect(hasAppCookie(undefined)).toBe(false)
    expect(hasAppCookie('')).toBe(false)
  })
})
