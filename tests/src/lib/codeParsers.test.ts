import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

async function freshModule() {
  vi.resetModules()
  return import('../../../src/lib/codeParsers')
}

describe('loadCodeGrammar (F-2123 A6)', () => {
  it('12개 id 모두 CodeGrammar 를 내고 parser.parse 가 된다, sql·shell 만 cmLanguage', async () => {
    const { loadCodeGrammar } = await freshModule()
    for (const id of IDS) {
      const grammar = await loadCodeGrammar(id)
      expect(grammar, id).not.toBeNull()
      const tree = grammar!.parser.parse('a b\n')
      expect(tree.length, id).toBe(4)
      if (id === 'sql' || id === 'shell') expect(grammar!.cmLanguage, id).toBeDefined()
      else expect(grammar!.cmLanguage, id).toBeUndefined()
    }
  })

  it('같은 id 두 번 → 같은 객체, 끝난 뒤 loadedCodeGrammar 가 그 객체', async () => {
    const { loadCodeGrammar, loadedCodeGrammar } = await freshModule()
    expect(loadedCodeGrammar('typescript')).toBeNull()
    const a = await loadCodeGrammar('typescript')
    const b = await loadCodeGrammar('typescript')
    expect(a).not.toBeNull()
    expect(b).toBe(a)
    expect(loadedCodeGrammar('typescript')).toBe(a)
    expect(loadedCodeGrammar('javascript')).toBeNull()
  })

  it('동시 두 번 → 같은 객체, 끝나기 전 loadedCodeGrammar 는 null', async () => {
    const { loadCodeGrammar, loadedCodeGrammar } = await freshModule()
    const p1 = loadCodeGrammar('python')
    const p2 = loadCodeGrammar('python')
    expect(loadedCodeGrammar('python')).toBeNull()
    const [a, b] = await Promise.all([p1, p2])
    expect(a).not.toBeNull()
    expect(b).toBe(a)
    expect(loadedCodeGrammar('python')).toBe(a)
  })

  it('dialect 가 다른 id 는 다른 파서', async () => {
    const { loadCodeGrammar } = await freshModule()
    const parsers = await Promise.all(
      (['javascript', 'jsx', 'typescript', 'tsx'] as const).map(async (id) => (await loadCodeGrammar(id))!.parser),
    )
    expect(new Set(parsers).size).toBe(4)
  })

  it('실패하면 null, 그 뒤 모듈이 살아나도 다시 시도하지 않는다, 다른 id 는 그대로', async () => {
    // 처음 한 번만 던지게 해 "불러오기 실패" 를 흉내 낸다 (F-2123 N8)
    let failNext = true
    vi.doMock('@lezer/yaml', async (importOriginal) => {
      if (failNext) {
        failNext = false
        throw new Error('오프라인')
      }
      return importOriginal()
    })
    const { loadCodeGrammar, loadedCodeGrammar } = await freshModule()
    expect(await loadCodeGrammar('yaml')).toBeNull()
    expect(failNext).toBe(false)
    expect(loadedCodeGrammar('yaml')).toBeNull()

    const direct = await import('@lezer/yaml')
    expect(direct.parser).toBeDefined()

    expect(await loadCodeGrammar('yaml')).toBeNull()
    expect(loadedCodeGrammar('yaml')).toBeNull()
    expect(await loadCodeGrammar('json')).not.toBeNull()
  })
})

describe('codeParsers.ts 정적 import (F-2123 A8)', () => {
  it('정적 import 는 import type 뿐', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../src/lib/codeParsers.ts', import.meta.url)), 'utf-8')
    const staticImports = src.split('\n').filter((line) => /^\s*import\s/.test(line))
    expect(staticImports.length).toBeGreaterThan(0)
    for (const line of staticImports) expect(line).toMatch(/^\s*import\s+type\s/)
    expect(src).not.toMatch(/^\s*export\s+[^\n]*\bfrom\s+['"]/m)
  })
})
