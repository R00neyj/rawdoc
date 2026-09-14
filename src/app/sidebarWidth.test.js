import { describe, it, expect } from 'vitest'
import {
  maxSidebarWidth,
  clampSidebarWidth,
  resolveStoredSidebarWidth,
  overlaySidebarWidth,
  DEFAULT_SIDEBAR_WIDTH,
} from './sidebarWidth.js'

describe('maxSidebarWidth', () => {
  it('창 1024px: min(480, 1024-560) = 464', () => {
    expect(maxSidebarWidth(1024)).toBe(464)
  })

  it('창 1600px: min(480, 1600-560) = 480 (480 상한)', () => {
    expect(maxSidebarWidth(1600)).toBe(480)
  })
})

describe('clampSidebarWidth', () => {
  it('최소 200px 아래는 200으로', () => {
    expect(clampSidebarWidth(24, 1600)).toBe(200)
  })

  it('창 1600px 에서 600 은 480 으로 잘린다', () => {
    expect(clampSidebarWidth(824, 1600)).toBe(480)
  })

  it('창 1024px 에서 최대는 464', () => {
    expect(clampSidebarWidth(600, 1024)).toBe(464)
  })

  it('범위 안이면 그대로', () => {
    expect(clampSidebarWidth(324, 1600)).toBe(324)
  })
})

describe('resolveStoredSidebarWidth', () => {
  it('없음(null) 이면 기본값', () => {
    expect(resolveStoredSidebarWidth(null)).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('문자(숫자 아님) 면 기본값', () => {
    expect(resolveStoredSidebarWidth('abc')).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('절대 범위(200~480) 밖이면 기본값', () => {
    expect(resolveStoredSidebarWidth('100')).toBe(DEFAULT_SIDEBAR_WIDTH)
    expect(resolveStoredSidebarWidth('900')).toBe(DEFAULT_SIDEBAR_WIDTH)
  })

  it('범위 안 정수 문자열은 정수로 해석', () => {
    expect(resolveStoredSidebarWidth('300')).toBe(300)
  })
})

describe('overlaySidebarWidth', () => {
  it('저장 너비가 창 폭 - 48 보다 작으면 그대로', () => {
    expect(overlaySidebarWidth(224, 900)).toBe(224)
  })

  it('저장 너비가 창 폭 - 48 보다 크면 줄인다', () => {
    expect(overlaySidebarWidth(480, 500)).toBe(452)
  })
})
