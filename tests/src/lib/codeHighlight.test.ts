import { describe, it, expect, beforeAll } from 'vitest'
import type { Parser } from '@lezer/common'
import {
  CODE_TOKEN_KINDS,
  CODE_HIGHLIGHT_LIMITS,
  highlightCodeLines,
  highlightHtmlCodeBlocks,
  type CodeSegment,
  type CodeTokenKind,
} from '../../../src/lib/codeHighlight'
import { loadCodeGrammar } from '../../../src/lib/codeParsers'
import type { CodeLangId } from '../../../src/lib/codeLang'

const IDS: CodeLangId[] = [
  'javascript',
  'jsx',
  'typescript',
  'tsx',
  'css',
  'html',
  'xml',
  'json',
  'yaml',
  'python',
  'sql',
  'shell',
]
const parsers = {} as Record<CodeLangId, Parser>

beforeAll(async () => {
  for (const id of IDS) parsers[id] = (await loadCodeGrammar(id))!.parser
})

// 한 줄의 글자마다 종류
function kindsOf(line: CodeSegment[]): (CodeTokenKind | null)[] {
  return line.flatMap((seg) => Array.from({ length: seg.text.length }, () => seg.kind))
}

// 낱말이면 앞뒤가 식별자 글자가 아닌 첫 자리, 아니면 첫 indexOf
function findToken(line: string, token: string): number {
  if (/^[\w$]+$/.test(token)) {
    const m = new RegExp(`(?<![\\w$])${token.replace(/\$/g, '\\$')}(?![\\w$])`).exec(line)
    return m ? m.index : -1
  }
  return line.indexOf(token)
}

type Expect = [token: string, kind: CodeTokenKind | null]

// F-2123 6장 A4 표 — 코드 줄과 "글자=종류"
const A4: { id: CodeLangId; code: string; expect: Expect[] }[] = [
  {
    id: 'typescript',
    code: 'const a: number = f(1)\nreturn `t${a}` as Promise<string>\nconst o = { key: 1 } // c',
    expect: [
      ['const', 'keyword'],
      ['number', 'type'],
      ['f', 'function'],
      ['1', 'number'],
      ['return', 'keyword'],
      ['`t', 'string'],
      ['as', 'keyword'],
      ['Promise', 'type'],
      ['key', 'property'],
      ['// c', 'comment'],
    ],
  },
  {
    id: 'javascript',
    code: 'import x from "y"\nconst r = /ab+/g; this.go(null, true)',
    expect: [
      ['import', 'keyword'],
      ['"y"', 'string'],
      ['/ab+/g', 'string'],
      ['this', 'keyword'],
      ['go', 'function'],
      ['null', 'number'],
      ['true', 'number'],
    ],
  },
  {
    id: 'jsx',
    code: 'const e = <Foo bar="1">x</Foo>',
    expect: [
      ['Foo', 'tag'],
      ['bar', 'property'],
      ['"1"', 'string'],
    ],
  },
  {
    id: 'tsx',
    code: 'const e: T = <div className="a">{n}</div>',
    expect: [
      ['T', 'type'],
      ['div', 'tag'],
      ['className', 'property'],
    ],
  },
  {
    id: 'css',
    code: 'a { color: #fff; margin: 2px } /* c */ @media screen {}',
    expect: [
      ['a', 'tag'],
      ['color', 'property'],
      ['#fff', 'number'],
      ['2px', 'number'],
      ['/* c */', 'comment'],
      ['@media', 'keyword'],
    ],
  },
  {
    id: 'html',
    code: '<div class="x">t</div><script>const a = 1</script><style>p { color: red }</style><!-- c -->',
    expect: [
      ['div', 'tag'],
      ['class', 'property'],
      ['"x"', 'string'],
      ['const', 'keyword'],
      ['color', 'property'],
      ['<!-- c -->', 'comment'],
    ],
  },
  {
    id: 'xml',
    code: '<?xml version="1.0"?><a b="c">t</a><!-- c -->',
    expect: [
      ['a', 'tag'],
      ['b', 'property'],
      ['"c"', 'string'],
      ['<!-- c -->', 'comment'],
    ],
  },
  {
    id: 'json',
    code: '{ "key": 1, "s": "v", "b": true, "n": null }',
    expect: [
      ['"key"', 'property'],
      ['1', 'number'],
      ['"v"', 'string'],
      ['true', 'number'],
      ['null', 'number'],
    ],
  },
  {
    id: 'yaml',
    code: 'key: value\nb: true # c',
    expect: [
      ['key', 'property'],
      ['# c', 'comment'],
      ['value', null],
      ['true', null],
    ],
  },
  {
    id: 'python',
    code: 'def f(x):\n    return str(x) if x is None else 1.5 # c\nclass A: pass',
    expect: [
      ['def', 'keyword'],
      ['f', 'function'],
      ['str', 'function'],
      ['None', 'number'],
      ['1.5', 'number'],
      ['# c', 'comment'],
      ['A', 'type'],
    ],
  },
  {
    id: 'sql',
    code: "SELECT name, COUNT(*) FROM users WHERE id = 1 AND s = 'x' -- c",
    expect: [
      ['SELECT', 'keyword'],
      ['FROM', 'keyword'],
      ['1', 'number'],
      ["'x'", 'string'],
      ['-- c', 'comment'],
    ],
  },
  {
    id: 'shell',
    code: 'echo "hi" $HOME # c\nif [ -f x ]; then ls; fi',
    expect: [
      ['"hi"', 'string'],
      ['# c', 'comment'],
      ['if', 'keyword'],
      ['then', 'keyword'],
      ['fi', 'keyword'],
    ],
  },
]

describe('CODE_TOKEN_KINDS (F-2122 1.3 고정 사본)', () => {
  it('여덟 종류, 순서까지 같다', () => {
    expect([...CODE_TOKEN_KINDS]).toEqual(['keyword', 'string', 'comment', 'number', 'function', 'type', 'property', 'tag'])
  })

  it('상한 값', () => {
    expect(CODE_HIGHLIGHT_LIMITS).toEqual({ blockChars: 20_000, totalChars: 100_000 })
  })
})

describe('highlightCodeLines 태그 → 종류 (F-2123 A4)', () => {
  for (const row of A4) {
    it(`${row.id}: ${row.expect.map(([t, k]) => `${t}=${k ?? '없음'}`).join(' ')}`, () => {
      const codeLines = row.code.split('\n')
      const result = highlightCodeLines(row.code, parsers[row.id])
      const lineKinds = result.map(kindsOf)
      for (const [token, kind] of row.expect) {
        const lineIndex = codeLines.findIndex((l) => findToken(l, token) >= 0)
        expect(lineIndex, token).toBeGreaterThanOrEqual(0)
        const at = findToken(codeLines[lineIndex], token)
        const got = lineKinds[lineIndex].slice(at, at + token.length)
        expect(got, `${row.id} ${token}`).toEqual(Array(token.length).fill(kind))
      }
    })
  }
})

describe('highlightCodeLines 줄 나누기 (F-2123 3.3)', () => {
  it("'\\n' 이 k 개면 k+1 줄, 빈 줄은 [], 조각을 이으면 그 줄 원문", () => {
    const code = 'const a = 1\n\n/* x\ny */ let b = "s"\n'
    const result = highlightCodeLines(code, parsers.typescript)
    const lines = code.split('\n')
    expect(result).toHaveLength(lines.length)
    expect(result[1]).toEqual([])
    expect(result[4]).toEqual([])
    result.forEach((line, i) => {
      expect(line.map((s) => s.text).join('')).toBe(lines[i])
      for (const seg of line) {
        expect(seg.text.length).toBeGreaterThan(0)
        expect(seg.text).not.toContain('\n')
      }
    })
  })

  it('여러 줄 주석은 줄마다 comment 조각으로 나뉜다', () => {
    const result = highlightCodeLines('/* x\ny */', parsers.javascript)
    expect(result).toEqual([[{ text: '/* x', kind: 'comment' }], [{ text: 'y */', kind: 'comment' }]])
  })

  it('칠하지 않은 글자는 kind null 조각', () => {
    const result = highlightCodeLines('const a = 1', parsers.javascript)
    expect(result[0][0]).toEqual({ text: 'const', kind: 'keyword' })
    expect(result[0].some((s) => s.kind === null)).toBe(true)
  })

  it('빈 문자열은 빈 줄 하나', () => {
    expect(highlightCodeLines('', parsers.python)).toEqual([[]])
  })
})

describe('highlightCodeLines 상한 (F-2123 3.3)', () => {
  it('blockChars 를 넘으면 파싱하지 않고 줄마다 null 조각 하나, 빈 줄은 []', () => {
    const line = 'const a = 1;'
    let code = ''
    while (code.length <= CODE_HIGHLIGHT_LIMITS.blockChars) code += line + '\n\n'
    code = code.slice(0, CODE_HIGHLIGHT_LIMITS.blockChars + 1)
    expect(code.length).toBe(CODE_HIGHLIGHT_LIMITS.blockChars + 1)
    const result = highlightCodeLines(code, parsers.typescript)
    const lines = code.split('\n')
    expect(result).toHaveLength(lines.length)
    result.forEach((segs, i) => {
      if (lines[i] === '') expect(segs).toEqual([])
      else expect(segs).toEqual([{ text: lines[i], kind: null }])
    })
  })

  it('딱 blockChars 면 칠한다', () => {
    const code = ('const a = 1;\n'.repeat(2000)).slice(0, CODE_HIGHLIGHT_LIMITS.blockChars)
    expect(code.length).toBe(CODE_HIGHLIGHT_LIMITS.blockChars)
    const result = highlightCodeLines(code, parsers.typescript)
    expect(result[0][0]).toEqual({ text: 'const', kind: 'keyword' })
  })

  it('상한을 넘은 블록은 캐시에 넣지 않는다', () => {
    const code = 'x'.repeat(CODE_HIGHLIGHT_LIMITS.blockChars + 1)
    const a = highlightCodeLines(code, parsers.javascript)
    const b = highlightCodeLines(code, parsers.javascript)
    expect(b).toEqual(a)
    expect(b).not.toBe(a)
  })
})

describe('highlightCodeLines 캐시 (F-2123 3.3)', () => {
  it('같은 (파서, 코드) 두 번 → 같은 객체, 파서가 다르면 다른 결과', () => {
    const a = highlightCodeLines('let cacheA = 1', parsers.typescript)
    expect(highlightCodeLines('let cacheA = 1', parsers.typescript)).toBe(a)
    expect(highlightCodeLines('let cacheA = 1', parsers.javascript)).not.toBe(a)
  })

  it('200개를 넘으면 가장 오래 안 쓴 것부터 버린다', () => {
    const first = highlightCodeLines('let evictMe = 0', parsers.typescript)
    for (let i = 1; i <= 200; i++) highlightCodeLines(`let filler${i} = ${i}`, parsers.typescript)
    const again = highlightCodeLines('let evictMe = 0', parsers.typescript)
    expect(again).toEqual(first)
    expect(again).not.toBe(first)
  })

  it('찾으면 가장 최근으로 옮겨져 살아남는다', () => {
    const kept = highlightCodeLines('let keepMe = 0', parsers.typescript)
    for (let i = 1; i <= 199; i++) highlightCodeLines(`let lru${i} = ${i}`, parsers.typescript)
    expect(highlightCodeLines('let keepMe = 0', parsers.typescript)).toBe(kept)
    highlightCodeLines('let lruOverflow = 1', parsers.typescript)
    expect(highlightCodeLines('let keepMe = 0', parsers.typescript)).toBe(kept)
  })
})

// markdown-it escapeHtml 과 같은 네 글자
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function unesc(s: string): string {
  return s.replace(/&(amp|lt|gt|quot);/g, (_, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"' })[n]!)
}
function fence(lang: string | null, code: string, attrs = ''): string {
  const cls = lang ? ` class="language-${lang}"` : ''
  return `<pre><code${attrs}${cls}>${esc(code)}</code></pre>\n`
}
const parserFor = (id: CodeLangId) => parsers[id] ?? null
const preBlocks = (html: string) => html.match(/<pre[\s\S]*?<\/pre>/g) ?? []

describe('highlightHtmlCodeBlocks (F-2123 A5)', () => {
  it('태그를 지우고 네 글자를 풀면 입력 코드와 같고, <pre><code …> 앞부분이 그대로', () => {
    const code = 'const s = "<a href=\\"x\\">" && a < b > c & d // "q" <b>\n'
    const head = '<pre><code data-source-line="1" class="language-ts">'
    const html = `<p>앞</p>\n${fence('ts', code, ' data-source-line="1"')}<p>뒤</p>\n`
    const out = highlightHtmlCodeBlocks(html, parserFor)
    expect(out).not.toBe(html)
    expect(out).toContain(head)
    expect(out).toContain('<span class="code-keyword">const</span>')
    expect(out.startsWith('<p>앞</p>\n' + head)).toBe(true)
    expect(out.endsWith('</code></pre>\n<p>뒤</p>\n')).toBe(true)
    const inner = out.slice(out.indexOf(head) + head.length, out.indexOf('</code></pre>'))
    expect(unesc(inner.replace(/<\/?span[^>]*>/g, ''))).toBe(code)
  })

  it('&amp;lt; 는 한 번만 풀고 다시 &amp;lt; 로', () => {
    const code = 'const s = "&lt;" // &amp;\n'
    const out = highlightHtmlCodeBlocks(fence('js', code), parserFor)
    expect(out).toContain('&amp;lt;')
    expect(out).toContain('&amp;amp;')
    const inner = out.slice(out.indexOf('>', out.indexOf('<code')) + 1, out.indexOf('</code>'))
    expect(unesc(inner.replace(/<\/?span[^>]*>/g, ''))).toBe(code)
  })

  it('조각마다 code-{종류} span, 줄은 \\n 으로', () => {
    const out = highlightHtmlCodeBlocks(fence('py', 'def f():\n  pass\n'), parserFor)
    expect(out).toContain('<span class="code-keyword">def</span> <span class="code-function">f</span>')
    expect(out).toContain('\n  <span class="code-keyword">pass</span>\n</code></pre>')
  })

  it('language-kotlin·언어 없는 <pre><code>·mermaid div·프론트매터 pre 는 그대로, 칠할 블록이 없으면 같은 값', () => {
    const html =
      fence('kotlin', 'val a = 1\n') +
      fence(null, 'const a = 1\n') +
      '<div class="md-mermaid" data-mermaid-source="graph TD"></div>\n' +
      '<pre class="markdown-frontmatter-raw"><code>a: 1</code></pre>\n' +
      '<p><code class="language-ts">const</code></p>\n'
    expect(highlightHtmlCodeBlocks(html, parserFor)).toBe(html)
  })

  it('parserFor 가 null 이면 그 블록은 그대로', () => {
    const html = fence('ts', 'const a = 1\n') + fence('py', 'def f(): pass\n')
    const out = highlightHtmlCodeBlocks(html, (id) => (id === 'python' ? parsers.python : null))
    const [ts, py] = preBlocks(out)
    expect(ts).toBe(preBlocks(html)[0])
    expect(py).toContain('code-keyword')
  })

  it('문서 상한 — 19,000자 × 6 이면 다섯 개만, 그 뒤 10자 블록도 그대로', () => {
    const big = ('const a = 1;\n'.repeat(2000)).slice(0, 19_000)
    const html = Array.from({ length: 6 }, () => fence('ts', big)).join('') + fence('ts', 'const b=1')
    const out = highlightHtmlCodeBlocks(html, parserFor)
    const before = preBlocks(html)
    const after = preBlocks(out)
    expect(after).toHaveLength(7)
    for (let i = 0; i < 5; i++) expect(after[i], `블록 ${i}`).toContain('code-keyword')
    expect(after[5]).toBe(before[5])
    expect(after[6]).toBe(before[6])
  })

  it('blockChars 를 넘어 손대지 않은 블록은 합에 넣지 않는다', () => {
    const huge = 'x'.repeat(CODE_HIGHLIGHT_LIMITS.blockChars + 1)
    const big = ('const a = 1;\n'.repeat(2000)).slice(0, 19_000)
    const html = fence('ts', huge) + Array.from({ length: 5 }, () => fence('ts', big)).join('') + fence('ts', 'const b=1')
    const after = preBlocks(highlightHtmlCodeBlocks(html, parserFor))
    expect(after[0]).toBe(preBlocks(html)[0])
    for (let i = 1; i <= 6; i++) expect(after[i], `블록 ${i}`).toContain('code-keyword')
  })

  it('합은 푼 뒤 길이로 센다', () => {
    const amp = '&'.repeat(19_000)
    const html = Array.from({ length: 5 }, () => fence('ts', amp)).join('') + fence('ts', 'const b=1')
    const after = preBlocks(highlightHtmlCodeBlocks(html, parserFor))
    expect(after[5]).toContain('code-keyword')
  })
})
