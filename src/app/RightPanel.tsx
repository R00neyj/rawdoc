// 오른쪽 패널 — 지금은 달력 하나. 넓은 창은 메인 열 오른쪽 고정 폭, 좁은 창은 오른쪽에서 겹쳐 연다 (small 2026-10-10)
import { dayKey, type CalendarDay } from '../lib/calendar'
import { IconChevron, IconChevronLeft, IconClose } from './icons'
import type { CalendarView } from './useCalendarPanel'

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

function dayLabel(d: CalendarDay, hasDoc: boolean): string {
  const weekday = WEEKDAY_LABELS[new Date(d.year, d.month, d.day).getDay()]
  return `${d.month + 1}월 ${d.day}일 ${weekday}요일${hasDoc ? ', 문서 있음' : ''}`
}

function CalendarMonth({ view }: { view: CalendarView }) {
  const monthLabel = `${view.month.year}년 ${view.month.month + 1}월`
  return (
    <div className="calendar">
      <div className="calendar-nav">
        <button type="button" className="icon-btn" aria-label="이전 달" onClick={view.onPrevMonth}>
          <IconChevronLeft size={18} />
        </button>
        <span className="calendar-month" aria-live="polite">
          {monthLabel}
        </span>
        <button type="button" className="icon-btn" aria-label="다음 달" onClick={view.onNextMonth}>
          <IconChevron size={18} />
        </button>
        <button type="button" className="calendar-today-btn" onClick={view.onToday}>
          오늘
        </button>
      </div>
      <table className="calendar-grid" aria-label={monthLabel}>
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((w) => (
              <th key={w} scope="col">
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.weeks.map((week) => (
            <tr key={dayKey(week[0])}>
              {week.map((d) => {
                const key = dayKey(d)
                const docId = view.docIndex.get(key)
                const classes = ['calendar-day']
                if (!d.inMonth) classes.push('calendar-day--outside')
                if (docId !== undefined && docId === view.currentDocId) classes.push('calendar-day--current')
                return (
                  <td key={key}>
                    <button
                      type="button"
                      className={classes.join(' ')}
                      aria-label={dayLabel(d, docId !== undefined)}
                      aria-current={key === view.todayKey ? 'date' : undefined}
                      onClick={() => view.onOpenDay(d)}
                    >
                      {d.day}
                      {docId !== undefined && <span className="calendar-dot" aria-hidden="true" />}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function RightPanel({ narrow, view, onClose }: { narrow: boolean; view: CalendarView; onClose: () => void }) {
  return (
    <aside className={narrow ? 'right-panel right-panel--overlay' : 'right-panel'} data-ui="right-panel" aria-label="달력">
      <div className="right-panel-head">
        <h2>달력</h2>
        <button type="button" className="icon-btn" aria-label="달력 닫기" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </div>
      <CalendarMonth view={view} />
    </aside>
  )
}
