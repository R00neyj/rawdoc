// wikiLink.js 단위 테스트 (specs/features/F-131.md 7장 A1)
import { describe, expect, it } from 'vitest'
import { findWikiLinks, resolveWikiTarget } from './wikiLink'

describe('findWikiLinks — 2장 표', () => {
  it('[[회의록]] — 대상·보이는 글자 모두 회의록', () => {
    const [m] = findWikiLinks('[[회의록]]')
    expect(m.target).toBe('회의록')
    expect(m.alias).toBeNull()
    expect(m.from).toBe(0)
    expect(m.to).toBe('[[회의록]]'.length)
  })

  it('[[회의록|9월 회의]] — 대상 회의록, 별칭 9월 회의', () => {
    const [m] = findWikiLinks('[[회의록|9월 회의]]')
    expect(m.target).toBe('회의록')
    expect(m.alias).toBe('9월 회의')
  })

  it('[[회의록#결정]] — 대상은 # 앞까지, 범위는 원문 전체(보이는 글자용)', () => {
    const line = '[[회의록#결정]]'
    const [m] = findWikiLinks(line)
    expect(m.target).toBe('회의록')
    expect(m.alias).toBeNull()
    expect(line.slice(m.targetFrom, m.targetTo)).toBe('회의록#결정')
  })
})

describe('findWikiLinks — 제외 대상', () => {
  it('빈 대상 [[]] 는 위키링크가 아니다', () => {
    expect(findWikiLinks('[[]]')).toEqual([])
  })

  it('공백뿐인 대상 [[   ]] 는 위키링크가 아니다', () => {
    expect(findWikiLinks('[[   ]]')).toEqual([])
  })

  it('줄바꿈이 든 [[a\\nb]] 는 위키링크가 아니다', () => {
    expect(findWikiLinks('[[a\nb]]')).toEqual([])
  })

  it('이미지식 ![[a]] 는 대상이 아니다', () => {
    expect(findWikiLinks('![[a]]')).toEqual([])
  })
})

describe('findWikiLinks — 한 줄 여러 개', () => {
  it('두 개가 각자 위치를 갖는다', () => {
    const line = '앞 [[a]] 가운데 [[b|B]] 뒤'
    const matches = findWikiLinks(line)
    expect(matches).toHaveLength(2)
    expect(line.slice(matches[0].from, matches[0].to)).toBe('[[a]]')
    expect(line.slice(matches[1].from, matches[1].to)).toBe('[[b|B]]')
    expect(matches[0].target).toBe('a')
    expect(matches[1].target).toBe('b')
    expect(matches[1].alias).toBe('B')
  })
})

describe('resolveWikiTarget — 매칭 규칙', () => {
  const docs = [
    { id: '1', title: '회의록', updatedAt: 3 },
    { id: '2', title: '다른 문서', updatedAt: 2 },
    { id: '3', title: '', updatedAt: 1 }, // 제목 빈 문서
  ]

  it('규칙 1: 정확히 같은 제목', () => {
    expect(resolveWikiTarget('회의록', docs)).toEqual(docs[0])
  })

  it('규칙 2: 대소문자 무시(정확히 같은 제목이 없을 때)', () => {
    const enDocs = [{ id: 'a', title: 'Meeting', updatedAt: 1 }]
    expect(resolveWikiTarget('meeting', enDocs)).toEqual(enDocs[0])
  })

  it('규칙 3: 여러 개면 목록 앞(최근 수정) 것', () => {
    const dup = [
      { id: 'new', title: '기록', updatedAt: 2 },
      { id: 'old', title: '기록', updatedAt: 1 },
    ]
    expect(resolveWikiTarget('기록', dup)).toEqual(dup[0])
  })

  it('없는 제목은 null', () => {
    expect(resolveWikiTarget('없는 문서', docs)).toBeNull()
  })

  it('제목이 빈 문서는 매칭하지 않는다', () => {
    expect(resolveWikiTarget('', docs)).toBeNull()
    expect(resolveWikiTarget('   ', docs)).toBeNull()
  })

  it('대상 앞뒤 공백은 무시한다', () => {
    expect(resolveWikiTarget('  회의록  ', docs)).toEqual(docs[0])
  })
})
