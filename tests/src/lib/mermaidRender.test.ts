// renderMermaid 단위 테스트 (specs/features/F-258.md 3장 A1, F-260.md 3장 A1) — mermaid 모듈을 mock 한다
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const initialize = vi.fn()
const render = vi.fn()

vi.mock('mermaid', () => ({
  default: {
    initialize,
    render,
  },
}))

const WHITE_THEME = 'white'

describe('renderMermaid (F-258 A1)', () => {
  beforeEach(() => {
    vi.resetModules()
    initialize.mockClear()
    render.mockClear()
  })

  it('성공하면 {svg} 를 반환한다', async () => {
    render.mockResolvedValue({ svg: '<svg>ok</svg>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    const result = await renderMermaid('graph TD; A-->B', WHITE_THEME)
    expect(result).toEqual({ svg: '<svg>ok</svg>' })
  })

  it('예외를 던지면 {error: message} 를 반환한다', async () => {
    render.mockRejectedValue(new Error('문법이 잘못됐습니다'))
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    const result = await renderMermaid('nope', WHITE_THEME)
    expect(result).toEqual({ error: '문법이 잘못됐습니다' })
  })

  it('예외에 message 가 없으면 고정 문구를 쓴다', async () => {
    render.mockRejectedValue({})
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    const result = await renderMermaid('nope', WHITE_THEME)
    expect(result).toEqual({ error: 'Mermaid 다이어그램을 그릴 수 없습니다' })
  })

  it('같은 테마로 여러 번 렌더링해도 initialize 는 1회만 호출된다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', WHITE_THEME)
    await renderMermaid('b', WHITE_THEME)
    await renderMermaid('c', WHITE_THEME)
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('호출마다 다른 id 를 mermaid.render 에 넘긴다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', WHITE_THEME)
    await renderMermaid('a', WHITE_THEME)
    const idsUsed = render.mock.calls.map((call) => call[0])
    expect(new Set(idsUsed).size).toBe(idsUsed.length)
  })
})

describe('renderMermaid — 앱 테마 → mermaid 테마 매핑 (F-260 A1)', () => {
  beforeEach(() => {
    vi.resetModules()
    initialize.mockClear()
    render.mockClear()
  })

  it('appTheme=dark 면 mermaid.initialize 를 theme:dark 로 부른다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', 'dark')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith({ startOnLoad: false, theme: 'dark' })
  })

  it.each(['white', 'sepia', '모르는값'])('appTheme=%s 면 mermaid 기본(default) 테마로 부른다', async (appTheme) => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', appTheme)
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith({ startOnLoad: false, theme: 'default' })
  })

  it('직전 호출과 매핑 결과가 같으면(white → sepia) initialize 를 다시 호출하지 않는다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', 'white')
    await renderMermaid('b', 'sepia') // 둘 다 'default' 로 매핑되는 테마
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('매핑 결과가 바뀌면(white → dark) initialize 를 다시 호출한다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', 'white')
    await renderMermaid('b', 'dark')
    expect(initialize).toHaveBeenCalledTimes(2)
    expect(initialize).toHaveBeenNthCalledWith(1, { startOnLoad: false, theme: 'default' })
    expect(initialize).toHaveBeenNthCalledWith(2, { startOnLoad: false, theme: 'dark' })
  })
})

describe('renderMermaid — 임시 컨테이너 (미리보기 열 때 문서가 순간 늘어나던 것)', () => {
  type FakeEl = { style: { cssText: string }; remove: () => void; removed: boolean }
  let appended: FakeEl[]

  beforeEach(() => {
    vi.resetModules()
    initialize.mockClear()
    render.mockClear()
    appended = []
    vi.stubGlobal('document', {
      createElement: () => {
        const el: FakeEl = { style: { cssText: '' }, removed: false, remove: () => { el.removed = true } }
        return el
      },
      body: { append: (el: FakeEl) => appended.push(el) },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('화면 밖 fixed 컨테이너를 mermaid.render 에 넘기고, 끝나면 떼어 낸다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('a', 'white')
    expect(appended).toHaveLength(1)
    expect(render.mock.calls[0][2]).toBe(appended[0])
    expect(appended[0].style.cssText).toContain('position:fixed')
    expect(appended[0].removed).toBe(true)
  })

  it('렌더가 실패해도 컨테이너를 떼어 낸다', async () => {
    render.mockRejectedValue(new Error('문법 오류'))
    const { renderMermaid } = await import('../../../src/lib/mermaidRender')
    await renderMermaid('nope', 'white')
    expect(appended[0].removed).toBe(true)
  })
})
