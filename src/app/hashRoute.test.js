import { describe, it, expect } from 'vitest'
import { parseHash, formatHash } from './hashRoute.js'

describe('parseHash', () => {
  it('#/d/{id} 형식이면 id 를 돌려준다', () => {
    expect(parseHash('#/d/abc-123')).toEqual({ docId: 'abc-123' })
  })

  it('#/ 는 docId null', () => {
    expect(parseHash('#/')).toEqual({ docId: null })
  })

  it('빈 문자열은 docId null', () => {
    expect(parseHash('')).toEqual({ docId: null })
  })

  it('#/d/ 형식이 아니면 docId null', () => {
    expect(parseHash('#somethingelse')).toEqual({ docId: null })
  })

  it('문자열이 아니면 docId null', () => {
    expect(parseHash(undefined)).toEqual({ docId: null })
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
