// 제목 id·문서 목록 데이터 (specs/features/F-2036.md 8.1 A1~A5)
import { describe, expect, it } from 'vitest'
import { headingSlug, siteHeadings, addHeadingIds, buildDocNav } from './pageNav'
import { renderMarkdown } from '../src/viewer/renderMarkdown'
import { HELP_DOC_CONTENT } from '../src/app/helpDoc'
import { SITE_NAV, SITE_FOOTER_LINKS, GUIDES_PATH } from '../src/lib/siteChrome'

describe('F-2036 A1 id 규칙', () => {
  it.each([
    ['이 앱은', '이-앱은'],
    ['내보내기·가져오기', '내보내기가져오기'],
    ['1. 한 문서에 한 생각', '1-한-문서에-한-생각'],
    ['2026-09-24', '2026-09-24'],
    ['Hello World!', 'hello-world'],
    ['A_B-c', 'a_b-c'],
    ['…', '절'],
    ['(제목 없음)', '제목-없음'],
  ])('%s → %s', (text, id) => {
    expect(headingSlug(text)).toBe(id)
  })
})

describe('F-2036 A2 중복 처리', () => {
  it('같은 제목이 반복되면 -1·-2 로 늘어난다', () => {
    const headings = siteHeadings('## 가\n\n## 가 1\n\n## 가\n')
    expect(headings.map((h) => h.id)).toEqual(['가', '가-1', '가-2'])
  })

  it('도움말 41개, 첫 항목은 h1 도움말, id 가 모두 다르고 중복 글자는 -1 이 붙는다', () => {
    const headings = siteHeadings(HELP_DOC_CONTENT)
    expect(headings).toHaveLength(41)
    expect(headings[0]).toEqual({ level: 1, text: '도움말', id: '도움말', line: headings[0].line })
    const ids = headings.map((h) => h.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('이미지')
    expect(ids).toContain('이미지-1')
    expect(ids).toContain('위키링크')
    expect(ids).toContain('위키링크-1')
  })
})

describe('F-2036 A3 단계·제외', () => {
  it('h1~h3 최상위만 담고 코드펜스·인용 안 제목·h4 는 빠진다', () => {
    const body = [
      '# 하나',
      '',
      '#### 넷',
      '',
      '```',
      '# 코드',
      '```',
      '',
      '> ## 인용 안',
      '',
      '#',
    ].join('\n')
    const headings = siteHeadings(body)
    expect(headings.map((h) => h.text)).toEqual(['하나', '(제목 없음)'])
    expect(headings.map((h) => h.id)).toEqual(['하나', '제목-없음'])
  })
})

describe('F-2036 A4 id 끼우기', () => {
  it('제목마다 id 가 한 번씩 끼고, id 를 지우면 원본과 같고, 없는 줄이면 에러', () => {
    const html = renderMarkdown(HELP_DOC_CONTENT)
    const headings = siteHeadings(HELP_DOC_CONTENT)
    const withIds = addHeadingIds(html, headings)

    for (const heading of headings) {
      const tag = `<h${heading.level} id="${heading.id}" data-source-line="${heading.line}">`
      expect(withIds.split(tag).length - 1).toBe(1)
    }
    expect(withIds.replace(/ id="[^"]*"/g, '')).toBe(html)

    expect(() => addHeadingIds(html, [...headings, { level: 2, text: '없음', id: '없음', line: 9999 }])).toThrow(
      /9999/,
    )
  })
})

describe('F-2036 A5 문서 목록 데이터', () => {
  it('사용법 글이 /guides 아래 날짜 내림차순으로, 나머지는 SITE_NAV·SITE_FOOTER_LINKS 순서로 붙는다', () => {
    const savedNav = SITE_NAV.splice(0, SITE_NAV.length)
    const savedFooter = SITE_FOOTER_LINKS.splice(0, SITE_FOOTER_LINKS.length)
    SITE_NAV.push({ path: GUIDES_PATH, label: '사용법' }, { path: '/changelog', label: '체인지로그' }, { path: '/help', label: '도움말' })
    SITE_FOOTER_LINKS.push({ path: '/privacy', label: '개인정보 처리방침' }, { path: '/terms', label: '이용약관' })
    try {
      const guides = [
        { url: '/guides/a', title: '에이', summary: '', date: '2026-09-01' },
        { url: '/guides/b', title: '비', summary: '', date: '2026-09-05' },
      ]
      const nav = buildDocNav(guides)
      expect(nav.main.map((l) => l.label)).toEqual(['사용법', '체인지로그', '도움말'])
      expect(nav.main[0].children?.map((c) => c.label)).toEqual(['비', '에이'])
      expect(nav.legal.map((l) => l.label)).toEqual(['개인정보 처리방침', '이용약관'])
    } finally {
      SITE_NAV.length = 0
      SITE_NAV.push(...savedNav)
      SITE_FOOTER_LINKS.length = 0
      SITE_FOOTER_LINKS.push(...savedFooter)
    }
  })

  it('SITE_NAV 에 /guides 가 없으면 사용법 글이 목록 어디에도 없다', () => {
    const savedNav = SITE_NAV.splice(0, SITE_NAV.length)
    SITE_NAV.push({ path: '/changelog', label: '체인지로그' })
    try {
      const nav = buildDocNav([{ url: '/guides/a', title: '에이', summary: '', date: '2026-09-01' }])
      expect(nav.main).toEqual([{ url: '/changelog', label: '체인지로그' }])
    } finally {
      SITE_NAV.length = 0
      SITE_NAV.push(...savedNav)
    }
  })
})
