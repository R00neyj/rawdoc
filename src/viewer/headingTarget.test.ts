// headingTarget 단위 테스트 (specs/features/F-2018.md 15.1 U9·U10)
import { describe, expect, it } from 'vitest'
import { findHeadingLine, listDocHeadings } from './headingTarget'
import { renderMarkdown } from './renderMarkdown'

function renderedHeadingLines(markdown: string): { level: number; line: number }[] {
  const html = renderMarkdown(markdown, { sourceLines: true })
  return [...html.matchAll(/<h([1-6])\b[^>]*data-source-line="(\d+)"/g)].map((m) => ({ level: Number(m[1]), line: Number(m[2]) }))
}

describe('U9 — listDocHeadings', () => {
  it('ATX 1~6·Setext 1~2', () => {
    const md = '# 하나\n\n## 둘\n\n### 셋\n\n#### 넷\n\n##### 다섯\n\n###### 여섯\n\n세텍스트 일\n===\n\n세텍스트 이\n---\n'
    const headings = listDocHeadings(md)
    expect(headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, '하나', 1],
      [2, '둘', 3],
      [3, '셋', 5],
      [4, '넷', 7],
      [5, '다섯', 9],
      [6, '여섯', 11],
      [1, '세텍스트 일', 13],
      [2, '세텍스트 이', 16],
    ])
  })

  it('펜스 안 #·- item\\n---·인용 안 제목은 제외', () => {
    const md = '```\n# 코드 안\n```\n\n- item\n---\n\n> ## 인용 안\n\n## 진짜'
    expect(listDocHeadings(md).map((h) => h.text)).toEqual(['진짜'])
  })

  it('프론트매터가 있을 때 line 이 renderMarkdown(sourceLines) 의 data-source-line 과 같다', () => {
    const md = '---\ntitle: x\ntags: [a]\n---\n# 처음\n\n본문\n\n#### 넷째\n\n여러\n줄\n===\n'
    const headings = listDocHeadings(md)
    expect(headings.map((h) => ({ level: h.level, line: h.line }))).toEqual(renderedHeadingLines(md))
    expect(headings.map((h) => h.line)).toEqual([5, 9, 11])
  })

  it('text 는 보이는 글자, raw 는 원문', () => {
    const md = '## **중요** 결정 `코드` [[회의록#결정]]\n\n여러\n줄\n===\n'
    const [first, second] = listDocHeadings(md)
    expect(first.text).toBe('중요 결정 코드 회의록#결정')
    expect(first.raw).toBe('**중요** 결정 `코드` [[회의록#결정]]')
    expect(second.text).toBe('여러 줄')
  })
})

describe('U10 — findHeadingLine', () => {
  it('정확 일치가 앞의 대소문자 일치를 이긴다', () => {
    const md = '## decision\n\n## Decision\n'
    expect(findHeadingLine(md, 'Decision')).toBe(3)
    expect(findHeadingLine(md, 'DECISION')).toBe(1)
  })

  it('같은 단계 여럿이면 문서 순서 첫 것', () => {
    expect(findHeadingLine('## 결정\n\n## 결정\n', '결정')).toBe(1)
  })

  it('# ^ : | [ ] % 를 지우고 공백을 접어 비교한다', () => {
    const md = '## 질문: 무엇을  할까 [초안] 100%\n'
    expect(findHeadingLine(md, '질문 무엇을 할까 초안 100')).toBe(1)
  })

  it('raw 와도 비교한다', () => {
    const md = '## **중요** 결정\n'
    expect(findHeadingLine(md, '**중요** 결정')).toBe(1)
    expect(findHeadingLine(md, '중요 결정')).toBe(1)
  })

  it('못 찾으면 null', () => {
    expect(findHeadingLine('## 결정\n', '없음')).toBeNull()
    expect(findHeadingLine('본문만', '결정')).toBeNull()
  })
})
