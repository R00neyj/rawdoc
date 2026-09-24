// F-257 도움말 문서 — 앱 사용법 + 마크다운 문법 두 축 (specs/features/F-257.md 5장 G1~G4)
import { describe, it, expect } from 'vitest'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'
import brand from '../../brand.config'

// F-257.md 2장 표의 절 순서 그대로
const SECTION_ORDER = [
  '이 앱은',
  '화면',
  '글쓰기',
  '문서 관리',
  '저장',
  '이미지',
  '위키링크',
  '공유',
  '내보내기·가져오기',
  '설치와 오프라인',
  '단축키',
  '마크다운 문법',
]

// F-244.md 3.1 이 명시한 GROUPS 항목 이름 전부(순서 무관) — 문법 설명이 빠지지 않았는지 (G3)
const GROUP_ITEM_NAMES = [
  '제목',
  '굵게',
  '기울임',
  '취소선',
  '인라인코드',
  '글머리 목록',
  '번호 목록',
  '체크박스',
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

function fence(source: string): string {
  const ticks = source.includes('```') ? '````' : '```'
  return `${ticks}\n${source}\n${ticks}`
}

describe('HELP_DOC_TITLE', () => {
  it('도움말', () => {
    expect(HELP_DOC_TITLE).toBe('도움말')
  })
})

describe('HELP_DOC_CONTENT', () => {
  it('첫 줄이 # 도움말 이다 (G2)', () => {
    expect(HELP_DOC_CONTENT.startsWith('# 도움말\n')).toBe(true)
  })

  it('2장 표의 절이 그 순서로 모두 있다 (G1)', () => {
    let cursor = -1
    for (const name of SECTION_ORDER) {
      const idx = HELP_DOC_CONTENT.indexOf(`## ${name}`)
      expect(idx, `## ${name} 이 없다`).toBeGreaterThan(-1)
      expect(idx, `## ${name} 이 앞 절보다 먼저 나온다`).toBeGreaterThan(cursor)
      cursor = idx
    }
  })

  it('GROUPS 의 모든 항목 이름이 문서에 남아 있다 (G3)', () => {
    for (const name of GROUP_ITEM_NAMES) {
      expect(HELP_DOC_CONTENT).toContain(name)
    }
  })

  it('## 마크다운 문법 이 ## 단축키 뒤에 온다 (G4)', () => {
    const syntaxIdx = HELP_DOC_CONTENT.indexOf('## 마크다운 문법')
    const shortcutIdx = HELP_DOC_CONTENT.indexOf('## 단축키')
    expect(syntaxIdx).toBeGreaterThan(-1)
    expect(shortcutIdx).toBeGreaterThan(-1)
    expect(syntaxIdx).toBeGreaterThan(shortcutIdx)
  })

  it('각 문법에 코드블록 원문이 하나씩 있다', () => {
    const sources = [
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
    for (const source of sources) {
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

  it('사용자가 넣은 콜아웃 예시 원문은 담지 않는다 (F-257.md 1장 하지 않는다)', () => {
    expect(HELP_DOC_CONTENT).not.toContain('파일을 그대로 장기기억으로')
  })

  it('U22: 저장 절 끝에 한도 문단이 있고, ## 한도 절은 없다 (F-2030 8장)', () => {
    const limitParagraph =
      '로그인한 계정은 문서 본문을 모두 합쳐 100MB, 문서 10,000개까지 서버에 저장할 수 있습니다. 저장·이동·삭제처럼 서버에 쓰는 일은 계정마다 하루 5,000번까지이고, 한국 시간 오전 9시(UTC 자정)에 다시 셉니다. 한도에 닿아도 편집한 내용은 이 브라우저에 남아 있다가, 공간을 비우거나 시간이 지나면 서버로 올라갑니다.'
    expect(HELP_DOC_CONTENT).toContain(limitParagraph)
    const saveIdx = HELP_DOC_CONTENT.indexOf('## 저장')
    const limitIdx = HELP_DOC_CONTENT.indexOf(limitParagraph)
    const imageIdx = HELP_DOC_CONTENT.indexOf('## 이미지')
    expect(limitIdx).toBeGreaterThan(saveIdx)
    expect(limitIdx).toBeLessThan(imageIdx)
    expect(HELP_DOC_CONTENT).not.toContain('## 한도')
  })

  it('제품명 문자열을 직접 쓰지 않는다(CLAUDE.md 불변조건)', () => {
    expect(HELP_DOC_CONTENT).not.toContain(brand.name)
    expect(HELP_DOC_CONTENT.toLowerCase()).not.toContain(brand.shortName.toLowerCase())
  })

  it('이미지 캡션에 ![설명](주소) 표준 이미지 문법을 그대로 쓰지 않는다 (F-274.md 4.2 — 빌드 가드 G4 회피)', () => {
    expect(HELP_DOC_CONTENT).not.toMatch(/!\[[^\]]*\]\([^)]*\)/)
  })
})
