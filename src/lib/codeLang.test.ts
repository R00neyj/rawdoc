import { describe, it, expect } from 'vitest'
import { displayLang } from './codeLang'

describe('displayLang (F-248 A1~A5)', () => {
  it('흔한 별칭을 정식 표기로 바꾼다', () => {
    expect(displayLang('js')).toBe('JavaScript')
    expect(displayLang('ts')).toBe('TypeScript')
    expect(displayLang('py')).toBe('Python')
    expect(displayLang('sh')).toBe('Shell')
  })

  it('대소문자를 구분하지 않는다', () => {
    expect(displayLang('JS')).toBe('JavaScript')
    expect(displayLang('Python')).toBe('Python')
  })

  it('정보 문자열의 첫 단어만 본다', () => {
    expect(displayLang('js title="a.js"')).toBe('JavaScript')
  })

  it('표에 없는 언어는 원문 그대로', () => {
    expect(displayLang('brainfuck')).toBe('brainfuck')
  })

  it('빈 값이면 빈 문자열', () => {
    expect(displayLang('')).toBe('')
  })
})
