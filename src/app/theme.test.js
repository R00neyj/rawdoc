import { describe, expect, test } from 'vitest'
import { resolveTheme } from './theme.js'

describe('resolveTheme', () => {
  test('system + 다크', () => {
    expect(resolveTheme('system', true)).toBe('dark')
  })

  test('system + 라이트', () => {
    expect(resolveTheme('system', false)).toBe('white')
  })

  test.each(['white', 'sepia', 'dark'])('고정값 %s 은 시스템 설정과 무관하게 유지', (value) => {
    expect(resolveTheme(value, true)).toBe(value)
    expect(resolveTheme(value, false)).toBe(value)
  })

  test('모르는 값은 system 으로 본다', () => {
    expect(resolveTheme('nope', true)).toBe('dark')
    expect(resolveTheme('nope', false)).toBe('white')
    expect(resolveTheme(undefined, false)).toBe('white')
  })
})
