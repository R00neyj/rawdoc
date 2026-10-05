// F-2126 A1~A4
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdown } from '../../../src/viewer/renderMarkdown'

type Override = ((id: string) => Promise<unknown>) | null
const state: { override: Override; calls: string[] } = { override: null, calls: [] }

vi.mock('../../../src/lib/codeParsers', async () => {
  const actual = await vi.importActual<typeof import('../../../src/lib/codeParsers')>('../../../src/lib/codeParsers')
  return {
    ...actual,
    loadCodeGrammar: (id: string) => {
      state.calls.push(id)
      return state.override ? state.override(id) : actual.loadCodeGrammar(id as never)
    },
  }
})

async function load() {
  vi.resetModules()
  return import('../../../src/viewer/useCodeHighlight')
}

const TS_PY = renderMarkdown('```ts\nconst a = 1\n```\n\n```py\ndef f(): pass\n```\n')

function pyBlock(html: string) {
  return html.slice(html.indexOf('<pre><code class="language-py"'))
}

async function realLoad(id: string) {
  const actual = await vi.importActual<typeof import('../../../src/lib/codeParsers')>('../../../src/lib/codeParsers')
  return actual.loadCodeGrammar(id as never)
}

beforeEach(() => {
  state.override = null
  state.calls = []
})

describe('F-2126 highlightHtmlWhenReady', () => {
  it('A1 언어 없는 html 은 같은 값이고 문법을 부르지 않는다', async () => {
    const { highlightHtmlWhenReady } = await load()
    const inputs = [
      '<p>x</p>',
      '<pre><code>plain</code></pre>',
      '<pre><code class="language-kotlin">val a = 1</code></pre>',
    ]
    for (const html of inputs) expect(await highlightHtmlWhenReady(html)).toBe(html)
    expect(state.calls).toEqual([])
  })

  it('A2 칠한 결과는 앞부분이 그대로고 글자가 같다', async () => {
    const { highlightHtmlWhenReady } = await load()
    const code = 'const a = "<b>" // 끝 & '
    const html = renderMarkdown('```ts\n' + code + '\n```')
    const out = await highlightHtmlWhenReady(html)
    expect(out).toContain('class="code-keyword"')
    expect(out).toContain('<pre><code class="language-ts">')
    const text = out
      .replace(/<[^>]*>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
    expect(text).toContain(code)
  })

  it('A3 python 로드가 null 이거나 거부여도 ts 만 칠하고 거부하지 않는다', async () => {
    for (const fail of [() => Promise.resolve(null), () => Promise.reject(new Error('x'))]) {
      const { highlightHtmlWhenReady } = await load()
      state.override = (id) => (id === 'python' ? fail() : realLoad(id))
      const out = await highlightHtmlWhenReady(TS_PY)
      expect(out).toContain('class="code-keyword"')
      expect(pyBlock(out)).toBe(pyBlock(TS_PY))
    }
  })

  it('A4 python 로드가 끝나지 않으면 waitMs 뒤 ts 만 칠하고 이행한다', async () => {
    const { highlightHtmlWhenReady } = await load()
    state.override = (id) => (id === 'python' ? new Promise(() => {}) : realLoad(id))
    const t0 = Date.now()
    const out = await highlightHtmlWhenReady(TS_PY, 50)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(out).toContain('class="code-keyword"')
    expect(pyBlock(out)).toBe(pyBlock(TS_PY))
  })
})
