// 오른쪽 패널 달력 — 월 격자·날짜 문서 제목·찾기, 순수 함수 (small 2026-10-10)
import { formatTemplateDate } from './templates'
import { normalizeForSearch } from './docSearch'
import type { FolderLike } from './folderTree'

export const CALENDAR_DEFAULT_FORMAT = 'YYYY-MM-DD'

export type YearMonth = { year: number; month: number } // month 0~11
export type CalendarDate = { year: number; month: number; day: number }
export type CalendarDay = CalendarDate & { inMonth: boolean }

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function dayKey(d: CalendarDate): string {
  return `${d.year}-${pad2(d.month + 1)}-${pad2(d.day)}`
}

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const total = ym.year * 12 + ym.month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

// 일요일 시작, 그 달을 다 담는 만큼의 주(4~6). 앞뒤 빈칸은 이웃 달 날짜
export function monthWeeks(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const weekCount = Math.ceil((first.getDay() + daysInMonth) / 7)
  const weeks: CalendarDay[][] = []
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarDay[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date(year, month, 1 - first.getDay() + w * 7 + i)
      week.push({ year: date.getFullYear(), month: date.getMonth(), day: date.getDate(), inMonth: date.getMonth() === month })
    }
    weeks.push(week)
  }
  return weeks
}

export function calendarDocTitle(d: CalendarDate, format: string): string {
  return formatTemplateDate(new Date(d.year, d.month, d.day), format.trim() || CALENDAR_DEFAULT_FORMAT)
}

function titleKey(title: string): string {
  return normalizeForSearch(title).trim()
}

// 그 폴더(하위 제외)에서 제목이 날짜 형식과 같은 문서 → 날짜 키. 같은 날이 여럿이면 목록 앞쪽
export function calendarDocIndex(input: {
  docs: readonly { id: string; title: string; folderId?: string | null }[]
  folderId: string | null
  format: string
  days: readonly CalendarDate[]
}): Map<string, string> {
  const byTitle = new Map<string, string>()
  for (const doc of input.docs) {
    if ((doc.folderId ?? null) !== input.folderId) continue
    const key = titleKey(doc.title)
    if (key !== '' && !byTitle.has(key)) byTitle.set(key, doc.id)
  }
  const index = new Map<string, string>()
  for (const d of input.days) {
    const id = byTitle.get(titleKey(calendarDocTitle(d, input.format)))
    if (id) index.set(dayKey(d), id)
  }
  return index
}

// 설정 폴더 — '' 는 최상위, 지워진 폴더는 최상위로 두고 missing 으로 알린다
export function resolveCalendarFolder(pref: string, folders: readonly FolderLike[]): { folderId: string | null; missing: boolean } {
  if (pref === '') return { folderId: null, missing: false }
  return folders.some((f) => f.id === pref) ? { folderId: pref, missing: false } : { folderId: null, missing: true }
}

// 템플릿 변수의 기준 시각 — 날짜는 누른 날, 시각은 지금
export function calendarDocDate(d: CalendarDate, now: Date): Date {
  return new Date(d.year, d.month, d.day, now.getHours(), now.getMinutes(), now.getSeconds())
}

// 형식 토큰 → 정규식 조각과 읽을 칸. formatTemplateDate 와 같은 순서(긴 토큰 먼저)로 읽는다
const DATE_TOKEN_PATTERNS: [string, string, 'year' | 'yy' | 'month' | 'day' | null][] = [
  ['YYYY', '(\\d{4})', 'year'],
  ['dddd', '[일월화수목금토]요일', null],
  ['ddd', '[일월화수목금토]', null],
  ['YY', '(\\d{2})', 'yy'],
  ['MM', '(\\d{2})', 'month'],
  ['DD', '(\\d{2})', 'day'],
  ['HH', '\\d{2}', null],
  ['mm', '\\d{2}', null],
  ['ss', '\\d{2}', null],
  ['M', '(\\d{1,2})', 'month'],
  ['D', '(\\d{1,2})', 'day'],
  ['H', '\\d{1,2}', null],
]

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 열린 문서가 설정 폴더(하위 제외)의 날짜 문서면 그 날. 형식으로 다시 만든 제목과 같을 때만 — 없는 날짜·틀린 요일은 null
export function calendarDocDay(doc: { title: string; folderId?: string | null }, folderId: string | null, format: string): CalendarDate | null {
  if ((doc.folderId ?? null) !== folderId) return null
  const fmt = format.trim() || CALENDAR_DEFAULT_FORMAT
  let pattern = ''
  const fields: ('year' | 'yy' | 'month' | 'day')[] = []
  let i = 0
  while (i < fmt.length) {
    if (fmt[i] === '[') {
      const end = fmt.indexOf(']', i + 1)
      if (end !== -1) {
        pattern += escapeRegExp(fmt.slice(i + 1, end))
        i = end + 1
        continue
      }
    }
    const hit = DATE_TOKEN_PATTERNS.find(([tok]) => fmt.startsWith(tok, i))
    if (hit) {
      pattern += hit[1]
      if (hit[2]) fields.push(hit[2])
      i += hit[0].length
    } else {
      pattern += escapeRegExp(fmt[i])
      i += 1
    }
  }
  const match = new RegExp(`^${pattern}$`, 'u').exec(doc.title.trim())
  if (!match) return null
  const read = (field: 'year' | 'yy' | 'month' | 'day') => {
    const at = fields.indexOf(field)
    return at === -1 ? null : Number(match[at + 1])
  }
  const yy = read('yy')
  const year = read('year') ?? (yy === null ? null : 2000 + yy)
  const month = read('month')
  const day = read('day')
  if (year === null || month === null || day === null) return null
  const date = { year, month: month - 1, day }
  return titleKey(calendarDocTitle(date, fmt)) === titleKey(doc.title) ? date : null
}

function localDayKey(ms: number): string {
  const d = new Date(ms)
  return dayKey({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() })
}

// 그날(기기 시간대) 만든 문서와 마지막으로 고친 문서. 고친 문서에서 그날 만든 문서·excludeId(그 날짜 문서)는 뺀다, 최근 것부터
export function docsOfDay<D extends { id: string; createdAt: number; updatedAt: number; folderId?: string | null }>(input: {
  docs: readonly D[]
  day: CalendarDate
  excludeId: string | null
  hiddenFolderIds: ReadonlySet<string>
}): { created: D[]; updated: D[] } {
  const key = dayKey(input.day)
  const visible = input.docs.filter((d) => !(d.folderId && input.hiddenFolderIds.has(d.folderId)))
  const created = visible.filter((d) => localDayKey(d.createdAt) === key).sort((a, b) => b.createdAt - a.createdAt)
  const updated = visible
    .filter((d) => d.id !== input.excludeId && localDayKey(d.updatedAt) === key && localDayKey(d.createdAt) !== key)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return { created, updated }
}
