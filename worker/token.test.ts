import { describe, expect, it } from 'vitest'
import { generateToken, isValidToken } from './token'

describe('F-210 A1 토큰', () => {
  it('base64url 43자를 만든다', () => {
    const token = generateToken()
    expect(token).toHaveLength(43)
    expect(isValidToken(token)).toBe(true)
  })

  it('매번 다른 토큰을 만든다', () => {
    expect(generateToken()).not.toBe(generateToken())
  })

  it('길이가 다르면 거부한다', () => {
    expect(isValidToken('a'.repeat(42))).toBe(false)
    expect(isValidToken('a'.repeat(44))).toBe(false)
  })

  it('base64url 이 아닌 문자가 있으면 거부한다', () => {
    expect(isValidToken(`${'a'.repeat(42)}!`)).toBe(false)
    expect(isValidToken(`${'a'.repeat(42)}+`)).toBe(false)
  })

  it('문자열이 아니면 거부한다', () => {
    expect(isValidToken(123)).toBe(false)
    expect(isValidToken(undefined)).toBe(false)
    expect(isValidToken(null)).toBe(false)
  })
})
