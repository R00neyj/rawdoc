import { describe, expect, it } from 'vitest'
import { slotView, cycleSlotView, parseSlotViews } from '../../../src/lib/panelSlots'

const slot = { id: 'phoneTop', views: ['calendar', 'links'] as const }

describe('slotView — 칸의 지금 보기', () => {
  it('저장한 보기가 그 칸 목록에 있으면 그 보기', () => {
    expect(slotView(slot, { phoneTop: 'links' })).toBe('links')
  })

  it('저장이 없거나 목록에 없는 값이면 첫 보기', () => {
    expect(slotView(slot, {})).toBe('calendar')
    expect(slotView(slot, { phoneTop: 'graph' })).toBe('calendar')
  })
})

describe('cycleSlotView — ‹ › 넘기기', () => {
  it('다음·이전으로 가고 끝에서 돌아 간다', () => {
    expect(cycleSlotView(slot, 'calendar', 1)).toBe('links')
    expect(cycleSlotView(slot, 'links', 1)).toBe('calendar')
    expect(cycleSlotView(slot, 'calendar', -1)).toBe('links')
  })

  it('보기가 하나뿐이면 그대로', () => {
    expect(cycleSlotView({ id: 'wide1', views: ['calendar'] }, 'calendar', 1)).toBe('calendar')
  })
})

describe('parseSlotViews — 기기별 저장값', () => {
  it('JSON 객체의 문자열 값만 남긴다', () => {
    expect(parseSlotViews('{"phoneTop":"links","bad":3}')).toEqual({ phoneTop: 'links' })
  })

  it('깨진 값·배열·빈 문자열은 빈 객체', () => {
    expect(parseSlotViews('')).toEqual({})
    expect(parseSlotViews('{')).toEqual({})
    expect(parseSlotViews('["links"]')).toEqual({})
  })

  it('JSON 으로 저장한 값을 다시 읽으면 같은 값', () => {
    expect(parseSlotViews(JSON.stringify({ phoneTop: 'links', wide1: 'calendar' }))).toEqual({ phoneTop: 'links', wide1: 'calendar' })
  })
})
