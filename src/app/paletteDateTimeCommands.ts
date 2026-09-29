// 팔레트 날짜·시각 넣기 명령 — 순수, DOM·React 없음 (specs/features/F-2088.md 3.3)
import { formatTemplateDate, TEMPLATE_DATE_FORMAT, TEMPLATE_TIME_FORMAT } from '../lib/templates'
import type { PaletteActionCommand } from './paletteContract'

export type DateTimeKind = 'date' | 'time'

export function dateTimeText(kind: DateTimeKind, now: Date): string {
  return formatTemplateDate(now, kind === 'date' ? TEMPLATE_DATE_FORMAT : TEMPLATE_TIME_FORMAT)
}

export const PALETTE_DATETIME_COMMANDS: readonly PaletteActionCommand[] = [
  {
    id: 'insert.date',
    kind: 'action',
    label: '오늘 날짜 넣기',
    keywords: ['날짜', '오늘', 'date', 'today', '일자', '삽입'],
    when: (ctx) => Boolean(ctx.dateTime),
    run: (ctx) => ctx.dateTime?.insert(dateTimeText('date', new Date())),
  },
  {
    id: 'insert.time',
    kind: 'action',
    label: '지금 시각 넣기',
    keywords: ['시각', '시간', '지금', 'time', 'now', '현재', '타임스탬프', 'timestamp', '삽입'],
    when: (ctx) => Boolean(ctx.dateTime),
    run: (ctx) => ctx.dateTime?.insert(dateTimeText('time', new Date())),
  },
]
