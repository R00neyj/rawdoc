import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  displayLang,
  displayLangFromClass,
  isMermaidInfo,
  codeLangId,
  codeLangIdsInHtml,
  HIGHLIGHT_LANG_LABELS,
} from '../../../src/lib/codeLang'

describe('displayLang (F-248 A1~A5)', () => {
  it('흔한 별칭을 정식 표기로 바꾼다', () => {
    expect(displayLang('js')).toBe('JavaScript')
    expect(displayLang('ts')).toBe('TypeScript')
    expect(displayLang('py')).toBe('Python')
    expect(displayLang('sh')).toBe('Shell')
  })

  it('대소문자를 구분하지 않는다', () => {
    expect(displayLang('JS')).toBe('JavaScript')
    expect(displayLang('Python')).toBe('Python')
  })

  it('정보 문자열의 첫 단어만 본다', () => {
    expect(displayLang('js title="a.js"')).toBe('JavaScript')
  })

  it('표에 없는 언어는 원문 그대로', () => {
    expect(displayLang('brainfuck')).toBe('brainfuck')
  })

  it('빈 값이면 빈 문자열', () => {
    expect(displayLang('')).toBe('')
  })
})

describe('displayLangFromClass (F-293 A1)', () => {
  it('language- 접두사 토큰을 정식 표기로 바꾼다', () => {
    expect(displayLangFromClass('language-js')).toBe('JavaScript')
    expect(displayLangFromClass('language-c++')).toBe('C++')
    expect(displayLangFromClass('language-Python')).toBe('Python')
    expect(displayLangFromClass('language-nim')).toBe('nim')
  })

  it('클래스가 없거나 language- 토큰이 없으면 빈 문자열', () => {
    expect(displayLangFromClass('')).toBe('')
    expect(displayLangFromClass('nolang')).toBe('')
  })

  it('여러 토큰 중 첫 language- 토큰만 본다', () => {
    expect(displayLangFromClass('hljs language-ts extra')).toBe('TypeScript')
  })
})

describe('isMermaidInfo (F-258 A1)', () => {
  it('첫 단어가 mermaid 면 참(대소문자 무관)', () => {
    expect(isMermaidInfo('mermaid')).toBe(true)
    expect(isMermaidInfo('Mermaid extra')).toBe(true)
    expect(isMermaidInfo('MERMAID')).toBe(true)
  })

  it('다른 언어·빈 문자열은 거짓', () => {
    expect(isMermaidInfo('js')).toBe(false)
    expect(isMermaidInfo('')).toBe(false)
  })
})

// F-2122 1.2 표의 별칭 고정 사본
const ALIASES: Record<string, string[]> = {
  javascript: ['js', 'javascript', 'mjs', 'cjs'],
  jsx: ['jsx'],
  typescript: ['ts', 'typescript', 'mts', 'cts'],
  tsx: ['tsx'],
  css: ['css'],
  html: ['html', 'htm'],
  xml: ['xml', 'svg'],
  json: ['json', 'jsonc', 'json5'],
  yaml: ['yaml', 'yml'],
  python: ['py', 'python'],
  sql: ['sql'],
  shell: ['sh', 'bash', 'zsh', 'shell'],
}

describe('codeLangId (F-2123 A3)', () => {
  it('1.2 표의 별칭이 모두 그 id 로', () => {
    for (const [id, aliases] of Object.entries(ALIASES)) {
      for (const alias of aliases) expect(codeLangId(alias), alias).toBe(id)
    }
  })

  it('대소문자·뒤 단어·앞 공백을 displayLang 과 같이 자른다', () => {
    expect(codeLangId('TS title="a"')).toBe('typescript')
    expect(codeLangId('  Python')).toBe('python')
    expect(codeLangId('\tSH  extra words')).toBe('shell')
    expect(codeLangId('JSON5')).toBe('json')
  })

  it('표에 없는 말·마크다운·mermaid·빈 문자열·프로토타입 이름은 null', () => {
    for (const info of ['md', 'markdown', 'mermaid', 'kotlin', '', '   ', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(codeLangId(info), info).toBeNull()
    }
  })

  it('별칭과 정확히 같을 때만 — 접두사·접미사는 null', () => {
    expect(codeLangId('typescriptx')).toBeNull()
    expect(codeLangId('j')).toBeNull()
    expect(codeLangId('js,')).toBeNull()
  })
})

describe('codeLangIdsInHtml (F-2123 A3)', () => {
  it('문서에 처음 나온 순서로, 중복 없이', () => {
    const html =
      '<pre><code class="language-py">a</code></pre>\n' +
      '<pre><code class="language-ts">b</code></pre>\n' +
      '<pre><code class="language-python">c</code></pre>\n' +
      '<pre><code class="language-typescript">d</code></pre>\n' +
      '<pre><code class="language-sh">e</code></pre>\n'
    expect(codeLangIdsInHtml(html)).toEqual(['python', 'typescript', 'shell'])
  })

  it('언어 없는 <pre><code>·표에 없는 언어·mermaid div 는 잡히지 않는다', () => {
    const html =
      '<pre><code>plain</code></pre>\n' +
      '<pre><code class="language-kotlin">x</code></pre>\n' +
      '<div class="md-mermaid" data-mermaid-source="graph TD"></div>\n' +
      '<pre class="markdown-frontmatter-raw"><code>a: 1</code></pre>\n' +
      '<p><code>inline</code></p>\n'
    expect(codeLangIdsInHtml(html)).toEqual([])
  })

  it('data-source-line 이 class 앞에 있는 <code> 도 읽는다', () => {
    const html = '<pre><code data-source-line="3" class="language-sql">SELECT 1\n</code></pre>\n'
    expect(codeLangIdsInHtml(html)).toEqual(['sql'])
  })

  it('대문자 language- 토큰도 소문자로 맞춘다', () => {
    expect(codeLangIdsInHtml('<pre><code class="language-YAML">a: 1</code></pre>')).toEqual(['yaml'])
  })
})

describe('HIGHLIGHT_LANG_LABELS (F-2123 A3)', () => {
  it('고정 사본과 같다', () => {
    expect([...HIGHLIGHT_LANG_LABELS]).toEqual([
      'JavaScript',
      'TypeScript',
      'CSS',
      'HTML',
      'XML',
      'JSON',
      'YAML',
      'Python',
      'SQL',
      'Shell',
    ])
  })

  it('각 값은 그 언어 별칭 하나를 displayLang 에 넣은 결과와 같다', () => {
    const sample = ['js', 'ts', 'css', 'html', 'xml', 'json', 'yaml', 'py', 'sql', 'sh']
    expect(sample.map(displayLang)).toEqual([...HIGHLIGHT_LANG_LABELS])
    for (const alias of sample) expect(codeLangId(alias), alias).not.toBeNull()
  })
})

describe('codeLang.ts 는 순수 (F-2123 A8)', () => {
  it('import 가 하나도 없다', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../src/lib/codeLang.ts', import.meta.url)), 'utf-8')
    expect(src).not.toMatch(/^\s*import\b/m)
    expect(src).not.toMatch(/\bimport\s*\(/)
    expect(src).not.toMatch(/^\s*export\s+[^\n]*\bfrom\s+['"]/m)
  })
})
