// 휴대폰 폭 앱 틀 맞추기 판정 (specs/features/F-2084.md 3.3, A1)
import { describe, expect, it } from 'vitest'
import { fitToVisualViewport } from '../../../src/app/viewportFit'

describe('F-2084 A1 fitToVisualViewport', () => {
  it('(a) 키보드 없음 — 보이는 영역 = 창', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 844, vvOffsetTop: 0, vvScale: 1 })).toEqual({ height: 844, top: 0 })
  })

  it('(b) iOS 키보드 + 밀림 — 반올림 없이 그대로', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 508.5, vvOffsetTop: 120, vvScale: 1 })).toEqual({ height: 508.5, top: 120 })
  })

  it('(c) 핀치 확대 중이면 null', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 400, vvOffsetTop: 50, vvScale: 1.5 })).toBeNull()
  })

  it('(d) scale 1.005 는 확대로 보지 않는다', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 600, vvOffsetTop: 10, vvScale: 1.005 })).toEqual({ height: 600, top: 10 })
  })

  it('(e) vvHeight 0 이면 null', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 0, vvOffsetTop: 0, vvScale: 1 })).toBeNull()
  })

  it('(f) 음수 offsetTop 은 0', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 600, vvOffsetTop: -3, vvScale: 1 })).toEqual({ height: 600, top: 0 })
  })

  it('(g) 보이는 영역이 창보다 크면 창 높이', () => {
    expect(fitToVisualViewport({ innerHeight: 844, vvHeight: 900, vvOffsetTop: 0, vvScale: 1 })).toEqual({ height: 844, top: 0 })
  })
})
