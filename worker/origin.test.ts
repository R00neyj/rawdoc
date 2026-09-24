// 로컬 인증 모드·개발 우회·Origin 판정 (specs/features/F-2033.md 5장, U23·U24)
import { describe, expect, it } from 'vitest'
import { isAllowedOrigin, isDevBypass, isLocalAuthMode, needsOriginCheck } from './origin'
import { SITE_URL } from '../src/lib/siteMeta'

const SITE_ORIGIN = new URL(SITE_URL).origin
const LOCAL = 'http://localhost:8790'
const PROD = 'https://rawdoc.app'

function env(vars: { BETTER_AUTH_URL?: string; DEV_AUTH_EMAIL?: string }): Env {
  return vars as unknown as Env
}

function req(url = `${SITE_ORIGIN}/api/docs`): Request {
  return new Request(url)
}

describe('F-2033 U23 isLocalAuthMode · isDevBypass', () => {
  it('http: + localhost·127.0.0.1 만 로컬 인증 모드', () => {
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: 'http://localhost:8790' }))).toBe(true)
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: 'http://127.0.0.1:8791' }))).toBe(true)
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: 'https://rawdoc.app' }))).toBe(false)
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: 'https://localhost:8790' }))).toBe(false)
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: 'http://rawdoc.app' }))).toBe(false)
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: '' }))).toBe(false)
    expect(isLocalAuthMode(env({ BETTER_AUTH_URL: 'not a url' }))).toBe(false)
    expect(isLocalAuthMode(env({}))).toBe(false)
  })

  it('개발 우회는 로컬 인증 모드 + @example.com 일 때만', () => {
    expect(isDevBypass(env({ BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: 'dev@example.com' }))).toBe(true)
    expect(isDevBypass(env({ BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: 'Dev@Example.COM' }))).toBe(true)
    expect(isDevBypass(env({ BETTER_AUTH_URL: PROD, DEV_AUTH_EMAIL: 'dev@example.com' }))).toBe(false)
    expect(isDevBypass(env({ BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: '' }))).toBe(false)
    expect(isDevBypass(env({ BETTER_AUTH_URL: LOCAL }))).toBe(false)
    expect(isDevBypass(env({ BETTER_AUTH_URL: LOCAL, DEV_AUTH_EMAIL: 'dev@rawdoc.app' }))).toBe(false)
    expect(isDevBypass(env({ DEV_AUTH_EMAIL: 'dev@example.com' }))).toBe(false)
  })
})

describe('F-2033 U24 needsOriginCheck · isAllowedOrigin', () => {
  it('GET·HEAD·OPTIONS 만 관문을 지나지 않는다', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(needsOriginCheck(m)).toBe(false)
    for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) expect(needsOriginCheck(m)).toBe(true)
  })

  it('Origin 없음·다른 출처는 거절, SITE_URL 출처는 통과', () => {
    const prod = env({ BETTER_AUTH_URL: PROD })
    expect(isAllowedOrigin(null, req(), prod)).toBe(false)
    expect(isAllowedOrigin('https://evil.example', req(), prod)).toBe(false)
    expect(isAllowedOrigin(SITE_ORIGIN, req(), prod)).toBe(true)
    expect(isAllowedOrigin(SITE_ORIGIN, req(), env({ BETTER_AUTH_URL: LOCAL }))).toBe(true)
  })

  it('localhost 출처는 로컬 인증 모드일 때만 통과', () => {
    const prod = env({ BETTER_AUTH_URL: PROD, DEV_AUTH_EMAIL: 'dev@example.com' })
    const local = env({ BETTER_AUTH_URL: LOCAL })
    expect(isAllowedOrigin('http://localhost:8791', req(), prod)).toBe(false)
    expect(isAllowedOrigin('http://localhost:8791', req(), local)).toBe(true)
    expect(isAllowedOrigin('http://127.0.0.1:5000', req(), local)).toBe(true)
    expect(isAllowedOrigin('https://localhost:8791', req(), local)).toBe(false)
    expect(isAllowedOrigin('http://evil.example', req(), local)).toBe(false)
  })

  it('로컬 인증 모드면 wrangler dev 가 바꿔 쓴 요청 출처(http://{routes 호스트})도 통과', () => {
    const rewritten = req('http://rawdoc.app/api/docs')
    expect(isAllowedOrigin('http://rawdoc.app', rewritten, env({ BETTER_AUTH_URL: LOCAL }))).toBe(true)
    expect(isAllowedOrigin('http://rawdoc.app', rewritten, env({ BETTER_AUTH_URL: PROD }))).toBe(false)
  })
})
