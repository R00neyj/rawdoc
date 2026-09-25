// F-403 U3·U4 (specs/features/F-403.md 9.1·10장, 6장)
import { describe, expect, it } from 'vitest'
import { encodeRecoveryCode, parseRecoveryCode } from './recoveryCode'

function bytesFrom(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values) as Uint8Array<ArrayBuffer>
}

const V8_SEQUENTIAL = bytesFrom(...Array.from({ length: 20 }, (_, i) => i))
const V8_FF = bytesFrom(...Array.from({ length: 20 }, () => 0xff))
const V8_ZERO = bytesFrom(...Array.from({ length: 20 }, () => 0x00))

const V9_EXPECTED = bytesFrom(...Array.from({ length: 20 }, (_, i) => i))

describe('F-403 U3 encodeRecoveryCode', () => {
  it('V8 표', () => {
    expect(encodeRecoveryCode(V8_SEQUENTIAL)).toBe('000G-40R4-0M30-E209-185G-R38E-1W81-24GK')
    expect(encodeRecoveryCode(V8_FF)).toBe('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')
    expect(encodeRecoveryCode(V8_ZERO)).toBe('0000-0000-0000-0000-0000-0000-0000-0000')
  })

  it('모든 출력이 4자-8묶음 Crockford 형식', () => {
    const re = /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/
    expect(encodeRecoveryCode(V8_SEQUENTIAL)).toMatch(re)
    expect(encodeRecoveryCode(V8_FF)).toMatch(re)
    expect(encodeRecoveryCode(V8_ZERO)).toMatch(re)
  })

  it('20 B 가 아니면 RangeError', () => {
    expect(() => encodeRecoveryCode(new Uint8Array(19))).toThrow(RangeError)
    expect(() => encodeRecoveryCode(new Uint8Array(21))).toThrow(RangeError)
  })
})

describe('F-403 U4 parseRecoveryCode', () => {
  it.each([
    [' 000g 40r4-0m30–e209\t185G-R38E-1W81-24GK\n', V9_EXPECTED],
    ['OOOG-4OR4-OM3O-E2O9-I85G-R38E-lW8L-24GK', V9_EXPECTED],
    ['０００Ｇ-40R4-0M30-E209-185G-R38E-1W81-24GK', V9_EXPECTED],
    ['000G40R40M30E209185GR38E1W8124GK', V9_EXPECTED],
    ['000G 40R4　0M30-E209-185G-R38E-1W81-24GK', V9_EXPECTED],
    ['000G-40R4-0M30-E209-185G-R38E-1W81-24G', null],
    ['000G-40R4-0M30-E209-185G-R38E-1W81-24GKK', null],
    ['000G-40R4-0M30-E209-185G-R38E-1W81-24GU', null],
    ['000G-40R4-0M30-E209-185G-R38E-1W81-24G*', null],
    ['000G_40R4-0M30-E209-185G-R38E-1W81-24GK', null],
  ])('%s', (input, expected) => {
    expect(parseRecoveryCode(input)).toEqual(expected)
  })

  it('무작위 20 B 100개 왕복', () => {
    for (let i = 0; i < 100; i++) {
      const bytes = new Uint8Array(20)
      crypto.getRandomValues(bytes)
      const encoded = encodeRecoveryCode(bytes)
      expect(parseRecoveryCode(encoded)).toEqual(bytes)
    }
  })
})
