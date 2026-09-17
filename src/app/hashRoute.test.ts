import { describe, it, expect } from 'vitest'
import { parseHash, formatHash, formatShareHash, formatPublicFolderHash, parsePathRoute } from './hashRoute'

describe('parseHash', () => {
  it('#/d/{id} 형식이면 type doc, docId 를 돌려준다', () => {
    expect(parseHash('#/d/abc-123')).toEqual({ type: 'doc', docId: 'abc-123' })
  })

  it('#/s/{조각} 형식이면 type share, fragment 를 돌려준다', () => {
    expect(parseHash('#/s/abc')).toEqual({ type: 'share', fragment: 'abc' })
  })

  it('#/p/{토큰} 형식이면 type public, token 을 돌려준다', () => {
    expect(parseHash('#/p/abc-token')).toEqual({ type: 'public', token: 'abc-token' })
  })

  it('#/p/f/{토큰} 형식이면 type publicFolder, docId 없음', () => {
    expect(parseHash('#/p/f/tok1')).toEqual({ type: 'publicFolder', token: 'tok1' })
  })

  it('#/p/f/{토큰}/{문서id} 형식이면 type publicFolder, docId 포함', () => {
    expect(parseHash('#/p/f/tok1/doc1')).toEqual({ type: 'publicFolder', token: 'tok1', docId: 'doc1' })
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

describe('formatPublicFolderHash', () => {
  it('docId 없으면 #/p/f/{토큰}', () => {
    expect(formatPublicFolderHash('tok1')).toBe('#/p/f/tok1')
  })

  it('docId 있으면 #/p/f/{토큰}/{docId}', () => {
    expect(formatPublicFolderHash('tok1', 'doc1')).toBe('#/p/f/tok1/doc1')
  })
})

describe('parsePathRoute', () => {
  it('/p/{토큰} 형식이면 type public, token 을 돌려준다', () => {
    expect(parsePathRoute('/p/abc-token')).toEqual({ type: 'public', token: 'abc-token' })
  })

  it('/p/f/{토큰} 형식이면 type publicFolder', () => {
    expect(parsePathRoute('/p/f/tok1')).toEqual({ type: 'publicFolder', token: 'tok1' })
  })

  it('/ 는 type none', () => {
    expect(parsePathRoute('/')).toEqual({ type: 'none' })
  })

  it('/p/ 는 type none', () => {
    expect(parsePathRoute('/p/')).toEqual({ type: 'none' })
  })

  it('/p/f/ 는 type none', () => {
    expect(parsePathRoute('/p/f/')).toEqual({ type: 'none' })
  })

  it('/p/f/{토큰}/{문서id} 처럼 하위 세그먼트가 있으면 type none', () => {
    expect(parsePathRoute('/p/f/tok1/doc1')).toEqual({ type: 'none' })
  })

  it('/p/a/b 는 type none', () => {
    expect(parsePathRoute('/p/a/b')).toEqual({ type: 'none' })
  })
})
