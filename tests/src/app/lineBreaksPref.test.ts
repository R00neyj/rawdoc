// 한 번 줄바꿈 설정 (small 2026-10-22)
import { describe, it, expect, beforeEach, vi } from 'vitest'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}

// 모듈을 불러올 때 저장값을 읽으므로 저장소를 바꾼 뒤 새로 불러야 한다 — 정적 import 로는 안 된다
async function load(initial: Record<string, string> = {}) {
  globalThis.localStorage = memoryStorage(initial)
  vi.resetModules()
  const pref = await import('../../../src/app/lineBreaksPref')
  const { renderMarkdown } = await import('../../../src/viewer/renderMarkdown')
  return { ...pref, renderMarkdown }
}

beforeEach(() => {
  vi.resetModules()
})

describe('lineBreaksPref', () => {
  it('저장값이 없으면 켬 — 한 번 줄바꿈도 <br> 로 그린다', async () => {
    const { lineBreaksOn, renderMarkdown } = await load()
    expect(lineBreaksOn()).toBe(true)
    expect(renderMarkdown('장보기\n우유')).toContain('장보기<br>\n우유')
  })

  it("저장값 'off' 면 마크다운 표준으로 그린다", async () => {
    const { lineBreaksOn, renderMarkdown } = await load({ 'md.lineBreaks': 'off' })
    expect(lineBreaksOn()).toBe(false)
    expect(renderMarkdown('장보기\n우유')).toBe('<p>장보기\n우유</p>\n')
  })

  it('모르는 저장값은 켬으로 본다', async () => {
    const { lineBreaksOn } = await load({ 'md.lineBreaks': 'x' })
    expect(lineBreaksOn()).toBe(true)
  })

  it('바꾸면 저장하고, 구독자에게 알리고, 다음 렌더부터 따른다', async () => {
    const { changeLineBreaks, lineBreaksOn, subscribeLineBreaks, renderMarkdown } = await load()
    const listener = vi.fn()
    const unsubscribe = subscribeLineBreaks(listener)
    changeLineBreaks(false)
    expect(lineBreaksOn()).toBe(false)
    expect(localStorage.getItem('md.lineBreaks')).toBe('off')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(renderMarkdown('a\nb')).not.toContain('<br>')
    changeLineBreaks(true)
    expect(localStorage.getItem('md.lineBreaks')).toBe('on')
    expect(renderMarkdown('a\nb')).toContain('<br>')
    unsubscribe()
    changeLineBreaks(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
