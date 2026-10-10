import { describe, expect, it } from 'vitest'
import {
  monthWeeks,
  shiftMonth,
  calendarDocTitle,
  calendarDocIndex,
  resolveCalendarFolder,
  calendarDocDate,
  dayKey,
} from '../../../src/lib/calendar'

describe('monthWeeks — 일요일 시작 월 격자', () => {
  it('2026년 10월은 목요일 1일, 5주, 앞 4칸은 9월 27~30일', () => {
    const weeks = monthWeeks(2026, 9)
    expect(weeks).toHaveLength(5)
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    expect(weeks[0].slice(0, 5).map((d) => [d.month, d.day, d.inMonth])).toEqual([
      [8, 27, false],
      [8, 28, false],
      [8, 29, false],
      [8, 30, false],
      [9, 1, true],
    ])
    expect(weeks[4].map((d) => [d.month, d.day, d.inMonth])).toEqual([
      [9, 25, true],
      [9, 26, true],
      [9, 27, true],
      [9, 28, true],
      [9, 29, true],
      [9, 30, true],
      [9, 31, true],
    ])
  })

  it('일요일 1일·28일인 2015년 2월은 4주로 딱 맞는다', () => {
    const weeks = monthWeeks(2015, 1)
    expect(weeks).toHaveLength(4)
    expect(weeks.flat().every((d) => d.inMonth)).toBe(true)
  })

  it('토요일 1일·31일인 2026년 8월은 6주, 마지막 칸은 9월 5일', () => {
    const weeks = monthWeeks(2026, 7)
    expect(weeks).toHaveLength(6)
    expect(weeks[0][6]).toEqual({ year: 2026, month: 7, day: 1, inMonth: true })
    expect(weeks[5][6]).toEqual({ year: 2026, month: 8, day: 5, inMonth: false })
  })

  it('1월 앞 칸은 전해 12월, 12월 뒤 칸은 다음 해 1월', () => {
    expect(monthWeeks(2027, 0)[0][0]).toEqual({ year: 2026, month: 11, day: 27, inMonth: false })
    expect(monthWeeks(2026, 11).at(-1)!.at(-1)).toEqual({ year: 2027, month: 0, day: 2, inMonth: false })
  })
})

describe('shiftMonth', () => {
  it('해를 넘는다', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
  })
})

describe('calendarDocTitle', () => {
  const day = { year: 2026, month: 9, day: 3 }
  it('형식대로, 빈 형식이면 YYYY-MM-DD', () => {
    expect(calendarDocTitle(day, 'YYYY.MM.DD dddd')).toBe('2026.10.03 토요일')
    expect(calendarDocTitle(day, '  ')).toBe('2026-10-03')
  })
})

describe('calendarDocIndex — 설정 폴더 안에서 제목이 날짜 형식과 같은 문서', () => {
  const days = monthWeeks(2026, 9).flat()
  const docs = [
    { id: 'a', title: '2026-10-03', folderId: 'daily' },
    { id: 'b', title: '2026-10-03', folderId: 'other' }, // 다른 폴더
    { id: 'c', title: ' 2026-10-05 ', folderId: 'daily' }, // 앞뒤 공백은 무시
    { id: 'd', title: '2026-10-05', folderId: 'daily' }, // 같은 날 둘째는 무시(목록 앞이 이김)
    { id: 'e', title: '2026-10-07 회의', folderId: 'daily' }, // 제목이 다르면 아님
    { id: 'f', title: '2026-09-30', folderId: 'daily' }, // 격자 앞 칸
    { id: 'g', title: '2026-10-09', folderId: null },
  ]

  it('폴더·제목이 맞는 문서만, 날짜 키로', () => {
    const index = calendarDocIndex({ docs, folderId: 'daily', format: 'YYYY-MM-DD', days })
    expect(Object.fromEntries(index)).toEqual({ '2026-10-03': 'a', '2026-10-05': 'c', '2026-09-30': 'f' })
  })

  it('최상위(null) 폴더', () => {
    const index = calendarDocIndex({ docs, folderId: null, format: 'YYYY-MM-DD', days })
    expect(Object.fromEntries(index)).toEqual({ '2026-10-09': 'g' })
  })

  it('형식이 바뀌면 옛 형식 문서는 잡히지 않는다', () => {
    const index = calendarDocIndex({ docs, folderId: 'daily', format: 'YYYY.MM.DD', days })
    expect(index.size).toBe(0)
  })
})

describe('resolveCalendarFolder', () => {
  const folders = [{ id: 'daily', name: '일기', parentId: null }]
  it('빈 값은 최상위, 있는 id 는 그대로, 없는 id 는 최상위 + missing', () => {
    expect(resolveCalendarFolder('', folders)).toEqual({ folderId: null, missing: false })
    expect(resolveCalendarFolder('daily', folders)).toEqual({ folderId: 'daily', missing: false })
    expect(resolveCalendarFolder('gone', folders)).toEqual({ folderId: null, missing: true })
  })
})

describe('calendarDocDate — 템플릿 {{date}} 는 누른 날, {{time}} 은 지금 시각', () => {
  it('날짜는 누른 날, 시각은 지금', () => {
    const d = calendarDocDate({ year: 2026, month: 9, day: 3 }, new Date(2026, 9, 10, 9, 5, 7))
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2026, 9, 3, 9, 5, 7])
  })
})

describe('dayKey', () => {
  it('두 자리로 채운다', () => {
    expect(dayKey({ year: 2026, month: 0, day: 5 })).toBe('2026-01-05')
  })
})
