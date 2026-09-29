// 사용자 CSS 필터 A2~A7 (specs/features/F-2094.md 7.2)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { preprocessCss, tokenizeCss } from '../../../src/lib/cssTokens'
import { filterUserCss, topLevelRuleHeads } from '../../../src/lib/userCssFilter'
import type { UserCssRemoval } from '../../../src/lib/userCssPolicy'

function expectContiguous(text: string) {
  const pre = preprocessCss(text)
  let at = 0
  for (const t of tokenizeCss(pre).tokens) {
    expect(t.start).toBe(at)
    at = t.end
  }
  expect(at).toBe(pre.length)
}

function run(input: string) {
  const out = filterUserCss(input)
  expectContiguous(input)
  expectContiguous(out.css)
  const again = filterUserCss(out.css)
  expect(again.removed).toEqual([])
  expect(again.css).toBe(out.css)
  return out
}

function forbiddenLeft(css: string): string[] {
  const tokens = tokenizeCss(preprocessCss(css)).tokens.filter((t) => t.type !== 'comment')
  const found: string[] = []
  const argOk = (arg: string | null) => {
    if (arg === null) return false
    const cleaned = arg.replace(/[\t\n\r]/g, '')
    let k = 0
    while (k < cleaned.length && cleaned.charCodeAt(k) <= 0x20) k++
    return /^(data:|#)/i.test(cleaned.slice(k))
  }
  tokens.forEach((t, i) => {
    const name = t.value.toLowerCase()
    if (t.type === 'bad-url') found.push('bad-url')
    else if (t.type === 'url' && !argOk(t.value)) found.push(`url(${t.value})`)
    else if (t.type === 'function' && name === 'url') {
      let k = i + 1
      while (tokens[k]?.type === 'whitespace') k++
      const arg = tokens[k]?.type === 'string' ? tokens[k].value : null
      if (!argOk(arg)) found.push(`url("${arg}")`)
    } else if (t.type === 'function' && (name === 'src' || name === 'image' || name === 'image-set' || name.endsWith('-image-set'))) found.push(name)
  })
  return found
}

const count = (removed: readonly UserCssRemoval[]) => {
  const byReason: Record<string, number> = {}
  for (const r of removed) byReason[r.reason] = (byReason[r.reason] ?? 0) + 1
  return byReason
}

// 7.5 표 1~15행
const HOSTILE = String.raw`@import url(http://evil.test/imp.css);
@\69mport url(http://evil.test/esc-imp.css);
@namespace svg url(http://www.w3.org/2000/svg);
@property --p { syntax: '<url>'; inherits: false; initial-value: url(http://evil.test/prop.png) }
@function --f() { result: url(http://evil.test/fn.png) }
.j { background-image: --f() }
@font-face { font-family: Evil; src: url(http://evil.test/f.woff2) }
.a { font-family: Evil, Ok; background-image: var(--v) }
:root { --v: \75 rl(http://evil.test/cv.png); --w: url(http://evil.test/cw.png); --s: "http://evil.test/cs.png" }
.b { background-image: var(--w) }
.c { background-image: image-set(var(--s) 1x) }
.w { background-image: image(var(--s)) }
.d { background-image: \75 rl(http://evil.test/esc.png) }
.v { background-image: URL(http://evil.test/up.png) }
.e { background-image: image-set("http://evil.test/is.png" 1x) }
.x { background-image: -webkit-image-set(url(http://evil.test/wis.png) 1x) }
.f { background: red url(http://evil.test/bg.png) no-repeat; border-image: url(http://evil.test/bi.png) 30 }
.g { background-image: var(--nope, \75 rl(http://evil.test/vf.png)) }
.h { background-image: if(media(width > 1px): url(http://evil.test/if.png); else: none) }
.i { background-image: env(nope, url(http://evil.test/env.png)) }
.z { background: var(--nope, url(http://evil.test/sh.png)) }
.y { margin: var(--m, 7px); margin-top: 0; background: var(--nope2, url(http://evil.test/hidden.png)); background-color: red }
.k { & .l { background-image: url(http://evil.test/n.png) } color: blue; list-style-image: url(//evil.test/l.png) }
@media all { .m { background-image: url(http://evil.test/media.png) } }
@keyframes kf { from { background-image: url(http://evil.test/kf.png) } to { opacity: 1 } }
.n { animation: kf 10s infinite }
@page { @top-left { content: url(http://evil.test/m.png) } }
`
// 7.5 표 16행 — 글자 그대로 남아야 한다
const KEEP = String.raw`@layer a, b;
@font-face { font-family: Ok; src: local(Arial), url(data:font/woff2;base64,AAAA) }
.o { background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); filter: url(#x) }
.o::before { content: "\201C" }
:root { --ok: 12px }
.p { padding: var(--ok) }
`

describe('F-2094 A2 적대 조각', () => {
  const out = run(HOSTILE + KEEP)
  test('결과에 금지 토큰이 없다', () => {
    expect(forbiddenLeft(out.css)).toEqual([])
    expect(forbiddenLeft(HOSTILE).length).toBeGreaterThan(20)
  })
  test('이유별 수', () => {
    expect(count(out.removed)).toEqual({
      import: 2, 'rule-kind': 3, 'font-src': 1, 'custom-property': 2, substitution: 7, url: 11,
    })
  })
  test('16행이 글자 그대로 남는다', () => {
    expect(out.css.endsWith(KEEP)).toBe(true)
    expect(out.css).toContain('.j { background-image: --f() }')
    expect(out.css).toContain('--s: "http://evil.test/cs.png"')
  })
})

describe('F-2094 A3 보존·선언 단위', () => {
  test('뺄 것 없는 입력은 전처리한 원문 그대로', () => {
    const markdownCss = readFileSync(fileURLToPath(new URL('../../../src/styles/markdown.css', import.meta.url)), 'utf-8')
    for (const input of [markdownCss, KEEP, 'a\r\nb { c: d }\r\n', '']) {
      const out = run(input)
      expect(out.removed).toEqual([])
      expect(out.css).toBe(preprocessCss(input))
    }
  })

  test('허용 열 전부를 한 규칙에 넣어도 그대로', () => {
    const input = `.t { ${ALLOWED.join('; ')} }\n` + ALLOWED.map((d, i) => `.u${i} { ${d} }`).join('\n')
    const out = run(input)
    expect(out.removed).toEqual([])
    expect(out.css).toBe(input)
  })

  test('11행은 한 선언만 빠진다', () => {
    const input = '.y { margin: var(--m, 7px); margin-top: 0; background: var(--n, url(http://x)); background-color: red }'
    const out = run(input)
    expect(out.css).toBe('.y { margin: var(--m, 7px); margin-top: 0;  background-color: red }')
    expect(out.removed).toEqual([{ reason: 'substitution', rule: '.y', property: 'background' }])
  })
})

const ALLOWED = [
  '--s: "http://e/x"', '--ok: 12px', '--b: {a;b}',
  'padding: var(--ok)', 'background-image: --f()', 'content: attr(title)',
  'background-image: url(" data:,a")', 'background-image: url("d\tata:,a")',
  'background-image: url(data:image/gif;base64,R0lGOD)', 'filter: url(#x)', 'content: "url(http://x)"', 'content: "\\201C"',
]

const JUDGED: [string, string, string][] = [
  ['--v: \\75 rl(http://e/x)', '--v', 'custom-property'],
  ['--w: url(data:,x)', '--w', 'custom-property'],
  ['--q: "\\201C"', '--q', 'custom-property'],
  ['background-image: image-set(var(--s) 1x)', 'background-image', 'substitution'],
  ['background-image: var(--n, \\75 rl(http://e/x))', 'background-image', 'substitution'],
  ['background-image: var(--n, "\\61")', 'background-image', 'substitution'],
  ['background-image: if(media(width > 1px): url(http://e/x); else: none)', 'background-image', 'substitution'],
  ['background-image: env(n, url(http://e/x))', 'background-image', 'substitution'],
  ['background: var(--n, url(http://e/x))', 'background', 'substitution'],
  ['background: var(--x, url(data:,a))', 'background', 'substitution'],
  ['background-image: image(var(--s))', 'background-image', 'substitution'],
  ['x: --f(url(data:,a))', 'x', 'substitution'],
  ['background-image: \\75 rl(http://e/x)', 'background-image', 'url'],
  ['background-image: URL(http://e/x)', 'background-image', 'url'],
  ['background-image: url("//e/x")', 'background-image', 'url'],
  ['background-image: url(foo.cur)', 'background-image', 'url'],
  ['background-image: image-set(url(data:,a) 1x)', 'background-image', 'url'],
  ['background-image: -webkit-image-set(url(data:,a) 1x)', 'background-image', 'url'],
  ['background-image: src("x")', 'background-image', 'url'],
  ['background-image: \\69mage("x")', 'background-image', 'url'],
  ['background: red url(http://e/x) no-repeat', 'background', 'url'],
  ['cursor: url(a b), auto', 'cursor', 'url'],
  ['b\\61 ckground: url(http://e/x)', 'background', 'url'],
]

describe('F-2094 A4 판정 표', () => {
  for (const [decl, property, reason] of JUDGED) {
    test(decl, () => {
      const out = run(`.t { ${decl} }`)
      expect(out.removed).toEqual([{ reason, rule: '.t', property }])
      expect(out.css).toBe('.t {  }')
    })
  }
  for (const decl of ALLOWED) {
    test(`허용: ${decl}`, () => {
      const input = `.t { ${decl} }`
      const out = run(input)
      expect(out.removed).toEqual([])
      expect(out.css).toBe(input)
    })
  }
})

describe('F-2094 A5 글꼴·규칙 머리·at-규칙·중첩', () => {
  test('글꼴 — data: 와 local 은 남고 그 밖은 규칙째 font-src', () => {
    const ok = '@font-face { font-family: A; src: local(Arial), url(data:font/woff2;base64,AA) }'
    expect(run(ok)).toEqual({ css: ok, removed: [] })
    for (const src of ['url(http://e/f)', 'url(#f)', 'url(../x.woff2)']) {
      const out = run(`@font-face { font-family: A; src: ${src} }\n.a { color: red }`)
      expect(out.removed).toEqual([{ reason: 'font-src', rule: '@font-face', property: null }])
      expect(out.css).toBe('\n.a { color: red }')
    }
  })

  test('규칙 머리의 URL 은 규칙째 url', () => {
    expect(run('@supports (background: url(http://e/x)) { .a{} }')).toEqual({
      css: '', removed: [{ reason: 'url', rule: '@supports (background: url(http://e/x))', property: null }],
    })
    expect(run('@media (url(x)) {}').removed).toEqual([{ reason: 'url', rule: '@media (url(x))', property: null }])
    expect(run('.a url(data:,x) { color: red }').removed).toEqual([{ reason: 'url', rule: '.a url(data:,x)', property: null }])
    const str = '.a[data-x="url(http://e)"] {}'
    expect(run(str)).toEqual({ css: str, removed: [] })
  })

  test('허용 at-규칙 이름은 남는다', () => {
    const input = [
      '@charset "utf-8";', '@layer a;', '@layer b { .a { color: red } }', '@media print { .a { color: red } }',
      '@supports (display: grid) { .a { color: red } }', '@container (min-width: 1px) { .a { color: red } }',
      '@scope (.a) { .b { color: red } }', '@starting-style { .a { opacity: 0 } }', '@keyframes k { 0% { opacity: 0 } }',
      '@-webkit-keyframes k { from { opacity: 0 } }', '@page :first { margin: 1cm; @top-center { content: "x" } @bottom-right-corner { content: "y" } }',
      '@MEDIA print { .a { color: red } }',
    ].join('\n')
    expect(run(input)).toEqual({ css: input, removed: [] })
  })

  test('그 밖의 at-규칙은 규칙째 rule-kind, import 는 import', () => {
    const cases: [string, string][] = [
      ['@namespace x url(y);', 'rule-kind'], ['@property --p { syntax: "*"; inherits: false }', 'rule-kind'],
      ['@function --f() { result: 1px }', 'rule-kind'], ['@view-transition { navigation: auto }', 'rule-kind'],
      ['@position-try --t { top: 0 }', 'rule-kind'], ['@counter-style c { symbols: a }', 'rule-kind'],
      ['@font-feature-values F { @swash { x: 1 } }', 'rule-kind'], ['@font-palette-values --p { base-palette: 0 }', 'rule-kind'],
      ['@unknown x;', 'rule-kind'], ['@unknown {}', 'rule-kind'], ['@import "x.css";', 'import'], ['@\\69mport "x.css";', 'import'],
      ['@IMPORT url(x.css) screen;', 'import'],
    ]
    for (const [rule, reason] of cases) {
      const out = run(`${rule}\n.z { color: red }`)
      expect(out.removed.map((r) => [r.reason, r.property])).toEqual([[reason, null]])
      expect(out.css).toBe('\n.z { color: red }')
    }
    expect(run('@namespace x url(y);').removed[0].rule).toBe('@namespace x url(y)')
  })

  test('중첩 at-규칙만 빠진다', () => {
    const out = run('.a { @property --p { syntax: "*"; inherits: false } color: red }')
    expect(out.css).toBe('.a {  color: red }')
    expect(out.removed).toEqual([{ reason: 'rule-kind', rule: '@property --p', property: null }])
  })

  test('중첩 규칙 안 선언만 빠진다', () => {
    const out = run('.k { & .l { background-image: url(http://e/x) } color: blue; list-style-image: url(//e/l) }')
    expect(out.css).toBe('.k { & .l {  } color: blue;  }')
    expect(out.removed).toEqual([
      { reason: 'url', rule: '& .l', property: 'background-image' },
      { reason: 'url', rule: '.k', property: 'list-style-image' },
    ])
  })

  test('a:hover { … } 는 블록 안에서 규칙으로 읽힌다', () => {
    const out = run('.p { a:hover { background-image: url(http://e/x) } color: red }')
    expect(out.css).toBe('.p { a:hover {  } color: red }')
    expect(out.removed).toEqual([{ reason: 'url', rule: 'a:hover', property: 'background-image' }])
  })

  test('@media·@keyframes·@page 안 선언만 빠진다', () => {
    expect(run('@media all { .m { background-image: url(http://e/x) } }')).toEqual({
      css: '@media all { .m {  } }', removed: [{ reason: 'url', rule: '.m', property: 'background-image' }],
    })
    expect(run('@keyframes k { from { background-image: url(http://e/x) } to { opacity: 1 } }')).toEqual({
      css: '@keyframes k { from {  } to { opacity: 1 } }', removed: [{ reason: 'url', rule: 'from', property: 'background-image' }],
    })
    expect(run('@page { @top-left { content: url(http://e/m) } }')).toEqual({
      css: '@page { @top-left {  } }', removed: [{ reason: 'url', rule: '@top-left', property: 'content' }],
    })
  })

  test('블록 안 잘못된 항목에 든 URL 도 잘린다', () => {
    expect(run('.a { 12px url(http://e/x); color: red }')).toEqual({
      css: '.a {  color: red }', removed: [{ reason: 'url', rule: '12px url(http://e/x)', property: null }],
    })
    expect(run('.a { color: red; url(http://e/x) }')).toEqual({
      css: '.a { color: red;  }', removed: [{ reason: 'url', rule: 'url(http://e/x)', property: null }],
    })
    expect(run('} url(http://e/x) .a { color: red }').css).toBe('')
  })

  test('rule 은 공백 묶음을 한 칸으로, 앞 80자', () => {
    expect(run('.a\n\n   /* c */ .b /* d */ { x: url(http://e) }').removed[0].rule).toBe('.a /* c */ .b')
    const long = '.' + 'a'.repeat(100)
    expect(run(`${long} { x: url(http://e) }`).removed[0].rule).toBe(long.slice(0, 80))
  })
})

describe('F-2094 A6 바깥 단위·순서·끝남', () => {
  test('바깥 단위만 적는다', () => {
    expect(run('@property --p { initial-value: url(http://e/x) }').removed).toHaveLength(1)
    expect(run('@supports (x: url(http://e/1)) { .a { b: url(http://e/2) } }').removed).toHaveLength(1)
    expect(run('@font-face { src: url(http://e/f); .x { b: url(http://e/2) } }').removed).toEqual([
      { reason: 'font-src', rule: '@font-face', property: null },
    ])
  })

  test('removed 는 문서 순서', () => {
    const out = run('.a { b: url(http://e/1) } @namespace x; @font-face { src: url(http://e/f) } .c { --d: url(data:,x) } @x;')
    expect(out.removed.map((r) => r.reason)).toEqual(['url', 'rule-kind', 'font-src', 'custom-property', 'rule-kind'])
  })

  test('어떤 입력에도 던지지 않고 끝난다', () => {
    const inputs = [
      '', '}}}', '{{{', ';;;', '@', '\\', 'url(', '('.repeat(100_000), '{'.repeat(100_000), 'a{'.repeat(50_000),
      '.a{b:'.repeat(30_000), '@media{'.repeat(30_000), '[('.repeat(50_000), '"', "'", '/*', 'url(\\', '.a{b:c\\',
      '<!--', '-->', '@import', '@font-face{src:', ':root{--a:{', '.a{--b:url(', '\0\0\0', '\uD800',
    ]
    for (const input of inputs) {
      const out = run(input)
      expect(forbiddenLeft(out.css)).toEqual([])
    }
  })
})

describe('F-2094 A7 끝 닫기', () => {
  const cases = [
    '.a { color: red', '.a { b: c(', '.a { content: "x', '/* x', '.a { background-image: url(data:,x', '.a', '.a { .b',
    '.a { b: c\\', '.a { content: "x\\', '.a { background-image: url(data:,x\\', '@layer a', '@media x', '.a { @media x',
    '.a { b: [(', '.a { b: c } .d', ':root { --x: {', '.a { b: c; } /* x *', '.a { b: c }\\',
  ]
  for (const input of cases) {
    test(JSON.stringify(input), () => {
      const out = run(input)
      const heads = topLevelRuleHeads(out.css + '\n.probe{color:red}')
      expect(heads.filter((h) => h.includes('probe'))).toEqual(['.probe'])
      expect(heads[heads.length - 1]).toBe('.probe')
    })
  }

  test('불완전 규칙만이면 빈 결과, removed 없음', () => {
    expect(run('.a')).toEqual({ css: '', removed: [] })
    expect(run('.a { .b')).toEqual({ css: '.a { }', removed: [] })
  })

  test('불완전 규칙이라도 금지 at-규칙·금지 머리는 적는다', () => {
    expect(run('@import url(http://e/x)').removed.map((r) => r.reason)).toEqual(['import'])
    expect(run('.a url(http://e/x)').removed.map((r) => r.reason)).toEqual(['url'])
  })

  test('닫는 글자를 붙인다', () => {
    expect(run('.a { color: red').css).toBe('.a { color: red}')
    expect(run('.a { b: c(').css).toBe('.a { b: c()}')
    expect(run('.a { content: "x').css).toBe('.a { content: "x"}')
    expect(run('/* x').css).toBe('/* x*/')
    expect(run('.a { background-image: url(data:,x').css).toBe('.a { background-image: url(data:,x)}')
  })
})
