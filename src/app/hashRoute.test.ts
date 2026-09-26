import { describe, it, expect } from 'vitest'
import {
  parseHash,
  formatHash,
  formatShareHash,
  formatCommentHash,
  formatPublicFolderHash,
  formatPublicHash,
  formatMapHash,
  parsePathRoute,
} from './hashRoute'

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

  it('#/p/{토큰}/{문서id} 형식이면 type public, docId 포함 (F-252.md 4.2 C3)', () => {
    expect(parseHash('#/p/abc-token/doc1')).toEqual({ type: 'public', token: 'abc-token', docId: 'doc1' })
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

  it('#/shares 는 type shares (F-243 A7)', () => {
    expect(parseHash('#/shares')).toEqual({ type: 'shares' })
  })

  it('#/s/abc 는 shares 가 아니라 share', () => {
    expect(parseHash('#/s/abc')).toEqual({ type: 'share', fragment: 'abc' })
  })

  it('#/shares/x 는 type none', () => {
    expect(parseHash('#/shares/x')).toEqual({ type: 'none' })
  })

  it('#/help 는 type help (F-244 A2)', () => {
    expect(parseHash('#/help')).toEqual({ type: 'help' })
  })

  it('#/helper 는 type none', () => {
    expect(parseHash('#/helper')).toEqual({ type: 'none' })
  })

  it('#/help/x 는 type none', () => {
    expect(parseHash('#/help/x')).toEqual({ type: 'none' })
  })

  it('문자열이 아니면 type none', () => {
    expect(parseHash(undefined)).toEqual({ type: 'none' })
  })

  it('#/map 은 type map, docId 없음 (F-292.md 6.1)', () => {
    expect(parseHash('#/map')).toEqual({ type: 'map' })
  })

  it('#/map/{docId} 는 type map, docId 포함', () => {
    expect(parseHash('#/map/abc-123')).toEqual({ type: 'map', docId: 'abc-123' })
  })

  it('#/map/ 은 / 뒤가 비어 type none', () => {
    expect(parseHash('#/map/')).toEqual({ type: 'none' })
  })

  it('#/map/a/b 처럼 / 를 더 담으면 type none', () => {
    expect(parseHash('#/map/a/b')).toEqual({ type: 'none' })
  })

  it('#/mapping 은 map 이 아니라 none', () => {
    expect(parseHash('#/mapping')).toEqual({ type: 'none' })
  })
})

describe('parseHash — 댓글 주소 U17 (F-505.md 3.3)', () => {
  it('#/d/{id}/c/{tid} 는 type doc, docId·threadId 를 돌려준다', () => {
    expect(parseHash('#/d/abc/c/t1')).toEqual({ type: 'doc', docId: 'abc', threadId: 't1' })
  })

  it('#/d/{id}/c/ 는(빈 threadId) 지금 규칙대로 문서 id 전체를 먹는다', () => {
    expect(parseHash('#/d/abc/c/')).toEqual({ type: 'doc', docId: 'abc/c/' })
  })

  it('#/d/{id} 는 threadId 키 자체가 없다', () => {
    const r = parseHash('#/d/abc')
    expect(r).toEqual({ type: 'doc', docId: 'abc' })
    expect('threadId' in r).toBe(false)
  })
})

describe('formatCommentHash — U18 (F-505.md 3.3)', () => {
  it('#/d/{docId}/c/{threadId} 를 만들고 parseHash 로 되돌아온다', () => {
    const hash = formatCommentHash('abc', 't1')
    expect(hash).toBe('#/d/abc/c/t1')
    expect(parseHash(hash)).toEqual({ type: 'doc', docId: 'abc', threadId: 't1' })
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

describe('formatPublicHash', () => {
  it('docId 없으면 #/p/{토큰} (F-252.md 4.2)', () => {
    expect(formatPublicHash('tok1')).toBe('#/p/tok1')
  })

  it('docId 있으면 #/p/{토큰}/{docId}', () => {
    expect(formatPublicHash('tok1', 'doc1')).toBe('#/p/tok1/doc1')
  })
})

describe('formatMapHash', () => {
  it('docId 없으면 #/map', () => {
    expect(formatMapHash()).toBe('#/map')
  })

  it('docId 있으면 #/map/{docId}', () => {
    expect(formatMapHash('doc1')).toBe('#/map/doc1')
  })

  it('docId 가 null 이면 #/map', () => {
    expect(formatMapHash(null)).toBe('#/map')
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
