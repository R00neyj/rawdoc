// F-257 도움말 문서 — 앱 사용법 + 마크다운 문법 두 축 (specs/features/F-257.md 5장 G1~G4)
import { describe, it, expect } from 'vitest'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from '../../../src/app/helpDoc'
import brand from '../../../brand.config'
import { E2EE_DEFAULT_LOCK_MINUTES } from '../../../src/e2ee/keyring'
import { E2EE_MAX_PLAIN_CONTENT_BYTES } from '../../../src/lib/e2eeLimits'
import { WIKI_PREVIEW_OPEN_DELAY_MS } from '../../../src/app/wikiPreview'
import { COMMENT_BODY_MAX, COMMENTS_PER_DOC_MAX } from '../../../src/lib/docComments'
import { RETAIN_MS } from '../../../src/storage/yjsStore'
import { MAX_INPUT_BYTES, MAX_RESULT_BYTES } from '../../../src/app/attachImages'
import { SHORTCUT_CATALOG, formatChord } from '../../../src/app/shortcutCatalog'

// F-257.md 2장 표의 절 순서 그대로
const SECTION_ORDER = [
  '이 앱은',
  '화면',
  '글쓰기',
  '문서 관리',
  '검색',
  '저장',
  '이미지',
  '위키링크',
  '지도',
  '템플릿',
  '공유',
  '댓글',
  '알림',
  '금고',
  '내보내기·가져오기',
  '옵시디언 볼트',
  '설치와 오프라인',
  '계정',
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

  it('U22: 저장 절 본문에 로그인한 계정은 으로 시작하는 한도 문단이 정확히 하나 있고, ## 이미지 앞이며, ## 한도 절은 없다 (수치는 worker/guideLimits.test.ts F-2047 U5)', () => {
    const saveIdx = HELP_DOC_CONTENT.indexOf('## 저장')
    const imageIdx = HELP_DOC_CONTENT.indexOf('## 이미지')
    const section = HELP_DOC_CONTENT.slice(saveIdx, imageIdx)
    const limitParagraphs = section.split(/\n\n+/).filter((p) => p.startsWith('로그인한 계정은 '))
    expect(limitParagraphs.length).toBe(1)
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

  // F-505.md 10장 U23
  it('U23: ## 댓글 절이 ## 공유 뒤·## 금고 앞에 있고, 수치가 상수와 맞는다', () => {
    const shareIdx = HELP_DOC_CONTENT.indexOf('## 공유')
    const commentIdx = HELP_DOC_CONTENT.indexOf('## 댓글')
    const vaultIdx = HELP_DOC_CONTENT.indexOf('## 금고')
    expect(commentIdx).toBeGreaterThan(shareIdx)
    expect(commentIdx).toBeLessThan(vaultIdx)

    const section = HELP_DOC_CONTENT.slice(commentIdx, vaultIdx)
    expect(section).toContain('Ctrl+Alt+M')
    expect(section).toContain('본문이 지워진 댓글')
    expect(section).toContain('해결된 댓글 보기')
    expect(section).toContain(`${COMMENT_BODY_MAX.toLocaleString('en-US')}자까지`)
    expect(section).toContain(`${COMMENTS_PER_DOC_MAX}개까지`)
    expect(section).not.toContain('코멘트')
    expect(section).not.toContain('대댓글')
    expect(section).not.toContain('고아')
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

// F-2048.md 6.1 U1
describe('F-2048 도움말 ## 이미지 절', () => {
  it('U1: 마지막 문단이 사용법 글 줄이고, 수치·화면 글자가 상수와 맞으며, 옛 문장이 없다', () => {
    const section = appSections().find((s) => s.name === '이미지')!
    const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(paragraphs[paragraphs.length - 1]).toBe('사용법 글: [문서에 이미지 넣기](/guides/images)')
    expect(section.body).toContain(`한 장에 ${MAX_INPUT_BYTES / 1024 / 1024}MB까지`)
    expect(section.body).toContain(`${MAX_RESULT_BYTES / 1024 / 1024}MB가 넘으면`)
    expect(section.body).toContain('`이미지 삭제`')
    expect(section.body).not.toContain('한 장에 20MB까지 넣을 수 있고')
  })
})

// 사용법 글 search (write-guide, 2026-09-27)
describe('도움말 ## 검색 절', () => {
  it('## 문서 관리 바로 뒤에 있고, 사용법 글 줄로 끝나며, 단축키·화면 글자가 들어 있다', () => {
    const names = appSections().map((s) => s.name)
    expect(names[names.indexOf('문서 관리') + 1]).toBe('검색')
    const section = appSections().find((s) => s.name === '검색')!
    const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(paragraphs[paragraphs.length - 1]).toBe('사용법 글: [검색과 찾기·바꾸기](/guides/search)')
    expect(section.body).toContain('`Ctrl+Shift+F`')
    expect(section.body).toContain('`Ctrl+F`')
    expect(section.body).toContain('`Ctrl+H`')
    expect(section.body).toContain('`검색`')
    expect(section.body).toContain('`tag:일기`')
  })
})

// 사용법 글 account (write-guide, 2026-09-27)
describe('도움말 ## 계정 절', () => {
  it('## 설치와 오프라인 바로 뒤에 있고, 사용법 글 줄로 끝나며, 화면 글자가 들어 있다', () => {
    const names = appSections().map((s) => s.name)
    expect(names[names.indexOf('설치와 오프라인') + 1]).toBe('계정')
    expect(names[names.indexOf('계정') + 1]).toBe('단축키')
    const section = appSections().find((s) => s.name === '계정')!
    const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(paragraphs[paragraphs.length - 1]).toBe('사용법 글: [계정과 로그인](/guides/account)')
    expect(section.body).toContain('`로그인`')
    expect(section.body).toContain('`API 토큰`')
    expect(section.body).toContain('`로그아웃`')
    expect(section.body).toContain('`계정 삭제…`')
  })
})

// 사용법 글 tables (write-guide, 2026-09-27)
describe('도움말 ## 글쓰기 절', () => {
  it('사용법 글 줄로 끝나고, 표 문단의 화면 글자·키가 들어 있다', () => {
    const section = appSections().find((s) => s.name === '글쓰기')!
    const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(paragraphs[paragraphs.length - 1]).toBe('사용법 글: [표 넣고 고치기](/guides/tables)')
    expect(section.body).toContain('`삽입` ▸ `표`')
    expect(section.body).toContain('`Alt+Enter`')
    expect(section.body).toContain('`Delete`')
  })
})

// 사용법 글 comments (write-guide, 2026-09-27)
describe('도움말 ## 댓글·## 알림 절', () => {
  it('두 절 모두 comments 글 사용법 글 줄로 끝나고, 알림 절이 스레드 참여자 답글 알림을 적는다', () => {
    for (const name of ['댓글', '알림']) {
      const section = appSections().find((s) => s.name === name)!
      const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
      expect(paragraphs[paragraphs.length - 1], name).toBe('사용법 글: [댓글과 알림](/guides/comments)')
    }
    const notices = appSections().find((s) => s.name === '알림')!
    expect(notices.body).toContain('내가 댓글·답글을 쓴 스레드에 답글을 달면')
    expect(notices.body).toContain('`알림 열기`')
  })
})

// 사용법 글 callouts-math-diagrams (write-guide, 2026-09-27) — 문법 절(GROUPS)은 appSections() 밖이라 U2 가 훑지 않는다. 같은 R3 규칙을 여기서 본다
function syntaxSections(): Array<{ name: string; body: string }> {
  const start = HELP_DOC_CONTENT.indexOf('## 마크다운 문법')
  return HELP_DOC_CONTENT.slice(start)
    .split(/\n(?=## )/)
    .filter((s) => s.trim() !== '')
    .map((section) => {
      const name = /^## (.+)$/m.exec(section)?.[1] ?? ''
      const body = section.replace(/^## .+\n\n?/, '').trimEnd()
      return { name, body }
    })
}

describe('도움말 문법 절의 사용법 글 줄 (R3)', () => {
  it('문법 절마다 사용법 글 줄이 0~1개이고, 있으면 모양이 R3 정규식에 맞으며 절의 마지막 문단이다', () => {
    const sections = syntaxSections()
    expect(sections.length).toBeGreaterThan(1)
    for (const { name, body } of sections) {
      // 코드펜스 안의 빈 줄로 잘린 조각도 문단으로 세지만, 사용법 글 줄 판정에는 영향이 없다
      const paragraphs = body.split(/\n\n+/).filter((p) => p.trim() !== '')
      const linkParagraphs = paragraphs.filter((p) => p.startsWith('사용법 글:'))
      expect(linkParagraphs.length, `## ${name} 사용법 글 줄 개수`).toBeLessThanOrEqual(1)
      for (const link of linkParagraphs) {
        expect(link, `## ${name} 사용법 글 줄 모양`).toMatch(LINK_LINE_RE)
        expect(paragraphs[paragraphs.length - 1], `## ${name} 사용법 글 줄이 마지막 문단이어야 한다`).toBe(link)
      }
    }
  })

  it('## 콜아웃·## 수식 절이 callouts-math-diagrams 글 줄로 끝나고, ## 수식 절은 원문 코드블록만 두고 결과를 그리지 않는다', () => {
    const line = '사용법 글: [콜아웃·수식·다이어그램 쓰기](/guides/callouts-math-diagrams)'
    for (const name of ['콜아웃', '수식']) {
      const section = syntaxSections().find((s) => s.name === name)!
      expect(section, name).toBeTruthy()
      const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
      expect(paragraphs[paragraphs.length - 1], name).toBe(line)
    }
    const names = syntaxSections().map((s) => s.name)
    expect(names[names.indexOf('콜아웃') + 1]).toBe('수식')

    const math = syntaxSections().find((s) => s.name === '수식')!
    expect(math.body).toContain(fence('넓이는 $\\pi r^2$ 입니다.\n\n$$\n\\frac{a+b}{2}\n$$'))
    // 사이트 /help 는 KaTeX 스타일시트를 싣지 않는다 — 코드펜스 밖에 $ 가 있으면 사이트에서 수식이 스타일 없이 그려진다
    const outsideFence = math.body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
    expect(outsideFence).not.toContain('$')
  })
})

// F-510.md 6장 U6
describe('F-510 도움말 ## 알림 절', () => {
  it('U6: 사이드바 점·열면 읽음 문장을 글자 그대로 담는다', () => {
    const section = appSections().find((s) => s.name === '알림')!
    expect(section.body).toContain(
      '안 읽은 알림이 있는 문서는 사이드바 목록에 점이 붙고, 그 문서를 열면 그 문서의 알림이 읽음으로 바뀝니다.',
    )
  })
})

// F-2110 U12
describe('F-2110 도움말 ## 알림 절', () => {
  it('U12: 푸시 문단을 글자 그대로 담는다', () => {
    const section = appSections().find((s) => s.name === '알림')!
    expect(section.body).toContain(
      '설정의 계정 탭에서 이 기기에서 푸시 받기를 켜면 앱을 닫아 둬도 알림이 옵니다. 같은 문서의 알림은 3분씩 모아 보내고, 그 문서를 열어 두고 있거나 이미 읽었으면 보내지 않습니다. 알림이 오지 않으면 기기 설정에서 브라우저(또는 설치한 앱)의 알림이 켜져 있는지 확인하세요. iPhone·iPad에서는 홈 화면에 추가한 앱에서만 받을 수 있습니다.',
    )
  })
})

// F-2045.md 6.1 U1
describe('F-2045 도움말 ## 공유 절', () => {
  it('U1: 마지막 문단이 사용법 글 줄이고, 화면 글자가 들어 있고, 옛 문구가 없다', () => {
    const section = appSections().find((s) => s.name === '공유')!
    const paragraphs = section.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(paragraphs[paragraphs.length - 1]).toBe(
      '사용법 글: [문서를 공유하고 함께 편집하기](/guides/sharing)',
    )
    expect(section.body).toContain('`사람 초대…`')
    expect(section.body).toContain('`공유받음`')
    expect(section.body).toContain('`실시간 연결 실패 · 한 명씩 편집`')
    expect(section.body).toContain('`공유 관리`')
    expect(section.body).toContain('`보기`')
    expect(section.body).toContain('`편집`')
    expect(section.body).not.toContain('읽기·편집 권한')
  })
})

// F-2046.md 6.1 U1
describe('F-2046 도움말 두 절 (## 내보내기·가져오기 / ## 옵시디언 볼트)', () => {
  it('U1: 옵시디언 볼트 절이 화면 글자를 담고 사용법 글 줄로 끝나며, 내보내기·가져오기 절이 고쳐졌다', () => {
    const vaultSection = appSections().find((s) => s.name === '옵시디언 볼트')!
    const vaultParagraphs = vaultSection.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(vaultParagraphs[vaultParagraphs.length - 1]).toBe(
      '사용법 글: [옵시디언 볼트와 오가기](/guides/obsidian-vault)',
    )
    expect(vaultSection.body).toContain('`옵시디언 볼트로 내보내기`')
    expect(vaultSection.body).toContain('`폴더 가져오기…`')
    expect(vaultSection.body).toContain('`넣을 폴더`')
    expect(vaultSection.body).toContain('`(가져오기 전)`')

    const exportSection = appSections().find((s) => s.name === '내보내기·가져오기')!
    const exportParagraphs = exportSection.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(exportParagraphs[exportParagraphs.length - 1]).toBe(
      '사용법 글: [한 번 쓴 글을 다른 도구로 옮기기](/guides/markdown-portability)',
    )
    expect(exportSection.body).not.toContain('옵시디언')
    expect(exportSection.body).not.toContain('불러오')
    expect(exportSection.body).toContain('`전체 내보내기`')
  })
})

// F-2047.md 6.1 U1
describe('F-2047 도움말 두 절 (## 저장 / ## 설치와 오프라인)', () => {
  it('U1: 두 절 모두 사용법 글 줄로 끝나고, 수치·화면 글자가 상수와 맞으며, 어긋난 문구가 없다', () => {
    const save = appSections().find((s) => s.name === '저장')!
    const install = appSections().find((s) => s.name === '설치와 오프라인')!

    const saveParagraphs = save.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    const installParagraphs = install.body.split(/\n\n+/).filter((p) => p.trim() !== '')
    expect(saveParagraphs[saveParagraphs.length - 1]).toBe('사용법 글: [오프라인과 동기화](/guides/offline-sync)')
    expect(installParagraphs[installParagraphs.length - 1]).toBe('사용법 글: [오프라인과 동기화](/guides/offline-sync)')

    expect(install.body).toContain('`앱 설치`')
    expect(install.body).toContain('`새로고침`')
    expect(install.body).toContain(`최근 ${RETAIN_MS / 86_400_000}일`)
    expect(install.body).not.toContain('설치해 두면')

    expect(save.body).toContain('상태바')
    expect(save.body).not.toContain('오프라인이어도 편집을 계속할 수 있습니다')
  })
})

// F-2052.md 7장 U11
describe('F-2052 단축키 판 도움말 한 줄', () => {
  it('U11: ## 단축키 절 목록 첫 줄이 nav.shortcuts 표시 문자열로 시작하고 `?` 를 담는다', () => {
    const section = appSections().find((s) => s.name === '단축키')!
    const firstLine = section.body.split('\n')[0]
    const entry = SHORTCUT_CATALOG.find((e) => e.id === 'nav.shortcuts')!
    expect(firstLine.startsWith(`- \`${formatChord(entry.keys[0], false)}\``)).toBe(true)
    expect(section.body).toContain('`?`')
  })
})
