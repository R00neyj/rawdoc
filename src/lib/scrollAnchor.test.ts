// F-295 6장 U1~U10 — 순수 함수만 다룬다. DOM 없이 node 환경에서 돈다
import { describe, expect, it } from 'vitest'
import { anchorAtTop, anchorInBlock, ratioInBlock, topForAnchor } from './scrollAnchor'
import type { LineBlock } from './scrollAnchor'

describe('anchorInBlock', () => {
  it('U1 — 절반 지점, ratio 는 0~1 로 잘린다', () => {
    expect(anchorInBlock(10, 14, 0.5)).toBe(12)
    expect(anchorInBlock(10, 14, -1)).toBe(10)
    expect(anchorInBlock(10, 14, 2)).toBe(14)
  })

  it('U2 — endLine <= startLine 이면 폭을 1 로 본다', () => {
    expect(anchorInBlock(10, 10, 0.5)).toBe(10.5)
  })
})

describe('ratioInBlock', () => {
  it('U3 — anchorInBlock 의 역', () => {
    const cases: [number, number, number][] = [
      [1, 5, 0],
      [1, 5, 0.25],
      [1, 5, 0.5],
      [1, 5, 1],
      [10, 14, 0.5],
      [100, 101, 0.7],
    ]
    for (const [s, e, r] of cases) {
      expect(ratioInBlock(s, e, anchorInBlock(s, e, r))).toBeCloseTo(r, 9)
    }
  })
})

describe('anchorAtTop / topForAnchor 빈 배열', () => {
  it('U4', () => {
    expect(anchorAtTop([], 0)).toBeNull()
    expect(topForAnchor([], 1)).toBeNull()
  })
})

describe('anchorAtTop', () => {
  it('U5 — top 이 첫 블록보다 위면 첫 블록의 line', () => {
    const blocks: LineBlock[] = [
      { line: 5, top: 100, bottom: 150 },
      { line: 9, top: 300, bottom: 350 },
    ]
    expect(anchorAtTop(blocks, 50)).toBe(5)
  })

  it('U6 — 블록 안 절반 지점 보간', () => {
    const blocks: LineBlock[] = [
      { line: 5, top: 100, bottom: 150 },
      { line: 9, top: 300, bottom: 350 },
    ]
    expect(anchorAtTop(blocks, 200)).toBe(7)
  })
})

describe('topForAnchor', () => {
  const blocks: LineBlock[] = [
    { line: 5, top: 100, bottom: 150 },
    { line: 9, top: 300, bottom: 350 },
  ]

  it('U7 — anchor 가 첫 블록보다 작으면 0 (첫 블록의 top 이 아니다)', () => {
    expect(topForAnchor(blocks, 1)).toBe(0)
  })

  it('U8 — U6 의 역', () => {
    expect(topForAnchor(blocks, 7)).toBe(200)
  })

  it('U9 — 마지막 블록은 자기 bottom 을 끝으로 쓴다', () => {
    // 마지막 블록 [line 9, top 300, bottom 350], anchor 9.5 → 절반 지점 = 325
    expect(topForAnchor(blocks, 9.5)).toBe(325)
  })
})

describe('왕복', () => {
  it('U10 — anchorAtTop ↔ topForAnchor 오차 0.5px 이내', () => {
    const blocks: LineBlock[] = [
      { line: 1, top: 0, bottom: 40 },
      { line: 3, top: 40, bottom: 120 },
      { line: 10, top: 120, bottom: 300 },
      { line: 25, top: 300, bottom: 900 },
    ]
    for (const top of [0, 10, 39, 40, 75, 119, 120, 250, 300, 600, 899]) {
      const anchor = anchorAtTop(blocks, top)
      expect(anchor).not.toBeNull()
      const back = topForAnchor(blocks, anchor as number)
      expect(Math.abs((back as number) - top)).toBeLessThanOrEqual(0.5)
    }
  })
})
