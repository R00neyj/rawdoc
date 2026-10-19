// printDoc 단위 테스트 (specs/features/F-279.md 10장 A1·A2) — 테스트 환경이 node 라 강조·그림 채우기는 vi.mock 한다
import { afterEach, describe, it, expect, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ fillImages: vi.fn(async () => [] as string[]) }))

vi.mock('../../../src/viewer/useCodeHighlight', () => ({ highlightHtmlWhenReady: async (html: string) => html }))
vi.mock('../../../src/viewer/fillMarkdownAssets', () => ({ fillAttachmentImages: hoisted.fillImages, fillMermaidBlocks: async () => {} }))

describe('printTitle (F-279 A1)', () => {
  it('비었거나 공백뿐이면 제목 없는 문서, 아니면 그대로', async () => {
    const { printTitle } = await import('../../../src/app/printDoc')
    expect(printTitle('')).toBe('제목 없는 문서')
    expect(printTitle('   ')).toBe('제목 없는 문서')
    expect(printTitle('회의록')).toBe('회의록')
  })
})

describe('printDoc root 없음 방어 (F-279 A2)', () => {
  it('root 가 null 이면 예외 없이 끝나고 print 가 불리지 않는다', async () => {
    const { printDoc } = await import('../../../src/app/printDoc')
    const print = vi.fn()
    await expect(printDoc({ root: null, html: '', title: '', print })).resolves.toBeUndefined()
    expect(print).not.toHaveBeenCalled()
  })
})

// 앞 인쇄가 그림을 기다리는 사이 새 인쇄가 같은 root 를 채우면, 앞 인쇄가 뒤늦게 남의 내용으로 print 를 불렀다
describe('printDoc 동시 인쇄', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('새 인쇄가 시작되면 앞 인쇄는 print 를 부르지 않고 제 그림 주소를 놓는다', async () => {
    const attrs = new Map<string, string>()
    vi.stubGlobal('document', {
      title: '앱',
      createElement: () => ({ setAttribute: () => {} }),
      documentElement: {
        getAttribute: (k: string) => attrs.get(k) ?? null,
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
      fonts: { ready: Promise.resolve() },
    })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const root = { replaceChildren: () => {}, append: () => {}, offsetHeight: 0 } as unknown as HTMLElement
    const firstImages = Promise.withResolvers<string[]>()
    hoisted.fillImages.mockReturnValueOnce(firstImages.promise).mockResolvedValueOnce([])
    const { printDoc } = await import('../../../src/app/printDoc')
    const printA = vi.fn()
    const printB = vi.fn()
    const a = printDoc({ root, html: 'a', title: 'A', print: printA })
    await vi.waitFor(() => expect(hoisted.fillImages).toHaveBeenCalledTimes(1))
    await printDoc({ root, html: 'b', title: 'B', print: printB })
    firstImages.resolve(['blob:a'])
    await a
    expect(printB).toHaveBeenCalledTimes(1)
    expect(printA).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:a')
  })
})
