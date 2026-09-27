import { describe, expect, it } from 'vitest'
import { matchTerm, prepareMatchText, splitMatchTerms } from './hangulMatch'

// U1 (specs/features/F-2053.md 11.1)
describe('matchTerm — U1', () => {
  const cases: [string, string, { start: boolean; loose: boolean } | null][] = [
    ['ㅅㅁㅅ', '새 문서', { start: true, loose: true }],
    ['템ㅍ', '템플릿 삽입', { start: true, loose: true }],
    ['템프', '템플릿', { start: true, loose: true }],
    ['ㄳ', '공사 일정', { start: true, loose: true }],
    ['ㄱㅅ', '공사 일정', { start: true, loose: true }],
    ['ㄲ', '꼭 할 일', { start: true, loose: true }],
    ['ㄱ', '꼭 할 일', null],
    ['ㅍㄹ', '템플릿', { start: false, loose: true }],
    ['ㅋㅋ', 'ㅋㅋ 웃긴 글', { start: true, loose: false }],
    ['meet', 'Meeting notes', { start: true, loose: false }],
    ['가', '강아지', { start: true, loose: true }],
    ['가', '가계부', { start: true, loose: false }],
    ['ㅏ', '가', null],
  ]

  for (const [q, t, expected] of cases) {
    it(`(${q}, ${t}) → ${JSON.stringify(expected)}`, () => {
      const terms = splitMatchTerms(q)
      const hit = matchTerm(terms[terms.length - 1], prepareMatchText(t))
      expect(hit).toEqual(expected)
    })
  }

  it("'템플'.normalize('NFD') 와 템플릿 — NFC 로 정규화해 일반 비교로 맞는다", () => {
    const terms = splitMatchTerms('템플'.normalize('NFD'))
    const hit = matchTerm(terms[0], prepareMatchText('템플릿'))
    expect(hit).toEqual({ start: true, loose: false })
  })

  it("'템프 삽입' 두 조각의 첫 조각(템프, last:false)은 템플릿 삽입 에 받침 규칙이 없어 안 맞는다", () => {
    const terms = splitMatchTerms('템프 삽입')
    expect(terms[0].last).toBe(false)
    const hit = matchTerm(terms[0], prepareMatchText('템플릿 삽입'))
    expect(hit).toBeNull()
  })
})

// 조합 중 받침이 다음 글자 초성으로 넘어간 경우 — main 결정 2026-09-28(명세에는 없던 추가 규칙). "가게"를 치다 "각"이 되는 순간 목록이 비지 않게
describe('matchTerm — 받침이 다음 글자로 넘어간 경우 (main 결정)', () => {
  const cases: [string, string, { start: boolean; loose: boolean } | null][] = [
    ['각', '가게', { start: true, loose: true }], // 홑받침 ㄱ → 다음 글자 초성 ㄱ
    ['앉', '안자', { start: true, loose: true }], // 겹받침 ㄵ(ㄴ+ㅈ) → 앞 자음 받침, 뒤 자음 다음 초성
    ['각', '가나', null], // 다음 글자 초성이 받침과 다르면 안 맞는다
    ['각', '가', null], // 다음 글자가 없으면 안 맞는다
  ]

  for (const [q, t, expected] of cases) {
    it(`(${q}, ${t}) → ${JSON.stringify(expected)}`, () => {
      const terms = splitMatchTerms(q)
      const hit = matchTerm(terms[terms.length - 1], prepareMatchText(t))
      expect(hit).toEqual(expected)
    })
  }
})
