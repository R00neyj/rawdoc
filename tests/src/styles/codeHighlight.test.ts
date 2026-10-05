import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const KINDS = ['keyword', 'string', 'comment', 'number', 'function', 'type', 'property', 'tag']
const read = (p: string) =>
  readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')

const css = read('../../../src/styles/codeHighlight.css')
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2].trim() }))

describe('codeHighlight.css (F-2124 3장)', () => {
  test('규칙 8개의 선택자가 .code-{종류} 와 같다', () => {
    expect(rules.map((r) => r.sel)).toEqual(KINDS.map((k) => `.code-${k}`))
  })

  test('각 선언은 color: var(--code-{종류}) 하나뿐이다', () => {
    for (const k of KINDS) {
      const r = rules.find((x) => x.sel === `.code-${k}`)
      expect(r?.body).toBe(`color: var(--code-${k});`)
    }
  })

  test('쓴 --code-* 이름이 tokens.css 첫 :root 에 있다', () => {
    const tokens = read('../../../src/styles/tokens.css')
    const root = /:root\s*\{([^}]*)\}/.exec(tokens)![1]
    for (const n of css.match(/--code-[a-z]+/g) ?? []) expect(root).toContain(`${n}:`)
  })

  test('hex 가 없다', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
