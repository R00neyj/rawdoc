// F-257 도움말 문서 — 앱 사용법 + 마크다운 문법 두 축 (specs/features/F-257.md 5장 G1~G4)
import { describe, it, expect } from 'vitest'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'
import brand from '../../brand.config'
import { E2EE_DEFAULT_LOCK_MINUTES } from '../e2ee/keyring'
import { E2EE_MAX_PLAIN_CONTENT_BYTES } from '../lib/e2eeLimits'
import { WIKI_PREVIEW_OPEN_DELAY_MS } from './wikiPreview'

// F-257.md 2장 표의 절 순서 그대로
const SECTION_ORDER = [
  '이 앱은',
  '화면',
  '글쓰기',
  '문서 관리',
  '저장',
  '이미지',
  '위키링크',
  '지도',
  '템플릿',
  '공유',
  '금고',
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

  // F-2037.md 8.1 U6
  it('U6: ## 템플릿 절이 새 문서 템플릿·회의록·템플릿 폴더 문구를 담고, {{ 를 쓰지 않는다', () => {
    const idx = HELP_DOC_CONTENT.indexOf('## 템플릿')
    expect(idx).toBeGreaterThan(-1)
    const section = HELP_DOC_CONTENT.slice(idx, HELP_DOC_CONTENT.indexOf('## 공유'))
    expect(section).toContain('새 문서 템플릿')
    expect(section).toContain('회의록')
    expect(section).toContain('템플릿')
    expect(HELP_DOC_CONTENT).not.toMatch(/\{\{/)
  })

  // F-404.md 10.1 U17
  it('U17: ## 금고 절이 ## 공유 뒤·## 내보내기·가져오기 앞에 있고, 네 문단을 담는다', () => {
    const shareIdx = HELP_DOC_CONTENT.indexOf('## 공유')
    const vaultIdx = HELP_DOC_CONTENT.indexOf('## 금고')
    const exportIdx = HELP_DOC_CONTENT.indexOf('## 내보내기·가져오기')
    expect(vaultIdx).toBeGreaterThan(shareIdx)
    expect(vaultIdx).toBeLessThan(exportIdx)

    const section = HELP_DOC_CONTENT.slice(vaultIdx, exportIdx)
    expect(section).toContain('제목·본문·이미지는 서버와 운영자도 읽을 수 없습니다.')
    expect(section).toContain('복구 코드')
    expect(section).toContain('자동 잠금')
    expect(section).toContain('금고로 옮기기…')
  })
})

// F-2039.md 2장 R2·R3, 8.1 U1~U3·U8
const LINK_LINE_RE = /^사용법 글: \[[^\]\n]+\]\(\/guides\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\)$/

function appSections(): Array<{ name: string; body: string }> {
  const start = HELP_DOC_CONTENT.indexOf('## 이 앱은')
  const end = HELP_DOC_CONTENT.indexOf('## 마크다운 문법')
  const text = HELP_DOC_CONTENT.slice(start, end)
  return text
    .split(/\n(?=## )/)
    .filter((s) => s.trim() !== '')
    .map((section) => {
      const name = /^## (.+)$/m.exec(section)?.[1] ?? ''
      const body = section.replace(/^## .+\n\n?/, '').trimEnd()
      return { name, body }
    })
}

describe('F-2039 도움말 ↔ 사용법 글 분담 규칙', () => {
  it('U1: 앱 사용법 절마다 사용법 글 줄을 뺀 본문이 600자 이하·4문단 이하다 (R2)', () => {
    for (const { name, body } of appSections()) {
      const paragraphs = body.split(/\n\n+/).filter((p) => p.trim() !== '' && !p.startsWith('사용법 글:'))
      const text = paragraphs.join('\n\n')
      expect([...text].length, `## ${name} 본문 길이`).toBeLessThanOrEqual(600)
      expect(paragraphs.length, `## ${name} 문단 수`).toBeLessThanOrEqual(4)
    }
  })

  it('U2: 사용법 글 줄은 모양이 R3 정규식에 맞고, 절의 마지막 문단이며, 절마다 0~1개다 (R3)', () => {
    for (const { name, body } of appSections()) {
      const paragraphs = body.split(/\n\n+/).filter((p) => p.trim() !== '')
      const linkParagraphs = paragraphs.filter((p) => p.startsWith('사용법 글:'))
      expect(linkParagraphs.length, `## ${name} 사용법 글 줄 개수`).toBeLessThanOrEqual(1)
      for (const link of linkParagraphs) {
        expect(link, `## ${name} 사용법 글 줄 모양`).toMatch(LINK_LINE_RE)
        expect(paragraphs[paragraphs.length - 1], `## ${name} 사용법 글 줄이 마지막 문단이어야 한다`).toBe(link)
      }
    }
  })

  it('U3: ## 금고 절의 마지막 문단이 정확히 encryption 글 링크이고, 복구 문장이 들어 있다', () => {
    const section = appSections().find((s) => s.name === '금고')!
    const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(paragraphs[paragraphs.length - 1]).toBe('사용법 글: [금고로 문서 암호화하기](/guides/encryption)')
    expect(section.body).toContain('금고 암호를 잊으면 `암호를 잊었나요?`를 눌러 복구 코드로 새 암호를 정합니다.')
  })

  it('U8: ## 금고 절에 기본 자동 잠금 분·최대 크기 수치가 상수 그대로 들어 있다 (R5)', () => {
    const section = appSections().find((s) => s.name === '금고')!
    expect(section.body).toContain(`기본 ${E2EE_DEFAULT_LOCK_MINUTES}분`)
    expect(section.body).toContain(`약 ${Math.round(E2EE_MAX_PLAIN_CONTENT_BYTES / 1000)}KB`)
  })

  it('U7: ## 위키링크 절에 미리보기 문단이 있고 열기 지연 수치가 상수 그대로 들어 있다 (F-2044 R5)', () => {
    const section = appSections().find((s) => s.name === '위키링크')!
    expect(section.body).toContain(`${WIKI_PREVIEW_OPEN_DELAY_MS / 1000}초`)
    expect(section.body).toContain('문서 열기')
    expect(section.body).toContain('위키링크 미리보기')
  })
})
