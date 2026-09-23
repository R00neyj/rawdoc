// specs/features/F-2010.md 12.1 U1~U9, specs/features/F-2013.md 13.1 U10~U16
import { describe, expect, it } from 'vitest'
import {
  MAP_EDGE_BASE,
  MAP_EDGE_CENTER,
  MAP_EDGE_FOCUS,
  MAP_FOCUS_FADE_MS,
  combineMix,
  edgeClass,
  fillNodeFocus,
  stepFade,
} from './mapFocus'

describe('fillNodeFocus', () => {
  it('U1 호버가 없으면 false 고 배열이 전부 0 이다', () => {
    const out = new Uint8Array(5)
    expect(fillNodeFocus(-1, [], out)).toBe(false)
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0])
  })

  it('U2 호버한 노드와 이웃에 1 을 세운다', () => {
    const out = new Uint8Array(8)
    expect(fillNodeFocus(3, [1, 5], out)).toBe(true)
    expect(Array.from(out)).toEqual([0, 1, 0, 1, 0, 1, 0, 0])
  })

  it('U3 직전 자취가 남지 않는다', () => {
    const out = new Uint8Array(8)
    fillNodeFocus(3, [1, 5], out)
    expect(fillNodeFocus(0, [], out)).toBe(true)
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('U4 자기 자신·중복·범위 밖을 흘린다', () => {
    const out = new Uint8Array(4)
    expect(fillNodeFocus(2, [2, 2, 7, -1, 99], out)).toBe(true)
    expect(Array.from(out)).toEqual([0, 0, 1, 0])
  })

  it('U5 정수가 아니면 아무것도 세우지 않는다', () => {
    const out = new Uint8Array(4)
    expect(fillNodeFocus(1.5, [], out)).toBe(false)
    expect(Array.from(out)).toEqual([0, 0, 0, 0])
    out.fill(1)
    expect(fillNodeFocus(NaN, [], out)).toBe(false)
    expect(Array.from(out)).toEqual([0, 0, 0, 0])
  })
})

describe('edgeClass', () => {
  it('U6 호버한 노드에 닿으면 방향을 안 가린다', () => {
    expect(edgeClass(3, 9, 3, 5)).toBe(MAP_EDGE_FOCUS)
    expect(edgeClass(9, 3, 3, 5)).toBe(MAP_EDGE_FOCUS)
  })

  it('U7 호버가 현재 문서를 이긴다', () => {
    expect(edgeClass(5, 9, 3, 5)).toBe(MAP_EDGE_CENTER)
    expect(edgeClass(3, 5, 3, 5)).toBe(MAP_EDGE_FOCUS)
    expect(edgeClass(7, 9, 3, 5)).toBe(MAP_EDGE_BASE)
  })

  it('U8 호버가 없을 때는 현재 문서만 본다', () => {
    expect(edgeClass(5, 9, -1, 5)).toBe(MAP_EDGE_CENTER)
    expect(edgeClass(5, 9, -1, -1)).toBe(MAP_EDGE_BASE)
  })
})

describe('combineMix', () => {
  it('U9 깊이 섞기 위에 흐리기를 겹친다', () => {
    expect(combineMix(0, 0)).toBe(0)
    expect(combineMix(0.65, 0)).toBeCloseTo(0.65, 10)
    expect(combineMix(0, 0.85)).toBeCloseTo(0.85, 10)
    expect(combineMix(0.65, 0.85)).toBeCloseTo(0.9475, 10)
    expect(combineMix(-1, 2)).toBe(1)
    expect(combineMix(NaN, 0.85)).toBeCloseTo(0.85, 10)
  })
})

describe('stepFade', () => {
  it('U10 절반쯤 간다', () => {
    expect(stepFade(0, 1, 90, 180)).toBeCloseTo(0.5, 10)
    expect(stepFade(0.5, 1, 45, 180)).toBeCloseTo(0.75, 10)
  })

  it('U11 목표를 지나치지 않는다', () => {
    expect(stepFade(0.9, 1, 1000, 180)).toBe(1)
    expect(stepFade(0.1, 0, 1000, 180)).toBe(0)
  })

  it('U12 되돌아갈 때 같은 진행도를 되짚는다', () => {
    expect(stepFade(0.6, 0, 90, 180)).toBeCloseTo(0.1, 10)
  })

  it('U13 시간이 안 흘렀으면 그대로', () => {
    expect(stepFade(0.4, 1, 0, 180)).toBe(0.4)
    expect(stepFade(0.4, 1, -5, 180)).toBe(0.4)
    expect(stepFade(0.4, 1, NaN, 180)).toBe(0.4)
  })

  it('U14 길이가 0 이면 즉시', () => {
    expect(stepFade(0, 1, 16, 0)).toBe(1)
    expect(stepFade(1, 0, 16, -1)).toBe(0)
    expect(stepFade(1, 0, 16, NaN)).toBe(0)
  })

  it('U15 망가진 상태에서 벗어난다', () => {
    expect(stepFade(NaN, 1, 16, 180)).toBe(1)
    const result = stepFade(2, 0, 0, 180)
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })

  it('U16 MAP_FOCUS_FADE_MS 가 있다', () => {
    expect(MAP_FOCUS_FADE_MS).toBe(180)
    expect(MAP_FOCUS_FADE_MS).toBeGreaterThanOrEqual(150)
    expect(MAP_FOCUS_FADE_MS).toBeLessThanOrEqual(200)
  })
})
