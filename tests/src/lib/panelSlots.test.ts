import { describe, expect, it } from 'vitest'
import { slotView, cycleSlotView, parseSlotViews, parseFlags, filterSlots, readPanelItems } from '../../../src/lib/panelSlots'

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

describe('filterSlots — 설정에서 끈 보기 빼기', () => {
  const slots = [
    { id: 'wide1', views: ['calendar', 'graph'] },
    { id: 'wide2', views: ['links'] },
    { id: 'wide3', views: ['todos'] },
  ]

  it('끈 보기는 칸 목록에서 빠지고, 보기가 하나도 없는 칸은 칸째 빠진다', () => {
    const off = new Set(['calendar', 'links'])
    expect(filterSlots(slots, (v) => !off.has(v))).toEqual([
      { id: 'wide1', views: ['graph'] },
      { id: 'wide3', views: ['todos'] },
    ])
  })

  it('저장된 마지막 보기가 꺼졌으면 남은 첫 보기', () => {
    const [first] = filterSlots(slots, (v) => v !== 'graph')
    expect(slotView(first, { wide1: 'graph' })).toBe('calendar')
  })

  it('전부 끄면 칸이 없다', () => {
    expect(filterSlots(slots, () => false)).toEqual([])
  })
})

describe('readPanelItems — 표시할 항목(기기별)', () => {
  it('저장이 없거나 깨졌으면 전부 켬', () => {
    const all = { calendar: true, dayDocs: true, graph: true, links: true, todos: true }
    expect(readPanelItems('')).toEqual(all)
    expect(readPanelItems('{')).toEqual(all)
  })

  it('저장한 항목만 덮고, 모르는 키·불리언이 아닌 값은 버린다', () => {
    expect(readPanelItems('{"links":false,"todos":"no","other":false}')).toEqual({ calendar: true, dayDocs: true, graph: true, links: false, todos: true })
  })
})

describe('parseFlags — 칸 접힘(기기별)', () => {
  it('JSON 객체의 불리언 값만 남긴다', () => {
    expect(parseFlags('{"wide1":true,"wide2":false,"x":1}')).toEqual({ wide1: true, wide2: false })
    expect(parseFlags('')).toEqual({})
    expect(parseFlags('[true]')).toEqual({})
  })
})
