// F-2087 보기 모드 찾기 순수 함수 — U1~U12
import { describe, expect, it } from 'vitest'
import {
  findViewMatches, formatFindCount, locateOffset, normalizeBlockText, pickStartIndex, scrollTopToReveal, VIEW_FIND_LIMIT,
  type ViewFindQuery,
} from '../../../src/viewer/viewFindMatch'

const q = (search: string, over: Partial<ViewFindQuery> = {}): ViewFindQuery => ({
  search, caseSensitive: false, regexp: false, wholeWord: false, ...over,
})
const find = (blocks: string[], query: ViewFindQuery) => findViewMatches(blocks, query).matches

describe('F-2087 U1 기본 찾기', () => {
  it('사과 두 개', () => {
    expect(find(['사과 바나나 사과'], q('사과'))).toEqual([
      { block: 0, from: 0, to: 2 },
      { block: 0, from: 7, to: 9 },
    ])
  })
  it('대소문자 무시, 겹치지 않게', () => {
    expect(find(['apple'], q('Apple'))).toHaveLength(1)
    expect(find(['aaaa'], q('aa'))).toHaveLength(2)
  })
  it('빈 검색어는 매치 없음', () => {
    expect(find(['abc'], q(''))).toEqual([])
  })
})

describe('F-2087 U2 대소문자 구분', () => {
  it('켜면 못 찾는다', () => {
    expect(find(['apple'], q('Apple', { caseSensitive: true }))).toHaveLength(0)
    expect(find(['Apple'], q('Apple', { caseSensitive: true }))).toHaveLength(1)
  })
})

describe('F-2087 U3 길이가 바뀌는 소문자', () => {
  it('İstanbul 에서 stanbul 오프셋', () => {
    expect(find(['İstanbul'], q('stanbul'))).toEqual([{ block: 0, from: 1, to: 8 }])
  })
})

describe('F-2087 U4 정규식', () => {
  it('사. 는 사과·사람', () => {
    expect(find(['사과 사람'], q('사.', { regexp: true }))).toHaveLength(2)
  })
  it('잘못된 정규식은 0개, 예외 없음', () => {
    expect(find(['[a]'], q('[', { regexp: true }))).toEqual([])
  })
  it('길이 0 매치는 없다', () => {
    expect(find(['abc'], q('x*', { regexp: true }))).toEqual([])
  })
  it('대소문자 구분 끔이면 i', () => {
    expect(find(['ABC'], q('abc', { regexp: true }))).toHaveLength(1)
    expect(find(['ABC'], q('abc', { regexp: true, caseSensitive: true }))).toHaveLength(0)
  })
})

describe('F-2087 U5 단어 단위', () => {
  const w = (s: string) => q(s, { wholeWord: true })
  it('한글 단어 글자', () => {
    expect(find(['사과를'], w('사과'))).toHaveLength(0)
    expect(find(['사과 를'], w('사과'))).toHaveLength(1)
  })
  it('foo 경계', () => {
    expect(find(['foo.bar'], w('foo'))).toHaveLength(1)
    expect(find(['foobar'], w('foo'))).toHaveLength(0)
    expect(find(['_foo'], w('foo'))).toHaveLength(0)
  })
  it('블록 처음·끝은 경계', () => {
    expect(find(['foo'], w('foo'))).toHaveLength(1)
  })
})

describe('F-2087 U6 블록을 넘지 않는다', () => {
  it('끝 + 시작', () => {
    expect(find(['끝', '시작'], q('끝시작'))).toEqual([])
  })
})

describe('F-2087 U7 풀어 읽기', () => {
  it('정규식 끔이면 \\t 가 탭', () => {
    expect(find(['a\tb'], q('a\\tb'))).toHaveLength(1)
  })
  it('정규식 켬이면 정규식 문법', () => {
    expect(find(['a\tb'], q('a\\tb', { regexp: true }))).toHaveLength(1)
    expect(find(['a\\tb'], q('a\\\\tb', { regexp: true }))).toHaveLength(1)
  })
})

describe('F-2087 U8 한도', () => {
  it('1000개에서 자른다', () => {
    const r = findViewMatches(['a'.repeat(1200)], q('a'))
    expect(VIEW_FIND_LIMIT).toBe(1000)
    expect(r.matches).toHaveLength(1000)
    expect(r.truncated).toBe(true)
  })
  it('딱 1000개면 자르지 않았다', () => {
    const r = findViewMatches(['a'.repeat(1000)], q('a'))
    expect(r.truncated).toBe(false)
  })
})

describe('F-2087 U9 블록 글자 정리', () => {
  it('pre 밖은 공백 1:1', () => {
    expect(normalizeBlockText('a\nb\tc', false)).toBe('a b c')
    expect(normalizeBlockText('a\nb\tc', true)).toBe('a\nb\tc')
  })
})

describe('F-2087 U10 오프셋 → 노드', () => {
  it('시작·끝', () => {
    expect(locateOffset([0, 3, 5], 4, 'start')).toEqual({ node: 1, offset: 1 })
    expect(locateOffset([0, 3, 5], 5, 'end')).toEqual({ node: 1, offset: 2 })
    expect(locateOffset([0, 3, 5], 3, 'start')).toEqual({ node: 1, offset: 0 })
  })
})

describe('F-2087 U11 시작 매치', () => {
  it('보이는 맨 위 아래 첫 매치', () => {
    expect(pickStartIndex([10, 50, 90], 40)).toBe(1)
    expect(pickStartIndex([10, 50], 100)).toBe(0)
    expect(pickStartIndex([], 0)).toBe(0)
  })
})

describe('F-2087 U12 개수 문구·스크롤 목표', () => {
  it('개수 문구', () => {
    expect(formatFindCount(true, 0, 0, false)).toBe('')
    expect(formatFindCount(false, 0, 0, false)).toBe('결과 없음')
    expect(formatFindCount(false, 2, 12, false)).toBe('3/12')
    expect(formatFindCount(false, 2, 1000, true)).toBe('3/1000+')
  })
  const base = { viewTop: 0, viewBottom: 600, cover: 60, scrollTop: 1000 }
  it('다 보이면 null', () => {
    expect(scrollTopToReveal({ ...base, matchTop: 100, matchBottom: 120 })).toBeNull()
  })
  it('아래로 벗어나면 가운데로', () => {
    expect(scrollTopToReveal({ ...base, matchTop: 800, matchBottom: 820 })).toBe(1000 + 810 - 330)
  })
  it('가림 밑으로 벗어나도 옮긴다', () => {
    expect(scrollTopToReveal({ ...base, matchTop: 20, matchBottom: 40 })).toBe(1000 + 30 - 330)
  })
  it('0 미만이면 0', () => {
    expect(scrollTopToReveal({ ...base, scrollTop: 10, matchTop: -100, matchBottom: -80 })).toBe(0)
  })
})
