// specs/features/F-144.md 4장 A1
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { codeLanguageFor } from '../../../src/editor/codeLanguages'
import { frontmatterExtension } from '../../../src/editor/frontmatter'
import { extractHeadings } from '../../../src/editor/outline'

function makeState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

describe('extractHeadings — ATX·Setext (A1)', () => {
  it('#·##·### 를 순서대로 추출한다', () => {
    const state = makeState('# 하나\n\n## 둘\n\n### 셋\n')
    const headings = extractHeadings(state)
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, '하나'],
      [2, '둘'],
      [3, '셋'],
    ])
  })

  it('#### 이하는 넣지 않는다', () => {
    const state = makeState('# 하나\n\n#### 넷\n\n###### 여섯\n')
    const headings = extractHeadings(state)
    expect(headings).toHaveLength(1)
  })

  it('Setext 제목 === → 1, --- → 2', () => {
    const state = makeState('제목1\n===\n\n제목2\n---\n')
    const headings = extractHeadings(state)
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [1, '제목1'],
      [2, '제목2'],
    ])
  })

  it('닫는 # 을 뗀다', () => {
    const state = makeState('# 제목 #\n')
    expect(extractHeadings(state)[0].text).toBe('제목')
  })

  it('from 은 제목 줄 시작 위치다', () => {
    const state = makeState('본문\n\n## 제목\n')
    const from = extractHeadings(state)[0].from
    expect(state.doc.lineAt(from).text).toBe('## 제목')
  })
})

describe('extractHeadings — 코드블록·프론트매터 제외 (A1)', () => {
  it('펜스 코드블록 안의 # 줄은 제목이 아니다', () => {
    const state = makeState('```\n# 코드 안\n```\n\n# 진짜 제목\n')
    const headings = extractHeadings(state)
    expect(headings).toHaveLength(1)
    expect(headings[0].text).toBe('진짜 제목')
  })

  it('프론트매터 안의 --- 로 만들어지는 Setext 는 제목이 아니다', () => {
    const state = makeState('---\ntitle: 글\n---\n\n# 진짜 제목\n')
    const headings = extractHeadings(state)
    expect(headings).toHaveLength(1)
    expect(headings[0].text).toBe('진짜 제목')
  })
})

describe('extractHeadings — 인라인 기호 제거 (A1)', () => {
  it('굵게·코드·링크·위키링크·이스케이프를 뗀다', () => {
    const state = makeState('# **굵게** 와 `코드` 와 [글자](https://a) 와 [[대상|별칭]] 와 \\*별\\*\n')
    expect(extractHeadings(state)[0].text).toBe('굵게 와 코드 와 글자 와 별칭 와 *별*')
  })

  it('뗀 결과가 비면 (제목 없음)', () => {
    const state = makeState('# **  **\n')
    expect(extractHeadings(state)[0].text).toBe('(제목 없음)')
  })

  it('제목이 하나도 없으면 빈 배열', () => {
    const state = makeState('본문만 있는 문서\n')
    expect(extractHeadings(state)).toEqual([])
  })
})

describe('extractHeadings — 성능 기록 (A9, 통과 기준 없음)', () => {
  it('제목 500개·10,000줄 문서에서 1회 추출 시간을 기록한다', () => {
    const lines = []
    for (let i = 0; i < 500; i++) {
      lines.push(`## 섹션 ${i}`, '본문 문단입니다. '.repeat(5), '')
    }
    while (lines.length < 10000) {
      lines.push(`일반 문단 줄 ${lines.length}`)
    }
    const state = makeState(lines.join('\n'))

    const start = performance.now()
    const headings = extractHeadings(state)
    const elapsed = performance.now() - start

    console.log(`[F-144 A9] extractHeadings ${lines.length}줄·제목 ${headings.length}개: ${elapsed.toFixed(2)}ms`)

    expect(headings.length).toBe(500)
  })
})

describe('extractHeadings — 중첩 파싱이 덜 된 트리 (F-2125 A8)', () => {
  const tsBlock = (n: number) =>
    ['```ts', ...Array.from({ length: n }, (_, i) => `const v${i}: number = f(${i}) // 줄 ${i}`), '```'].join('\n')

  function nestedState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage, extensions: [frontmatterExtension()], addKeymap: false, codeLanguages: codeLanguageFor }),
      ],
    })
  }

  const cases: [string, () => string, number][] = [
    ['## + TS 20줄 블록 × 300', () => Array.from({ length: 300 }, (_, i) => `## 절 ${i}\n\n${tsBlock(20)}\n`).join('\n'), 300],
    ['# + TS 5,000줄 한 블록 + #', () => `# 처음\n\n${tsBlock(5000)}\n\n# 끝\n`, 2],
  ]

  for (const [name, make, count] of cases) {
    it(name, async () => {
      await codeLanguageFor('ts')!.load()
      const doc = make()
      const state = nestedState(doc)
      expect(syntaxTree(state).length).toBeLessThan(doc.length)

      const start = performance.now()
      const headings = extractHeadings(state)
      const elapsed = performance.now() - start
      console.info(`[F-2125 A8] ${name} ${doc.length}자: 제목 ${headings.length}개 ${elapsed.toFixed(1)}ms`)

      expect(headings).toHaveLength(count)
      expect(headings).toEqual(extractHeadings(makeState(doc)))
    })
  }
})
