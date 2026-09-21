// 사용법 목록 가상 글 (specs/features/F-276.md 3.2, A1~A4)
import { describe, expect, it } from 'vitest'
import { guideEntry, sortGuideEntries, guidesIndexContent } from './guidesIndex'

describe('F-276 A1 guideEntry', () => {
  it('프론트매터에서 title·summary·date 를 읽는다', () => {
    const raw = '---\ntitle: 제목\nsummary: 요약\ndate: 2026-09-01\n---\n본문'
    expect(guideEntry('/guides/a', raw)).toEqual({ url: '/guides/a', title: '제목', summary: '요약', date: '2026-09-01' })
  })

  it('summary 가 없으면 빈 문자열이다 (SITE_DESCRIPTION 이 아니다)', () => {
    const raw = '---\ntitle: 제목\n---\n본문'
    expect(guideEntry('/guides/a', raw).summary).toBe('')
  })

  it('프론트매터가 없으면 title·summary 는 빈 문자열, date 는 undefined', () => {
    const entry = guideEntry('/guides/a', '본문만')
    expect(entry.title).toBe('')
    expect(entry.summary).toBe('')
    expect(entry.date).toBeUndefined()
  })
})

describe('F-276 A2 sortGuideEntries', () => {
  it('date 내림차순, 없으면 맨 뒤, 같으면 url 오름차순, 입력 배열을 바꾸지 않는다', () => {
    const entries = [
      { url: '/guides/none', title: 'x', summary: '' },
      { url: '/guides/b', title: 'x', summary: '', date: '2026-09-01' },
      { url: '/guides/a', title: 'x', summary: '', date: '2026-09-01' },
      { url: '/guides/c', title: 'x', summary: '', date: '2026-09-03' },
    ]
    const original = [...entries]
    const sorted = sortGuideEntries(entries)
    expect(sorted.map((e) => e.url)).toEqual(['/guides/c', '/guides/a', '/guides/b', '/guides/none'])
    expect(entries).toEqual(original)
  })
})

describe('F-276 A3 guidesIndexContent', () => {
  it('프론트매터로 시작하고 목록이 그 순서로 들어 있다', () => {
    const content = guidesIndexContent([
      { url: '/guides/a', title: '제목', summary: '요약' },
      { url: '/guides/b', title: 'ㄴ', summary: '' },
    ])
    expect(content.startsWith('---\ntitle: 사용법\nsummary:')).toBe(true)
    expect(content).not.toContain('---\n\n')
    expect(content).toContain('# 사용법')
    const lines = content.split('\n')
    const aIdx = lines.indexOf('- [제목](/guides/a) — 요약')
    const bIdx = lines.indexOf('- [ㄴ](/guides/b)')
    expect(aIdx).toBeGreaterThanOrEqual(0)
    expect(bIdx).toBeGreaterThan(aIdx)
  })

  it('제목의 대괄호를 이스케이프한다', () => {
    const content = guidesIndexContent([{ url: '/guides/a', title: '[중요] 제목', summary: '' }])
    expect(content).toContain('- [\\[중요\\] 제목](/guides/a)')
  })
})

describe('F-276 A4 guidesIndexContent 빈 목록', () => {
  it('아직 올라온 글이 없습니다 문구만 있고 목록 항목이 없다', () => {
    const content = guidesIndexContent([])
    expect(content).toContain('아직 올라온 글이 없습니다.')
    expect(content.split('\n').some((line) => line.startsWith('- ['))).toBe(false)
  })
})
