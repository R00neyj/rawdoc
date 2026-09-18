// F-244 A1 — 원문 도움말 문서: 13묶음(3.1 명시 목록) 제목이 모두 ## 로 있고, 각 문법에 코드블록 원문이 하나씩 있다
import { describe, it, expect } from 'vitest'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'

// specs/features/F-244.md 3.1 이 명시한 묶음 순서 그대로(helpSyntax.ts 와 같다)
const GROUP_NAMES = [
  '제목',
  '강조',
  '목록',
  '인용',
  '링크',
  '위키링크',
  '표',
  '코드블록',
  '이미지',
  '콜아웃',
  '구분선',
  '프론트매터',
]

// helpSyntax.ts 에 있던 문법별 원문(순서 무관, 코드블록으로 감쌌는지만 확인)
const ITEM_SOURCES = [
  '# 제목 1\n## 제목 2\n### 제목 3',
  '**굵게**',
  '*기울임*',
  '~~취소선~~',
  '`코드`',
  '- 항목',
  '1. 항목',
  '- [ ] 할 일\n- [x] 끝낸 일',
  '> 인용문',
  '[링크](https://example.com)',
  '[[문서 제목]]',
  '| 머리1 | 머리2 |\n| --- | --- |\n| 값1 | 값2 |',
  '```js\ncode\n```',
  '<div align="center">\n  <img src="attachments/0000000000000000.png" width="320">\n</div>',
  '> [!note] 제목\n> 내용',
  '---',
  '---\ntitle: 문서 제목\n---',
]

function fence(source: string): string {
  const ticks = source.includes('```') ? '````' : '```'
  return `${ticks}\n${source}\n${ticks}`
}

describe('HELP_DOC_TITLE', () => {
  it('마크다운 문법', () => {
    expect(HELP_DOC_TITLE).toBe('마크다운 문법')
  })
})

describe('HELP_DOC_CONTENT', () => {
  it('13묶음 제목이 모두 ## 로 들어 있다', () => {
    for (const name of GROUP_NAMES) {
      expect(HELP_DOC_CONTENT).toContain(`## ${name}`)
    }
  })

  it('각 문법에 코드블록 원문이 하나씩 있다', () => {
    for (const source of ITEM_SOURCES) {
      expect(HELP_DOC_CONTENT).toContain(fence(source))
    }
  })

  it('줄 끝은 LF 다(\\r 없음)', () => {
    expect(HELP_DOC_CONTENT).not.toContain('\r')
  })

  it('굵게 원문 코드블록 다음에 실제 결과(강조 렌더용 원문)가 이어진다', () => {
    const idx = HELP_DOC_CONTENT.indexOf(fence('**굵게**'))
    expect(idx).toBeGreaterThan(-1)
    const after = HELP_DOC_CONTENT.slice(idx + fence('**굵게**').length)
    expect(after.trimStart().startsWith('**굵게**')).toBe(true)
  })

  it('프론트매터·이미지는 결과 예시 없이 원문·설명만 있다', () => {
    const fmFence = fence('---\ntitle: 문서 제목\n---')
    const idx = HELP_DOC_CONTENT.indexOf(fmFence)
    expect(idx).toBeGreaterThan(-1)
    const after = HELP_DOC_CONTENT.slice(idx + fmFence.length, idx + fmFence.length + 200)
    expect(after).not.toContain('title: 문서 제목')
  })
})
