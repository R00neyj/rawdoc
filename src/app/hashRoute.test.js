import { describe, it, expect } from 'vitest'
import { parseHash, formatHash, formatShareHash } from './hashRoute.js'

describe('parseHash', () => {
  it('#/d/{id} 형식이면 type doc, docId 를 돌려준다', () => {
    expect(parseHash('#/d/abc-123')).toEqual({ type: 'doc', docId: 'abc-123' })
  })

  it('#/s/{조각} 형식이면 type share, fragment 를 돌려준다', () => {
    expect(parseHash('#/s/abc')).toEqual({ type: 'share', fragment: 'abc' })
  })

  it('#/ 는 type none', () => {
    expect(parseHash('#/')).toEqual({ type: 'none' })
  })

  it('빈 문자열은 type none', () => {
    expect(parseHash('')).toEqual({ type: 'none' })
  })

  it('#/d/ 형식이 아니면 type none', () => {
    expect(parseHash('#somethingelse')).toEqual({ type: 'none' })
  })

  it('문자열이 아니면 type none', () => {
    expect(parseHash(undefined)).toEqual({ type: 'none' })
  })
})

describe('formatHash', () => {
  it('id 가 있으면 #/d/{id}', () => {
    expect(formatHash('abc-123')).toBe('#/d/abc-123')
  })

  it('null 이면 #/', () => {
    expect(formatHash(null)).toBe('#/')
  })
})

describe('formatShareHash', () => {
  it('조각을 #/s/{조각} 으로 만든다', () => {
    expect(formatShareHash('abc')).toBe('#/s/abc')
  })
})
