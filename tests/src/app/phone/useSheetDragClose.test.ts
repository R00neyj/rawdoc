import { describe, expect, it } from 'vitest'
import { sheetDragShouldClose } from '../../../../src/app/phone/useSheetDragClose'

describe('sheetDragShouldClose', () => {
  it('키 큰 판은 80px 끌어야 닫힌다', () => {
    expect(sheetDragShouldClose(79, 600)).toBe(false)
    expect(sheetDragShouldClose(80, 600)).toBe(true)
  })

  it('낮은 판은 판 높이의 1/3 만 끌어도 닫힌다', () => {
    expect(sheetDragShouldClose(59, 180)).toBe(false)
    expect(sheetDragShouldClose(60, 180)).toBe(true)
  })

  it('위로 끌거나 안 끌면 닫히지 않는다', () => {
    expect(sheetDragShouldClose(0, 600)).toBe(false)
  })
})
