// F-2021 U10 (specs/features/F-2021.md 13.1)
import { describe, expect, it } from 'vitest'
import {
  CLI_LOGIN_HASH_PREFIX,
  buildCliLoginUrl,
  cliCallbackUrl,
  cliTokenName,
  parseCliLoginHash,
  sanitizeCliHost,
  type CliLoginRequest,
} from './cliLoginUrl'

const publicKey = 'A'.repeat(392)

function req(overrides: Partial<CliLoginRequest> = {}): CliLoginRequest {
  return { port: 45678, state: 'a'.repeat(22), publicKey, host: 'my-host', ...overrides }
}

describe('F-2021 U10 buildCliLoginUrl / parseCliLoginHash', () => {
  it('왕복된다', () => {
    const request = req()
    const url = buildCliLoginUrl('https://rawdoc.app', request)
    const hash = new URL(url).hash
    expect(hash.startsWith(CLI_LOGIN_HASH_PREFIX)).toBe(true)
    expect(parseCliLoginHash(hash)).toEqual(request)
  })

  it('만든 주소가 안전한 문자만 쓴다', () => {
    const url = buildCliLoginUrl('https://rawdoc.app', req())
    expect(url).toMatch(/^[A-Za-z0-9._~:/?#=-]+$/)
  })

  it('?app=1 을 포함한다', () => {
    const url = buildCliLoginUrl('https://rawdoc.app', req())
    expect(url).toContain('/?app=1#/cli-login/')
  })

  it.each([
    ['port 80', { port: 80 }],
    ['port 0', { port: 0 }],
    ['port 65536', { port: 65536 }],
    ['port 12a 아님(문자)', { port: '12a' as unknown as number }],
    ['state 21자', { state: 'a'.repeat(21) }],
    ['state 23자', { state: 'a'.repeat(23) }],
    ['publicKey 299자', { publicKey: 'A'.repeat(299) }],
    ['host 밑줄 포함', { host: 'my_host' }],
    ['host 35자', { host: 'a'.repeat(35) }],
  ])('%s 이면 null', (_label, overrides) => {
    const bad = req(overrides as Partial<CliLoginRequest>)
    const hash = `${CLI_LOGIN_HASH_PREFIX}${bad.port}/${bad.state}/${bad.publicKey}/${bad.host}`
    expect(parseCliLoginHash(hash)).toBeNull()
  })

  it('접두사가 다르면 null', () => {
    expect(parseCliLoginHash('#/other/1234')).toBeNull()
  })
})

describe('F-2021 U10 cliCallbackUrl', () => {
  it('성공 콜백은 http://127.0.0.1:{port}/callback? 로 시작하고 sealed 를 싣는다', () => {
    const url = cliCallbackUrl(45678, { state: 's'.repeat(22), sealed: 'abc' })
    expect(url.startsWith('http://127.0.0.1:45678/callback?')).toBe(true)
    expect(new URL(url).searchParams.get('sealed')).toBe('abc')
  })

  it('취소 콜백은 error=denied 를 싣는다', () => {
    const url = cliCallbackUrl(45678, { state: 's'.repeat(22), error: 'denied' })
    expect(url.startsWith('http://127.0.0.1:45678/callback?')).toBe(true)
    expect(new URL(url).searchParams.get('error')).toBe('denied')
  })
})

describe('F-2021 U10 cliTokenName', () => {
  it('CLI · {host}, 34자 host 면 길이 40', () => {
    const name = cliTokenName('A'.repeat(34))
    expect(name.length).toBe(40)
    expect(name.startsWith('CLI · ')).toBe(true)
  })
})

describe('F-2021 U10 sanitizeCliHost', () => {
  it('허용 문자 밖은 - 로 바뀌고 34자로 잘린다', () => {
    const result = sanitizeCliHost('내-PC')
    expect(result).toMatch(/^[A-Za-z0-9.-]+$/)
  })

  it('빈 문자열이면 unknown', () => {
    expect(sanitizeCliHost('')).toBe('unknown')
  })

  it('34자보다 길면 자른다', () => {
    expect(sanitizeCliHost('a'.repeat(50)).length).toBe(34)
  })
})
