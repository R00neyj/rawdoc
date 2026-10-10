import { describe, expect, it } from 'vitest'
import {
  monthWeeks,
  shiftMonth,
  calendarDocTitle,
  calendarDocIndex,
  resolveCalendarFolder,
  calendarDocDate,
  dayKey,
  calendarDocDay,
  docsOfDay,
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

describe('calendarDocDay — 열린 문서가 날짜 문서면 그 날', () => {
  it('설정 폴더 안에서 제목을 형식대로 읽는다(앞뒤 공백 무시)', () => {
    expect(calendarDocDay({ title: ' 2026-10-03 ', folderId: 'daily' }, 'daily', 'YYYY-MM-DD')).toEqual({ year: 2026, month: 9, day: 3 })
    expect(calendarDocDay({ title: '2026.10.03 토요일', folderId: null }, null, 'YYYY.MM.DD dddd')).toEqual({ year: 2026, month: 9, day: 3 })
    expect(calendarDocDay({ title: '[일기] 26년 10월 3일', folderId: null }, null, '[[일기]] YY년 M월 D일')).toEqual({ year: 2026, month: 9, day: 3 })
  })

  it('다른 폴더, 형식과 다른 제목, 없는 날짜, 요일이 틀린 제목은 날짜 문서가 아니다', () => {
    expect(calendarDocDay({ title: '2026-10-03', folderId: 'other' }, 'daily', 'YYYY-MM-DD')).toBeNull()
    expect(calendarDocDay({ title: '회의록', folderId: null }, null, 'YYYY-MM-DD')).toBeNull()
    expect(calendarDocDay({ title: '2026-02-30', folderId: null }, null, 'YYYY-MM-DD')).toBeNull()
    expect(calendarDocDay({ title: '2026.10.03 일요일', folderId: null }, null, 'YYYY.MM.DD dddd')).toBeNull()
  })

  it('형식에 연·월·일 중 하나라도 없으면 읽지 않는다', () => {
    expect(calendarDocDay({ title: '10-03', folderId: null }, null, 'MM-DD')).toBeNull()
  })
})

describe('docsOfDay — 그날 만든 문서·고친 문서 (기기 시간대)', () => {
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime()
  const docs = [
    { id: 'made', title: '만든 것', createdAt: at(11, 9), updatedAt: at(11, 10), folderId: null },
    { id: 'madeLate', title: '늦게 만든 것', createdAt: at(11, 23), updatedAt: at(12, 1), folderId: null },
    { id: 'edited', title: '고친 것', createdAt: at(1, 9), updatedAt: at(11, 8), folderId: null },
    { id: 'editedLater', title: '나중에 또 고친 것', createdAt: at(1, 9), updatedAt: at(12, 8), folderId: null },
    { id: 'dateDoc', title: '2026-10-11', createdAt: at(10, 20), updatedAt: at(11, 22), folderId: null },
    { id: 'tpl', title: '틀', createdAt: at(11, 7), updatedAt: at(11, 7), folderId: 'templates' },
    { id: 'other', title: '다른 날', createdAt: at(9, 9), updatedAt: at(10, 9), folderId: null },
  ]

  it('만든 문서는 생성 시각이 그날, 고친 문서는 마지막 수정이 그날이고 그날 만든 문서·그 날짜 문서는 뺀다. 최근 것부터', () => {
    const result = docsOfDay({ docs, day: { year: 2026, month: 9, day: 11 }, excludeId: 'dateDoc', hiddenFolderIds: new Set(['templates']) })
    expect(result.created.map((d) => d.id)).toEqual(['madeLate', 'made'])
    expect(result.updated.map((d) => d.id)).toEqual(['edited'])
  })

  it('그날 수정이 나중 수정으로 덮인 문서는 그날 목록에 없다(마지막 수정 시각만 있다)', () => {
    const result = docsOfDay({ docs, day: { year: 2026, month: 9, day: 11 }, excludeId: null, hiddenFolderIds: new Set() })
    expect(result.updated.map((d) => d.id)).not.toContain('editedLater')
    expect(result.updated.map((d) => d.id)).toEqual(['dateDoc', 'edited'])
  })
})
