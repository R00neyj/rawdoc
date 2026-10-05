// specs/features/F-2125.md 6.1 A1~A5 — 편집기 중첩 파싱(node, EditorState)
import { describe, expect, it, vi } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Extension, StateCommand } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, ensureSyntaxTree, indentUnit } from '@codemirror/language'
import { insertNewlineAndIndent, toggleComment } from '@codemirror/commands'
import { highlightTree } from '@lezer/highlight'
import type { Highlighter } from '@lezer/highlight'
import { frontmatterExtension } from '../../../src/editor/frontmatter'
import { insertNewlineContinueList } from '../../../src/editor/listEnter'
import { markdownHighlightStyle } from '../../../src/editor/highlight'
import { codeEditorExtension, codeHighlighter, codeLanguageFor } from '../../../src/editor/codeLanguages'
import { highlightCodeLines } from '../../../src/lib/codeHighlight'
import { loadCodeGrammar } from '../../../src/lib/codeParsers'
import type { CodeLangId } from '../../../src/lib/codeLang'

const BASE: Extension[] = [EditorState.tabSize.of(4), indentUnit.of('    ')]

// createEditor.ts 와 같은 markdown() + codeEditorExtension() (6.1 머리말)
function nestedState(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [
      ...BASE,
      markdown({ base: markdownLanguage, extensions: [frontmatterExtension()], addKeymap: false, codeLanguages: codeLanguageFor }),
      codeEditorExtension(),
    ],
  })
}

// 지금(중첩 없음) 상태
function plainState(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [...BASE, markdown({ base: markdownLanguage, extensions: [frontmatterExtension()], addKeymap: false })],
  })
}

// 문법을 실제로 불러오고 LanguageDescription.support 까지 채운다 (R7 — 불러오기 전 상태는 건너뛴 영역)
async function loadLangs(...infos: string[]) {
  for (const info of infos) await codeLanguageFor(info)!.load()
}

// | 자리에 커서
function withCursor(src: string): { doc: string; cursor: number } {
  const cursor = src.indexOf('|')
  return { doc: src.slice(0, cursor) + src.slice(cursor + 1), cursor }
}

function fullTree(state: EditorState) {
  return ensureSyntaxTree(state, state.doc.length, 5000)!
}

// 글자 위치 → 클래스
function classMap(state: EditorState, highlighter: Highlighter | readonly Highlighter[]): Map<number, string> {
  const map = new Map<number, string>()
  highlightTree(fullTree(state), highlighter, (from, to, cls) => {
    for (let p = from; p < to; p++) map.set(p, cls)
  })
  return map
}

// 블록 코드만 따로 칠한 결과를 문서 위치로 — lineStarts 는 각 코드 줄 첫 글자의 문서 위치
async function expectedCodeMap(code: string, id: CodeLangId, lineStarts: number[]): Promise<Map<number, string>> {
  const grammar = await loadCodeGrammar(id)
  const map = new Map<number, string>()
  highlightCodeLines(code, grammar!.parser).forEach((segs, i) => {
    let p = lineStarts[i]
    for (const seg of segs) {
      if (seg.kind) for (let k = 0; k < seg.text.length; k++) map.set(p + k, `code-${seg.kind}`)
      p += seg.text.length
    }
  })
  return map
}

// 코드 줄마다 앞에 prefix 를 붙인 펜스 블록과 각 코드 줄의 문서 위치
function fenced(info: string, code: string, prefix: string, before: string) {
  const lines = code.split('\n')
  let doc = before + prefix + '```' + info + '\n'
  const starts: number[] = []
  for (const line of lines) {
    starts.push(doc.length + prefix.length)
    doc += prefix + line + '\n'
  }
  doc += prefix + '```\n'
  return { doc, starts }
}

const TS_CODE = 'const a: number = f(1) // 주석\nfunction g(x: string) {\n  return `t${x}`\n}'
const HTML_CODE = '<p class="x">hi</p>\n<script>\nconst n = 1 // c\n</script>\n<style>\np { color: #fff; }\n</style>'

describe('A1 — 문서 트리 + codeHighlighter 와 highlightCodeLines 가 같은 (위치, 종류)', () => {
  const cases: { name: string; info: string; id: CodeLangId; code: string; prefix: string; before: string }[] = [
    { name: 'TS', info: 'ts', id: 'typescript', code: TS_CODE, prefix: '', before: '문단\n\n' },
    { name: 'HTML(<script>·<style> 중첩)', info: 'html', id: 'html', code: HTML_CODE, prefix: '', before: '' },
    { name: '인용 안', info: 'ts', id: 'typescript', code: TS_CODE, prefix: '> ', before: '' },
    { name: '목록 안', info: 'ts', id: 'typescript', code: TS_CODE, prefix: '  ', before: '- 항목\n\n' },
  ]
  for (const c of cases) {
    it(c.name, async () => {
      await loadLangs(c.info)
      const { doc, starts } = fenced(c.info, c.code, c.prefix, c.before)
      const state = nestedState(doc)
      const actual = classMap(state, codeHighlighter)
      const expected = await expectedCodeMap(c.code, c.id, starts)
      expect(expected.size).toBeGreaterThan(5)
      expect([...actual.entries()].sort((a, b) => a[0] - b[0])).toEqual([...expected.entries()].sort((a, b) => a[0] - b[0]))
    })
  }
})

describe('A2 — scope', () => {
  const BODY_HTML = [
    '<script>let a = 1 // x</script>',
    '',
    '<style>p { color: red }</style>',
    '',
    '<p style="color: red" onclick="go(1)">x</p>',
    '',
    '<?xml version="1.0"?>',
    '',
    '<!-- 주석 -->',
    '',
  ].join('\n')
  const TS_BLOCK = '```ts\nconst a = 1\n```\n'

  it('마크다운 본문의 <script>·<style>·style=·onclick=·<?xml ?>·HTML 주석에 code-* 0개 (블록에는 있다)', async () => {
    await loadLangs('ts')
    const doc = BODY_HTML + '\n' + TS_BLOCK
    const state = nestedState(doc)
    const map = classMap(state, codeHighlighter)
    const blockFrom = doc.indexOf('```ts')
    const outside = [...map.keys()].filter((p) => p < blockFrom)
    expect(outside).toEqual([])
    expect([...map.keys()].some((p) => p > blockFrom)).toBe(true)
  })

  it('markdownHighlightStyle — 중첩 없음·범위 없음과 중첩 + scope 에서 펜스 밖은 같다. 언어 없는 블록은 md-code 그대로', async () => {
    await loadLangs('ts', 'html', 'xml')
    const doc = [
      '---',
      'title: x',
      '---',
      '',
      '# 제목 **굵게** *기울임* `인라인` [링크](https://a.b) ~~취소~~',
      '',
      BODY_HTML,
      '> 인용 문장',
      '> ```ts',
      '> const q = 1',
      '> ```',
      '',
      '- 목록',
      '',
      '  ```html',
      '  <b>x</b>',
      '  ```',
      '',
      '```xml',
      '<?xml version="1.0"?>',
      '<a/>',
      '```',
      '',
      '```',
      'plain code',
      '```',
      '',
      '끝 ==강조==',
      '',
    ].join('\n')
    const unscoped = HighlightStyle.define(markdownHighlightStyle.specs)
    const before = classMap(plainState(doc), unscoped)
    const after = classMap(nestedState(doc), markdownHighlightStyle)

    // 언어 붙은 블록의 코드 범위(펜스 표시 줄 제외, 줄 사이 \n 포함)
    const codeLines = ['> const q = 1', '  <b>x</b>', '<?xml version="1.0"?>\n<a/>'].map((text) => {
      const from = doc.lastIndexOf('\n' + text + '\n') + 1
      return [from, from + text.length] as const
    })
    const inCode = (p: number) => codeLines.some(([f, t]) => p >= f && p < t)
    const drop = (m: Map<number, string>) => [...m.entries()].filter(([p]) => !inCode(p)).sort((a, b) => a[0] - b[0])
    expect(drop(after)).toEqual(drop(before))
    // 코드 트리에는 마크다운 클래스가 새지 않는다 — 범위가 없으면 <?xml ?> 이 md-mark 를 받는다 (M5)
    const [xmlFrom, xmlTo] = codeLines[2]
    for (let p = xmlFrom; p < xmlTo; p++) expect(after.get(p), String(p)).toBeUndefined()

    const plain = doc.indexOf('plain code')
    expect(after.get(plain)).toContain('md-code')
    // 인용 안 펜스 표시 줄의 md-quote-text 는 남는다 (R3)
    expect(after.get(doc.indexOf('> ```ts'))).toContain('md-quote-text')
  })
})

describe('A3 — Enter 결과가 codeLanguages 없는 상태와 같다', () => {
  const CASES: [string, string][] = [
    ['맨 위 8칸 줄', '```js\n        let a = 1|\n```\n'],
    ['여는 펜스 줄 끝', '```ts|\nconst a = 1\n```\n'],
    ['{ 줄 끝', '```ts\n  function f() {|\n  }\n```\n'],
    ['{|} 사이', '```ts\n  const o = {|}\n```\n'],
    ['f(|) 사이', '```ts\n    f(|)\n```\n'],
    ['목록 안', '- 항목\n\n  ```ts\n    if (a) {|\n  ```\n'],
    ['인용 안', '> ```ts\n>   const a = 1|\n> ```\n'],
    ['인용+목록 안', '> - 항목\n>   ```ts\n>     const a = 1|\n>   ```\n'],
    ['탭 들여쓰기', '```py\n\tif a:|\n```\n'],
    ['언어 없는 블록', '```\n      plain|\n```\n'],
    ['펜스 밖 제목 줄', '## 제목|\n\n```ts\nconst a = 1\n```\n'],
  ]

  function pressEnter(state: EditorState) {
    let out = state
    const target = { state, dispatch: (tr: { state: EditorState }) => (out = tr.state) }
    if (!insertNewlineContinueList(target as Parameters<StateCommand>[0])) {
      insertNewlineAndIndent(target as Parameters<StateCommand>[0])
    }
    return { doc: out.doc.toString(), head: out.selection.main.head }
  }

  for (const [name, src] of CASES) {
    it(name, async () => {
      await loadLangs('js', 'ts', 'py')
      const { doc, cursor } = withCursor(src)
      const nested = nestedState(doc, cursor)
      fullTree(nested)
      expect(pressEnter(nested)).toEqual(pressEnter(plainState(doc, cursor)))
    })
  }
})

describe('A4 — Ctrl+/ (toggleComment)', () => {
  function toggle(src: string) {
    const { doc, cursor } = withCursor(src)
    let out: EditorState | null = null
    const ran = toggleComment({ state: nestedState(doc, cursor), dispatch: (tr) => (out = tr.state) })
    return { ran, doc: out ? (out as EditorState).doc.toString() : doc }
  }

  it('언어마다 그 언어 주석', async () => {
    await loadLangs('ts', 'css', 'html', 'py', 'yaml', 'sh', 'sql', 'json')
    expect(toggle('```ts\nlet |a = 1\n```\n').doc).toBe('```ts\n// let a = 1\n```\n')
    expect(toggle('```css\np { |color: red }\n```\n').doc).toBe('```css\n/* p { color: red } */\n```\n')
    expect(toggle('```html\n<p>|x</p>\n```\n').doc).toBe('```html\n<!-- <p>x</p> -->\n```\n')
    expect(toggle('```py\nx = |1\n```\n').doc).toBe('```py\n# x = 1\n```\n')
    expect(toggle('```yaml\na: |1\n```\n').doc).toBe('```yaml\n# a: 1\n```\n')
    expect(toggle('```sh\necho |hi\n```\n').doc).toBe('```sh\n# echo hi\n```\n')
    expect(toggle('```sql\nselect |1\n```\n').doc).toBe('```sql\n-- select 1\n```\n')
  })

  it('json 은 false 이고 문서 그대로', async () => {
    await loadLangs('json')
    const src = '```json\n{"a": |1}\n```\n'
    expect(toggle(src)).toEqual({ ran: false, doc: withCursor(src).doc })
  })

  it('언어 없는 블록·본문은 지금처럼 <!-- -->', () => {
    expect(toggle('```\nplain |x\n```\n').doc).toBe('```\n<!-- plain x -->\n```\n')
    expect(toggle('본문 |글\n').doc).toBe('<!-- 본문 글 -->\n')
  })
})

describe('A5 — codeLanguageFor', () => {
  it('같은 id 는 같은 객체, md·mermaid·kotlin·빈 문자열은 null', () => {
    expect(codeLanguageFor('ts')).not.toBeNull()
    expect(codeLanguageFor('ts')).toBe(codeLanguageFor('typescript'))
    expect(codeLanguageFor('TS')).toBe(codeLanguageFor('mts'))
    expect(codeLanguageFor('js')).not.toBe(codeLanguageFor('ts'))
    for (const info of ['md', 'mermaid', 'kotlin', '']) expect(codeLanguageFor(info), info).toBeNull()
  })

  it('loadCodeGrammar 가 null 이면 한 번 거부된 뒤 그 id 는 null, 다시 부르지 않는다', async () => {
    vi.resetModules()
    const load = vi.fn(async () => null)
    vi.doMock('../../../src/lib/codeParsers', () => ({ loadCodeGrammar: load, loadedCodeGrammar: () => null }))
    const mod = await import('../../../src/editor/codeLanguages')
    const desc = mod.codeLanguageFor('py')!
    expect(desc).not.toBeNull()
    await expect(desc.load()).rejects.toThrow()
    expect(mod.codeLanguageFor('py')).toBeNull()
    expect(mod.codeLanguageFor('python')).toBeNull()

    // 다시 파싱해도 loadCodeGrammar 를 다시 부르지 않는다
    const state = EditorState.create({
      doc: '```py\nx = 1\n```\n',
      extensions: [markdown({ base: markdownLanguage, addKeymap: false, codeLanguages: mod.codeLanguageFor })],
    })
    ensureSyntaxTree(state, state.doc.length, 5000)
    const edited = state.update({ changes: { from: 0, insert: 'a\n' } }).state
    ensureSyntaxTree(edited, edited.doc.length, 5000)
    await Promise.resolve()
    expect(load).toHaveBeenCalledTimes(1)
    vi.doUnmock('../../../src/lib/codeParsers')
  })
})
