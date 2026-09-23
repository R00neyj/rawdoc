// 앞뒤 공통 부분 차이와 외부 변경 옮겨 얹기 (specs/features/F-304.md 7.3, A1·A2)
import { describe, expect, it } from 'vitest'

import { diffText, rebaseExternal } from './textRebase'
import type { TextEdit } from './textRebase'

function apply(text: string, edit: TextEdit | null): string {
  if (!edit) return text
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff
}
function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff
}
function splitsPair(text: string, index: number) {
  return index > 0 && index < text.length && isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index))
}

describe('F-304 A1 diffText', () => {
  it('같으면 null', () => {
    expect(diffText('abc', 'abc')).toBeNull()
    expect(diffText('', '')).toBeNull()
  })

  it('가운데만 바꾸는 편집 하나', () => {
    expect(diffText('abc', 'aXbc')).toEqual({ from: 1, to: 1, insert: 'X' })
    expect(diffText('abcd', 'ad')).toEqual({ from: 1, to: 3, insert: '' })
    expect(diffText('abc', 'aYc')).toEqual({ from: 1, to: 2, insert: 'Y' })
    expect(diffText('', 'x')).toEqual({ from: 0, to: 0, insert: 'x' })
  })

  it('서로게이트 쌍을 가르지 않는다', () => {
    const a = 'a😀b'
    const b = 'a😃b'
    const edit = diffText(a, b)!
    expect(splitsPair(a, edit.from)).toBe(false)
    expect(splitsPair(a, edit.to)).toBe(false)
    expect(edit.insert).toBe('😃')
    expect(apply(a, edit)).toBe(b)
  })

  it('결과를 a 에 적용하면 늘 b 가 된다', () => {
    const cases: [string, string][] = [
      ['aaa', 'aaaa'],
      ['aaaa', 'aa'],
      ['abcabc', 'abc'],
      ['😀😀', '😀😃😀'],
      ['x😀', 'x'],
      ['😀', '😃'],
      ['L1\nL2\n', 'L1\nL2x\n'],
      ['hello', ''],
      ['', 'hello'],
    ]
    for (const [a, b] of cases) {
      const edit = diffText(a, b)
      expect(apply(a, edit)).toBe(b)
      if (edit) {
        expect(splitsPair(a, edit.from)).toBe(false)
        expect(splitsPair(a, edit.to)).toBe(false)
      }
    }
  })
})

describe('F-304 A2 rebaseExternal', () => {
  it('current === base 면 diffText(base, external) 와 같다', () => {
    expect(rebaseExternal('abc', 'aXbc', 'abc')).toEqual(diffText('abc', 'aXbc'))
  })

  it('external === base 면 null', () => {
    expect(rebaseExternal('abc', 'abc', 'abXc')).toBeNull()
  })

  it('외부가 내부보다 앞이면 그대로', () => {
    const base = 'L1\nL2\nL3\n'
    const external = 'E1\nL2\nL3\n'
    const current = 'L1\nL2\nL3x\n'
    const edit = rebaseExternal(base, external, current)
    expect(edit).toEqual(diffText(base, external))
    expect(apply(current, edit as TextEdit)).toBe('E1\nL2\nL3x\n')
  })

  it('외부가 내부보다 뒤면 내부 길이 차만큼 밀린다', () => {
    const base = 'L1\nL2\nL3\n'
    const current = 'L1x\nL2\nL3\n'
    const external = 'L1\nL2\nL3y\n'
    const edit = rebaseExternal(base, external, current) as TextEdit
    const plain = diffText(base, external)!
    expect(edit.from).toBe(plain.from + 1)
    expect(edit.to).toBe(plain.to + 1)
    expect(apply(current, edit)).toBe('L1x\nL2\nL3y\n')
  })

  it('내부가 지운 만큼 앞으로 당겨진다', () => {
    const base = 'abcdef'
    const current = 'aef'
    const external = 'abcdeXf'
    expect(apply(current, rebaseExternal(base, external, current) as TextEdit)).toBe('aeXf')
  })

  it('겹치면 conflict', () => {
    expect(rebaseExternal('L1\nL2\nL3\n', 'L1\nN2\nL3\n', 'L1\nM2\nL3\n')).toBe('conflict')
    expect(rebaseExternal('abcdef', 'aXf', 'abcYef')).toBe('conflict')
  })

  it('같은 자리 순수 삽입 둘은 외부가 앞에 온다', () => {
    const base = 'ab'
    const edit = rebaseExternal(base, 'aEb', 'aIb') as TextEdit
    expect(edit).not.toBe('conflict')
    expect(apply('aIb', edit)).toBe('aEIb')
  })
})
