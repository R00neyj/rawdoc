// renderMermaid 단위 테스트 (specs/features/F-258.md 3장 A1) — mermaid 모듈을 mock 한다
import { describe, it, expect, vi, beforeEach } from 'vitest'

const initialize = vi.fn()
const render = vi.fn()

vi.mock('mermaid', () => ({
  default: {
    initialize,
    render,
  },
}))

describe('renderMermaid (F-258 A1)', () => {
  beforeEach(() => {
    vi.resetModules()
    initialize.mockClear()
    render.mockClear()
  })

  it('성공하면 {svg} 를 반환한다', async () => {
    render.mockResolvedValue({ svg: '<svg>ok</svg>' })
    const { renderMermaid } = await import('./mermaidRender')
    const result = await renderMermaid('graph TD; A-->B')
    expect(result).toEqual({ svg: '<svg>ok</svg>' })
  })

  it('예외를 던지면 {error: message} 를 반환한다', async () => {
    render.mockRejectedValue(new Error('문법이 잘못됐습니다'))
    const { renderMermaid } = await import('./mermaidRender')
    const result = await renderMermaid('nope')
    expect(result).toEqual({ error: '문법이 잘못됐습니다' })
  })

  it('예외에 message 가 없으면 고정 문구를 쓴다', async () => {
    render.mockRejectedValue({})
    const { renderMermaid } = await import('./mermaidRender')
    const result = await renderMermaid('nope')
    expect(result).toEqual({ error: 'Mermaid 다이어그램을 그릴 수 없습니다' })
  })

  it('initialize 는 모듈이 로드될 때 1회만 호출된다(여러 번 렌더링해도)', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('./mermaidRender')
    await renderMermaid('a')
    await renderMermaid('b')
    await renderMermaid('c')
    expect(initialize).toHaveBeenCalledTimes(1)
    expect(initialize).toHaveBeenCalledWith({ startOnLoad: false })
  })

  it('호출마다 다른 id 를 mermaid.render 에 넘긴다', async () => {
    render.mockResolvedValue({ svg: '<svg/>' })
    const { renderMermaid } = await import('./mermaidRender')
    await renderMermaid('a')
    await renderMermaid('a')
    const idsUsed = render.mock.calls.map((call) => call[0])
    expect(new Set(idsUsed).size).toBe(idsUsed.length)
  })
})
