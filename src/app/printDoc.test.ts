// printDoc 단위 테스트 (specs/features/F-279.md 10장 A1·A2) — mermaid 는 vi.mock 한다(테스트 환경이 node, src/lib/mermaidRender.test.ts 와 같은 방식)
import { describe, it, expect, vi } from 'vitest'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}))

describe('printTitle (F-279 A1)', () => {
  it('비었거나 공백뿐이면 제목 없는 문서, 아니면 그대로', async () => {
    const { printTitle } = await import('./printDoc')
    expect(printTitle('')).toBe('제목 없는 문서')
    expect(printTitle('   ')).toBe('제목 없는 문서')
    expect(printTitle('회의록')).toBe('회의록')
  })
})

describe('printDoc root 없음 방어 (F-279 A2)', () => {
  it('root 가 null 이면 예외 없이 끝나고 print 가 불리지 않는다', async () => {
    const { printDoc } = await import('./printDoc')
    const print = vi.fn()
    await expect(printDoc({ root: null, html: '', title: '', print })).resolves.toBeUndefined()
    expect(print).not.toHaveBeenCalled()
  })
})
