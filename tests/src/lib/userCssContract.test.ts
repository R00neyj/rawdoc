// 사용자 CSS 계약 검증 U1~U6 (specs/features/F-2093.md 6장)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import brand from '../../../brand.config'
import {
  buildTemplateCss,
  CHROME_HOOKS,
  CONTENT_HOOKS,
  PUBLIC_VARS,
  STATE_ATTRS,
} from '../../../src/lib/userCssContract'

// ── 6.1 고정 사본 — 계약을 바꾸는 명세만 고친다 ──
const PUBLIC_VAR_NAMES = [
  '--paper', '--panel', '--ink', '--ink-2', '--muted', '--rule', '--rule-2', '--link', '--danger', '--accent',
  '--accent-soft', '--accent-ring', '--selection-bg',
  '--md-font-size', '--md-line-height', '--md-fg-muted', '--md-border', '--md-border-muted', '--md-bg-muted',
  '--md-code-bg', '--md-link', '--highlight-base', '--md-highlight-bg',
  '--code-keyword', '--code-string', '--code-comment', '--code-number', '--code-function', '--code-type',
  '--code-property', '--code-tag',
  '--callout-note', '--callout-tip', '--callout-success', '--callout-question', '--callout-warning',
  '--callout-danger', '--callout-example', '--callout-quote',
  '--map-group-1', '--map-group-2', '--map-group-3', '--map-group-4', '--map-group-5', '--map-group-6',
  '--map-group-7', '--map-group-8',
  '--comment-anchor', '--comment-anchor-active', '--comment-anchor-line',
  '--font-sans', '--font-serif', '--font-mono', '--font-display', '--font-body', '--tracking',
  '--radius-control', '--radius-dialog', '--radius-image',
]

const CHROME_HOOK_VALUES = [
  'app', 'sidebar', 'sidebar-list', 'topbar', 'statusbar', 'content', 'doc-title', 'editor', 'viewer', 'print',
  'outline', 'comments', 'dialog', 'menu', 'notice', 'home', 'map',
]

const R = ':root:root'
const CONTENT_HOOK_COPY: Record<string, { edit: string[]; view: string[] }> = {
  heading: {
    edit: [1, 2, 3, 4, 5, 6].map((n) => `${R} .cm-editor .cm-line.md-h${n}`),
    view: [1, 2, 3, 4, 5, 6].map((n) => `${R} .markdown-body h${n}`),
  },
  quote: { edit: [`${R} .cm-editor .cm-line.md-quote`], view: [`${R} .markdown-body blockquote`] },
  callout: { edit: [`${R} .cm-editor .cm-line.md-callout`], view: [`${R} .markdown-body .markdown-callout`] },
  codeblock: {
    edit: [`${R} .cm-editor .cm-line.md-fence-line`, `${R} .md-block.md-codeblock`],
    view: [`${R} .markdown-body pre`],
  },
  'inline-code': {
    edit: [`${R} .cm-editor .cm-line:not(.md-fence-line) .md-code`],
    view: [`${R} .markdown-body :not(pre) > code`],
  },
  table: { edit: [`${R} .md-block.md-table table`], view: [`${R} .markdown-body table`] },
  link: { edit: [`${R} .cm-editor .cm-line .md-link`], view: [`${R} .markdown-body a`] },
  highlight: { edit: [`${R} .cm-editor .md-highlight`], view: [`${R} .markdown-body mark`] },
  list: { edit: [`${R} .cm-editor .cm-line.md-list-line`], view: [`${R} .markdown-body li`] },
  hr: { edit: [`${R} .cm-editor .cm-line.md-hr`], view: [`${R} .markdown-body hr`] },
  body: { edit: [`${R} .cm-editor .cm-content`], view: [`${R} .markdown-body`] },
}
const CONTENT_HOOK_IDS = [
  'heading', 'quote', 'callout', 'codeblock', 'inline-code', 'table', 'link', 'highlight', 'list', 'hr', 'body',
]

// ── 파일 읽기 ──
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, 'utf-8')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const stripJsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(`${ROOT}${dir}`)) {
    const rel = `${dir}/${name}`
    if (statSync(`${ROOT}${rel}`).isDirectory()) out.push(...listFiles(rel, exts))
    else if (exts.some((e) => name.endsWith(e))) out.push(rel)
  }
  return out
}

const SRC_TS = listFiles('src', ['.ts', '.tsx']).filter((f) => f !== 'src/lib/userCssContract.ts')
const SRC_CSS = listFiles('src', ['.css'])
const TOKENS = read('src/styles/tokens.css')

// ── 특정도·블록 걷기 도우미 ──
type Spec = [number, number, number]

function matchParen(s: string, open: number): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' || ch === "'") i = s.indexOf(ch, i + 1)
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i
  }
  return s.length - 1
}

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '"' || ch === "'") i = s.indexOf(ch, i + 1)
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (ch === sep && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

const IDENT = /^[\w-]+/
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter'])

function specificity(selector: string): Spec {
  const s = selector.trim()
  let a = 0
  let b = 0
  let c = 0
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '#' || ch === '.') {
      if (ch === '#') a++
      else b++
      i += 1 + (IDENT.exec(s.slice(i + 1))?.[0].length ?? 0)
    } else if (ch === '[') {
      b++
      let j = i + 1
      while (j < s.length && s[j] !== ']') j += s[j] === '"' || s[j] === "'" ? s.indexOf(s[j], j + 1) - j + 1 : 1
      i = j + 1
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        c++
        i += 2 + (IDENT.exec(s.slice(i + 2))?.[0].length ?? 0)
        if (s[i] === '(') i = matchParen(s, i) + 1
        continue
      }
      const name = IDENT.exec(s.slice(i + 1))?.[0] ?? ''
      i += 1 + name.length
      if (s[i] === '(') {
        const close = matchParen(s, i)
        const inner = s.slice(i + 1, close)
        i = close + 1
        if (name === 'where') continue
        if (name === 'is' || name === 'not' || name === 'has' || name === 'matches') {
          const best = splitTop(inner, ',').map(specificity).sort(cmp).pop() ?? [0, 0, 0]
          a += best[0]
          b += best[1]
          c += best[2]
          continue
        }
        b++
      } else if (LEGACY_PSEUDO_ELEMENTS.has(name)) c++
      else b++
    } else if (/[a-zA-Z]/.test(ch)) {
      c++
      i += IDENT.exec(s.slice(i))?.[0].length ?? 1
    } else i++
  }
  return [a, b, c]
}

function cmp(x: Spec, y: Spec): number {
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
}

const SKIP_AT = /^@(-webkit-)?(keyframes|font-face|page|property|counter-style|font-feature-values|font-palette-values)\b/

function skipString(src: string, i: number): number {
  return src.indexOf(src[i], i + 1)
}

function matchBrace(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'") i = skipString(src, i)
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i
  }
  return src.length - 1
}

// 규칙 머리를 쉼표로 나눈 선택자 목록 — 조건부 @-블록은 안으로 들어가고 나머지 @-블록·문장은 건너뛴다
function collectSelectors(css: string): string[] {
  const src = stripComments(css)
  const out: string[] = []
  let start = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '"' || ch === "'") i = skipString(src, i)
    else if (ch === ';') start = i + 1
    else if (ch === '}') start = i + 1
    else if (ch === '{') {
      const head = src.slice(start, i).trim()
      if (head.startsWith('@') && !SKIP_AT.test(head)) start = i + 1
      else {
        if (!head.startsWith('@')) out.push(...splitTop(head, ','))
        i = matchBrace(src, i)
        start = i + 1
      }
    }
  }
  return out
}

const APP_CSS_FILES = [...SRC_CSS, 'node_modules/github-markdown-css/github-markdown-light.css']
const APP_RULES = APP_CSS_FILES.flatMap((file) => collectSelectors(read(file)).map((selector) => ({ selector, file })))

// 마지막 복합 선택자 (결합자·공백을 괄호 밖에서 자른 끝)
function lastCompound(selector: string): { compound: string; before: string } {
  let depth = 0
  let cut = -1
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i]
    if (ch === '"' || ch === "'") i = selector.indexOf(ch, i + 1)
    else if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    else if (depth === 0 && /[\s>+~]/.test(ch)) cut = i
  }
  return { compound: selector.slice(cut + 1), before: selector.slice(0, cut + 1) }
}

// 복합 선택자에서 기능 가상 클래스 밖의 클래스·아이디·속성·타입 조각
function pieces(compound: string): { set: Set<string>; pseudoElement: boolean; isArgs: string[] } {
  const set = new Set<string>()
  const isArgs: string[] = []
  let pseudoElement = false
  let i = 0
  while (i < compound.length) {
    const ch = compound[i]
    if (ch === '.' || ch === '#') {
      const id = IDENT.exec(compound.slice(i + 1))?.[0] ?? ''
      set.add(ch + id)
      i += 1 + id.length
    } else if (ch === '[') {
      const end = compound.indexOf(']', i)
      set.add(compound.slice(i, end + 1))
      i = end + 1
    } else if (ch === ':') {
      const dbl = compound[i + 1] === ':'
      const name = IDENT.exec(compound.slice(i + (dbl ? 2 : 1)))?.[0] ?? ''
      i += (dbl ? 2 : 1) + name.length
      if (dbl || LEGACY_PSEUDO_ELEMENTS.has(name)) pseudoElement = true
      if (compound[i] === '(') {
        const close = matchParen(compound, i)
        if (name === 'is' || name === 'matches' || name === 'where') isArgs.push(...splitTop(compound.slice(i + 1, close), ','))
        i = close + 1
      }
    } else if (/[a-zA-Z]/.test(ch)) {
      const id = IDENT.exec(compound.slice(i))?.[0] ?? ''
      set.add(id)
      i += id.length
    } else i++
  }
  return { set, pseudoElement, isArgs }
}

// :is() 인자를 펼친 마지막 복합 선택자 각각의 조각 집합
function variants(compound: string): { set: Set<string>; pseudoElement: boolean }[] {
  const base = pieces(compound)
  if (base.isArgs.length === 0) return [base]
  return base.isArgs.flatMap((arg) =>
    variants(lastCompound(arg).compound).map((v) => ({
      set: new Set([...base.set, ...v.set]),
      pseudoElement: base.pseudoElement || v.pseudoElement,
    })),
  )
}

function sameSet(x: Set<string>, y: Set<string>): boolean {
  return x.size === y.size && [...x].every((p) => y.has(p))
}

function contenders(recommended: string): { selector: string; file: string }[] {
  const { compound, before } = lastCompound(recommended)
  const key = pieces(compound).set
  const needsAncestor = ![...key].some((p) => /^\.(md-|markdown-)/.test(p))
  const ancestors = (before.match(/\.[\w-]+/g) ?? []).filter((c) => c !== '.cm-line')
  return APP_RULES.filter(({ selector }) => {
    if (/:focus/.test(selector)) return false
    if (needsAncestor && !ancestors.some((c) => selector.includes(c))) return false
    return variants(lastCompound(selector).compound).some((v) => !v.pseudoElement && sameSet(v.set, key))
  })
}

// ── U1 ──
describe('F-2093 U1 공개 변수', () => {
  const names = PUBLIC_VARS.map((p) => p.name)
  const lightBlock = /:root\s*\{([^}]*)\}/.exec(stripComments(TOKENS))?.[1] ?? ''

  test('이름이 고정 사본과 순서까지 같고 중복이 없다', () => {
    expect(names).toEqual(PUBLIC_VAR_NAMES)
    expect(new Set(names).size).toBe(names.length)
  })

  test('모두 tokens.css 첫 :root 블록에 선언돼 있다', () => {
    for (const name of names) expect(lightBlock, name).toMatch(new RegExp(`${name}\\s*:`))
  })

  test('묶음은 아홉 값 중 하나이고 라벨은 비어 있지 않으며 주석 표시가 없다', () => {
    const groups = new Set(['기본 색', '파생 색', '본문', '코드', '콜아웃', '지도 그룹', '댓글 앵커', '서체', '모양'])
    for (const p of PUBLIC_VARS) {
      expect(groups.has(p.group), p.name).toBe(true)
      expect(p.label.trim(), p.name).not.toBe('')
      expect(p.label).not.toMatch(/\/\*|\*\//)
    }
  })
})

// ── U2 ──
function hookPatterns(value: string): RegExp[] {
  return [
    new RegExp(`data-ui=["']${value}["']`),
    new RegExp(`setAttribute\\(\\s*["']data-ui["']\\s*,\\s*["']${value}["']\\s*\\)`),
    new RegExp(`dataset\\.ui\\s*=\\s*["']${value}["']`),
  ]
}

const CLASS_SOURCES: Record<string, string[]> = {
  'md-h1': ['src/editor/preview/lines.ts'],
  'md-h2': ['src/editor/preview/lines.ts'],
  'md-h3': ['src/editor/preview/lines.ts'],
  'md-h4': ['src/editor/preview/lines.ts'],
  'md-h5': ['src/editor/preview/lines.ts'],
  'md-h6': ['src/editor/preview/lines.ts'],
  'md-quote': ['src/editor/preview/lines.ts'],
  'md-callout': ['src/editor/preview/lines.ts'],
  'md-fence-line': ['src/editor/preview/lines.ts'],
  'md-list-line': ['src/editor/preview/lines.ts'],
  'md-hr': ['src/editor/preview/lines.ts'],
  'md-block': ['src/editor/preview/blocks.ts'],
  'md-codeblock': ['src/editor/preview/blocks.ts'],
  'md-table': ['src/editor/preview/tableWidget.ts'],
  'md-code': ['src/editor/highlight.ts'],
  'md-link': ['src/editor/preview/inline.ts'],
  'md-highlight': ['src/editor/preview/highlightMark.ts'],
  'markdown-body': ['src/viewer/Viewer.tsx', 'src/app/printDoc.ts', 'src/viewer/toHtmlDoc.ts'],
  'markdown-callout': ['src/viewer/renderMarkdown.ts'],
}
const CM6_CLASSES = new Set(['cm-editor', 'cm-line', 'cm-content'])

describe('F-2093 U2 훅이 소스에 붙어 있다', () => {
  test('뼈대 훅 값이 고정 사본과 같다', () => {
    expect(CHROME_HOOKS.map((h) => h.value)).toEqual(CHROME_HOOK_VALUES)
  })

  test('각 훅의 files 모두에 붙이는 문자열이 있다', () => {
    for (const hook of CHROME_HOOKS) {
      for (const file of hook.files) {
        const src = read(file)
        expect(hookPatterns(hook.value).some((re) => re.test(src)), `${hook.value} @ ${file}`).toBe(true)
      }
    }
  })

  test('상태 속성 이름이 src 어딘가에 있다', () => {
    expect(STATE_ATTRS.map((a) => a.name)).toEqual([
      'data-theme', 'data-heading-font', 'data-body-font', 'data-font-size', 'data-indent', 'data-printing', 'data-user-css', 'data-view-mode',
    ])
    const all = SRC_TS.map(read).join('\n')
    for (const attr of STATE_ATTRS) {
      const camel = attr.name.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())
      expect(all.includes(attr.name) || all.includes(`dataset.${camel}`), attr.name).toBe(true)
    }
  })

  test('본문 훅 id·선택자가 고정 사본과 같다', () => {
    expect(CONTENT_HOOKS.map((h) => h.id)).toEqual(CONTENT_HOOK_IDS)
    for (const hook of CONTENT_HOOKS) {
      expect(hook.edit, hook.id).toEqual(CONTENT_HOOK_COPY[hook.id].edit)
      expect(hook.view, hook.id).toEqual(CONTENT_HOOK_COPY[hook.id].view)
    }
  })

  test('선택자의 우리 클래스가 만드는 소스에 낱말로 있다', () => {
    const selectors = CONTENT_HOOKS.flatMap((h) => [...h.edit, ...h.view])
    const classes = new Set(selectors.flatMap((s) => (s.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1))))
    for (const cls of classes) {
      if (CM6_CLASSES.has(cls)) continue
      expect(CLASS_SOURCES[cls], `${cls} 의 소스 대응이 테스트에 없다`).toBeDefined()
      for (const file of CLASS_SOURCES[cls]) {
        expect(new RegExp(`["'\`\\s]${cls}["'\`\\s]`).test(read(file)), `${cls} @ ${file}`).toBe(true)
      }
    }
    expect(read('src/viewer/renderMarkdown.ts')).toContain('md-callout--')
    expect(read('src/editor/preview/lines.ts')).toContain('md-callout--')
  })
})

// ── U3·U4 ──
function collectInlineVarNames(sources: string[]): Set<string> {
  const names = new Set<string>()
  const all = sources.map(stripJsComments).join('\n')
  const consts = new Map<string, string>()
  for (const m of all.matchAll(/const\s+(\w+)\s*=\s*['"](--[\w-]+)['"]/g)) consts.set(m[1], m[2])
  for (const m of all.matchAll(/setProperty\(\s*(?:['"](--[\w-]+)['"]|(\w+))/g)) {
    const name = m[1] ?? consts.get(m[2])
    if (name) names.add(name)
  }
  for (const m of all.matchAll(/['"](--[\w-]+)['"]\s*:/g)) names.add(m[1])
  return names
}

describe('F-2093 U3·U4 앱이 창구를 쓰지 않는다', () => {
  test('U3 모으는 함수가 고정 조각 셋에서 이름을 모두 뽑는다', () => {
    const found = collectInlineVarNames([
      "el.style.setProperty('--a', '1')",
      "const NAME = '--b'\nel.style.setProperty(NAME, '1')",
      "<div style={{ '--c': 3 }} />",
    ])
    expect([...found].sort()).toEqual(['--a', '--b', '--c'])
  })

  test('U3 인라인으로 쓰는 이름과 공개 변수가 겹치지 않는다', () => {
    const inline = collectInlineVarNames(SRC_TS.map(read))
    const overlap = PUBLIC_VARS.map((p) => p.name).filter((n) => inline.has(n))
    expect(overlap).toEqual([])
  })

  test('U4 CSS 에 훅 속성 선택자가 없다', () => {
    for (const file of SRC_CSS) expect(stripComments(read(file)), file).not.toMatch(/\[data-ui|\[data-view-mode/)
  })

  test('U4 ts·tsx 가 훅 속성을 찾거나 읽지 않는다', () => {
    const readers = /(?:querySelector(?:All)?|closest|matches|getAttribute)\(\s*(['"`])((?:(?!\1).)*)\1/g
    for (const file of SRC_TS) {
      for (const m of stripJsComments(read(file)).matchAll(readers)) {
        expect(m[2], file).not.toMatch(/data-ui|data-view-mode/)
      }
    }
  })
})

// ── U5 ──
describe('F-2093 U5 도우미', () => {
  test('특정도가 고정 값과 같다', () => {
    const table: [string, Spec][] = [
      [':root:root .markdown-body :not(pre) > code', [0, 3, 2]],
      [':is(.app-shell, .public-view, .wiki-preview) .markdown-body h1', [0, 2, 1]],
      [".cm-host .cm-editor[data-view='live'] .md-link:hover", [0, 5, 0]],
      ['.print-root .markdown-body :is(pre, code, .markdown-callout, mark, th, tr:nth-child(even))', [0, 3, 1]],
      ['.markdown-body a:has(>p,>div,>pre,>blockquote):not(:has(.snippet-clipboard-content,>pre))', [0, 2, 2]],
      ['.cm-host .cm-editor .cm-line.md-hr::before', [0, 4, 1]],
      [':where(h1, h2)', [0, 0, 0]],
      ['#x .y', [1, 1, 0]],
    ]
    for (const [selector, expected] of table) expect(specificity(selector), selector).toEqual(expected)
  })

  test('블록 걷기가 조건부 블록 안은 읽고 keyframes·font-face·문자열 속 중괄호는 건너뛴다', () => {
    const css = `
      /* .commented { } */
      .a, .b > .c { content: '{'; }
      @media (min-width: 1px) { .m { color: red } }
      @keyframes spin { from { opacity: 0 } to { opacity: 1 } }
      @font-face { font-family: x; src: url(x.woff2) }
      @import 'y.css';
      .z::after { content: "}" }
    `
    expect(collectSelectors(css)).toEqual(['.a', '.b > .c', '.m', '.z::after'])
  })
})

describe('F-2093 U5 권장 선택자가 앱 규칙 이상', () => {
  const recommended = CONTENT_HOOKS.flatMap((h) => [...h.edit, ...h.view])

  test('권장 선택자가 33개다', () => {
    expect(recommended).toHaveLength(33)
  })

  test.each(recommended)('%s', (selector) => {
    const rivals = contenders(selector)
    expect(rivals.length, `${selector} 와 겨루는 앱 선택자가 없다 — 클래스 이름이 어긋났다`).toBeGreaterThan(0)
    const mine = specificity(selector)
    const strongest = rivals.reduce((best, r) => (cmp(specificity(r.selector), specificity(best.selector)) > 0 ? r : best))
    expect(
      cmp(mine, specificity(strongest.selector)),
      `${selector} ${JSON.stringify(mine)} 가 ${strongest.selector} (${strongest.file}) 에 진다 — 앱 선택자를 낮춘다(F-2093 2장 결정 2)`,
    ).toBeGreaterThanOrEqual(0)
  })
})

// ── U6 ──
describe('F-2093 U6 템플릿 CSS', () => {
  const template = buildTemplateCss(TOKENS)
  const HEX = /#[0-9a-fA-F]{3,8}\b/g
  const collapsed = (css: string) => stripComments(css).replace(/\s+/g, ' ').trim()

  test('공개 변수·뼈대 훅·본문 훅 선택자가 모두 들어 있다', () => {
    for (const name of PUBLIC_VAR_NAMES) expect(template, name).toContain(`/* ${name}:`)
    for (const value of CHROME_HOOK_VALUES) expect(template, value).toContain(`[data-ui="${value}"]`)
    const selectors = CONTENT_HOOKS.flatMap((h) => [...h.edit, ...h.view])
    expect(selectors).toHaveLength(33)
    for (const s of selectors) expect(template, s).toContain(`/* ${s} { } */`)
  })

  test('주석을 모두 지우면 빈 규칙 둘만 남는다', () => {
    expect(collapsed(template)).toBe(":root:root { } :root[data-theme='dark'] { }")
  })

  test('hex 는 모두 tokens.css 원문에 있고 빈 입력에는 hex 가 없다', () => {
    const hexes = template.match(HEX) ?? []
    expect(hexes.length).toBeGreaterThan(0)
    for (const hex of hexes) expect(TOKENS, hex).toContain(hex)
    const empty = buildTemplateCss('')
    expect(empty.match(HEX) ?? []).toEqual([])
    for (const name of PUBLIC_VAR_NAMES) expect(empty).toContain(`/* ${name}: ; */`)
    expect(collapsed(empty)).toBe(":root:root { } :root[data-theme='dark'] { }")
  })

  test('다크 블록 선언 이름이 tokens.css 다크 블록의 공개 변수와 같다', () => {
    const darkSrc = /:root\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(stripComments(TOKENS))?.[1] ?? ''
    const expected = PUBLIC_VAR_NAMES.filter((n) => new RegExp(`${n}\\s*:`).test(darkSrc))
    const darkOut = template.slice(template.indexOf(":root[data-theme='dark'] {"), template.indexOf('/* ── 화면 뼈대'))
    const actual = [...darkOut.matchAll(/^ {2}\/\* (--[\w-]+):/gm)].map((m) => m[1])
    expect(expected.length).toBeGreaterThan(0)
    expect(actual).toEqual(expected)
  })

  test('선언 줄·선택자 줄이 한 줄에 주석 하나이고 줄 끝이 \\n 하나로 끝난다', () => {
    for (const line of template.split('\n')) {
      if (/^ {2}\/\* --[\w-]+:/.test(line)) expect(line).toMatch(/^ {2}\/\* --[\w-]+: .*; \*\/$/)
      if (/ \{ \} \*\/$/.test(line)) expect(line).toMatch(/^\/\* \S.* \{ \} \*\/$/)
      if (line.startsWith('/*') && line !== '/*') {
        expect(line.split('/*').length, line).toBe(2)
        expect(line.split('*/').length, line).toBe(2)
      }
    }
    expect(template.endsWith('\n')).toBe(true)
    expect(template.endsWith('\n\n')).toBe(false)
    expect(template).not.toContain('\r')
  })

  test('제품명이 없고 같은 입력이면 같은 출력이다', () => {
    expect(template.toLowerCase()).not.toContain(brand.name.toLowerCase())
    expect(buildTemplateCss(TOKENS)).toBe(template)
  })
})

describe('F-2095 A13 data-user-css 상태 속성', () => {
  test('<html> 에 on·off·safe, data-printing 바로 뒤', () => {
    const names = STATE_ATTRS.map((a) => a.name)
    expect(names).toHaveLength(8)
    expect(names.indexOf('data-user-css')).toBe(names.indexOf('data-printing') + 1)
    const attr = STATE_ATTRS.find((a) => a.name === 'data-user-css')
    expect(attr?.on).toBe('html')
    expect(attr?.values).toEqual(['on', 'off', 'safe'])
  })
})
