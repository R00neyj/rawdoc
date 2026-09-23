// specs/features/F-283.md 3.3, 9장 A9~A10
import { describe, expect, it } from 'vitest'
import { findHighlights } from './highlightSyntax'

describe('findHighlights — 짝 찾기 (A9)', () => {
  it('==a== 와 ==b== 두 짝을 찾고 위치가 맞다', () => {
    const line = '==a== 와 ==b=='
    const matches = findHighlights(line)
    expect(matches).toHaveLength(2)
    expect(matches[0]).toEqual({ from: 0, to: 5, innerFrom: 2, innerTo: 3 })
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('a')
    expect(matches[1]).toEqual({ from: 8, to: 13, innerFrom: 10, innerTo: 11 })
    expect(line.slice(matches[1].innerFrom, matches[1].innerTo)).toBe('b')
  })
})

describe('findHighlights — 짝 경계 (A10)', () => {
  it('===셋=== — 왼쪽부터 2개씩 끊어 1개', () => {
    expect(findHighlights('===셋===')).toHaveLength(1)
  })

  it('==== — 안쪽이 비어 0개', () => {
    expect(findHighlights('====')).toHaveLength(0)
  })

  it('== a== — 여는 기호 뒤 공백이라 0개', () => {
    expect(findHighlights('== a==')).toHaveLength(0)
  })

  it("==a — 닫는 기호가 없어 0개", () => {
    expect(findHighlights('==a')).toHaveLength(0)
  })
})

describe('findHighlights — 잘못된 입력', () => {
  it('문자열이 아니면 빈 배열', () => {
    expect(findHighlights(undefined)).toEqual([])
    expect(findHighlights(null)).toEqual([])
    expect(findHighlights(123)).toEqual([])
  })
})
