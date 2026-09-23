// F-2021 U10 (specs/features/F-2021.md 13.1) + F-2023 U3·U4 (specs/features/F-2023.md 13.1, 5장)
import { describe, expect, it } from 'vitest'
import {
  CLI_LOGIN_HASH_PREFIX,
  buildCliLoginUrl,
  callbackStateOf,
  cliCallbackUrl,
  cliTokenName,
  isLegacyCliLoginHash,
  parseCliLoginHash,
  sanitizeCliHost,
  type CliLoginRequestV2,
} from './cliLoginUrl'

const v2PublicKey = 'LU2MWmx7Dt_VWEhOf5eRhXMOh3kAcyAGjjkjHx8kPh0'

function reqV2(overrides: Partial<Omit<CliLoginRequestV2, 'version'>> = {}): Omit<CliLoginRequestV2, 'version'> {
  return { port: 45678, host: 'my-host', publicKey: v2PublicKey, ...overrides }
}

describe('F-2023 U3 buildCliLoginUrl / parseCliLoginHash — v2', () => {
  it('왕복된다', () => {
    const request = reqV2()
    const url = buildCliLoginUrl('https://rawdoc.app', request)
    const hash = new URL(url).hash
    expect(hash.startsWith(CLI_LOGIN_HASH_PREFIX)).toBe(true)
    expect(parseCliLoginHash(hash)).toEqual({ version: 2, ...request })
  })

  it('만든 주소가 안전한 문자만 쓴다', () => {
    const url = buildCliLoginUrl('https://rawdoc.app', reqV2())
    expect(url).toMatch(/^[A-Za-z0-9._~:/?#=-]+$/)
  })

  it('?app=1 을 포함한다', () => {
    const url = buildCliLoginUrl('https://rawdoc.app', reqV2())
    expect(url).toContain('/?app=1#/cli-login/')
  })

  it('4조각 v1 해시는 version 1 로 해석된다', () => {
    const v1PublicKey = 'A'.repeat(392)
    const hash = `${CLI_LOGIN_HASH_PREFIX}45678/${'a'.repeat(22)}/${v1PublicKey}/my-host`
    expect(parseCliLoginHash(hash)).toEqual({
      version: 1,
      port: 45678,
      state: 'a'.repeat(22),
      publicKey: v1PublicKey,
      host: 'my-host',
    })
  })

  it.each([
    ['키 42자', { publicKey: v2PublicKey.slice(0, 42) }],
    ['키 44자', { publicKey: v2PublicKey + 'A' }],
    ['host 21자', { host: 'a'.repeat(21) }],
    ['host 에 . 포함', { host: 'my.host' }],
    ['host 에 _ 포함', { host: 'my_host' }],
    ['host 빈 칸', { host: '' }],
  ])('%s 이면 null', (_label, overrides) => {
    const bad = reqV2(overrides as Partial<Omit<CliLoginRequestV2, 'version'>>)
    const hash = `${CLI_LOGIN_HASH_PREFIX}${bad.port}/${bad.host}/${bad.publicKey}`
    expect(parseCliLoginHash(hash)).toBeNull()
  })

  it('조각 2개면 null', () => {
    expect(parseCliLoginHash(`${CLI_LOGIN_HASH_PREFIX}45678/my-host`)).toBeNull()
  })

  it('22자 state 를 둔 3조각 해시(잘린 v1) 는 null — host 상한 20자에 걸린다', () => {
    const hash = `${CLI_LOGIN_HASH_PREFIX}45678/${'a'.repeat(22)}/${v2PublicKey}`
    expect(parseCliLoginHash(hash)).toBeNull()
  })

  it('접두사가 다르면 null', () => {
    expect(parseCliLoginHash('#/other/1234')).toBeNull()
  })
})

describe('F-2023 U3 callbackStateOf', () => {
  it('v1 이면 state', () => {
    expect(callbackStateOf({ version: 1, port: 1, state: 's'.repeat(22), publicKey: 'A'.repeat(392), host: 'h' })).toBe(
      's'.repeat(22),
    )
  })

  it('v2 이면 publicKey', () => {
    expect(callbackStateOf({ version: 2, port: 1, host: 'h', publicKey: v2PublicKey })).toBe(v2PublicKey)
  })
})

describe('F-2021 U10 cliCallbackUrl', () => {
  it('성공 콜백은 http://127.0.0.1:{port}/callback? 로 시작하고 sealed 를 싣는다', () => {
    const url = cliCallbackUrl(45678, { state: v2PublicKey, sealed: 'abc' })
    expect(url.startsWith('http://127.0.0.1:45678/callback?')).toBe(true)
    expect(new URL(url).searchParams.get('sealed')).toBe('abc')
  })

  it('취소 콜백은 error=denied 를 싣는다', () => {
    const url = cliCallbackUrl(45678, { state: v2PublicKey, error: 'denied' })
    expect(url.startsWith('http://127.0.0.1:45678/callback?')).toBe(true)
    expect(new URL(url).searchParams.get('error')).toBe('denied')
  })
})

describe('F-2021 U10 cliTokenName', () => {
  it('CLI · {host}, 20자 host 면 길이 26', () => {
    const name = cliTokenName('a'.repeat(20))
    expect(name.length).toBe(26)
    expect(name.startsWith('CLI · ')).toBe(true)
  })
})

describe('F-2023 U4 sanitizeCliHost', () => {
  it('Jiwons-MacBook-Pro.local → 첫 . 앞까지', () => {
    expect(sanitizeCliHost('Jiwons-MacBook-Pro.local')).toBe('Jiwons-MacBook-Pro')
  })

  it('a 50개 → 20자', () => {
    expect(sanitizeCliHost('a'.repeat(50))).toBe('a'.repeat(20))
  })

  it('내-PC → [A-Za-z0-9-] 만', () => {
    expect(sanitizeCliHost('내-PC')).toMatch(/^[A-Za-z0-9-]+$/)
  })

  it('빈 문자열이면 unknown', () => {
    expect(sanitizeCliHost('')).toBe('unknown')
  })

  it('.x 이면 unknown', () => {
    expect(sanitizeCliHost('.x')).toBe('unknown')
  })
})

describe('F-2023 U4 isLegacyCliLoginHash', () => {
  it('잘린 v1(두 번째 조각 22자, 조각 3개) 는 true', () => {
    const hash = `${CLI_LOGIN_HASH_PREFIX}45678/${'a'.repeat(22)}/${'A'.repeat(200)}`
    expect(isLegacyCliLoginHash(hash)).toBe(true)
  })

  it('v2 해시(온전함) 는 false', () => {
    const hash = `${CLI_LOGIN_HASH_PREFIX}45678/my-host/${v2PublicKey}`
    expect(isLegacyCliLoginHash(hash)).toBe(false)
  })

  it('v2 해시(키가 잘림) 도 false', () => {
    const hash = `${CLI_LOGIN_HASH_PREFIX}45678/my-host/${v2PublicKey.slice(0, 10)}`
    expect(isLegacyCliLoginHash(hash)).toBe(false)
  })

  it('조각 2개면 false', () => {
    expect(isLegacyCliLoginHash(`${CLI_LOGIN_HASH_PREFIX}45678/my-host`)).toBe(false)
  })
})
