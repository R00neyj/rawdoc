import { afterEach, describe, expect, it, vi } from 'vitest'
import { hasScrollableRightAncestor } from '../../../src/app/useEdgeSwipe'

type Box = { scrollWidth: number; clientWidth: number; scrollLeft: number; overflowX: string }

function chain(...boxes: Box[]): Element {
  let parent: Element | null = null
  for (const box of [...boxes].reverse()) parent = { ...box, parentElement: parent } as unknown as Element
  return parent as Element
}

describe('hasScrollableRightAncestor', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('몇 px 넘쳐도 손가락으로 못 미는 overflow visible·hidden 조상은 양보하지 않는다', () => {
    vi.stubGlobal('getComputedStyle', (el: Box) => ({ overflowX: el.overflowX }))
    const line = { scrollWidth: 300, clientWidth: 300, scrollLeft: 0, overflowX: 'visible' }
    expect(hasScrollableRightAncestor(chain(line, { scrollWidth: 350, clientWidth: 344, scrollLeft: 0, overflowX: 'visible' }))).toBe(false)
    expect(hasScrollableRightAncestor(chain(line, { scrollWidth: 500, clientWidth: 390, scrollLeft: 0, overflowX: 'hidden' }))).toBe(false)
  })

  it('오른쪽으로 더 갈 수 있는 가로 스크롤러 안이면 양보하고, 끝까지 밀린 스크롤러면 양보하지 않는다', () => {
    vi.stubGlobal('getComputedStyle', (el: Box) => ({ overflowX: el.overflowX }))
    const cell = { scrollWidth: 80, clientWidth: 80, scrollLeft: 0, overflowX: 'visible' }
    expect(hasScrollableRightAncestor(chain(cell, { scrollWidth: 650, clientWidth: 344, scrollLeft: 0, overflowX: 'auto' }))).toBe(true)
    expect(hasScrollableRightAncestor(chain(cell, { scrollWidth: 650, clientWidth: 344, scrollLeft: 306, overflowX: 'scroll' }))).toBe(false)
  })
})
