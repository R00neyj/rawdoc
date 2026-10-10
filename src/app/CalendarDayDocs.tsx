// 달력 아래 그날 문서 — 열린 날짜 문서의 날(아니면 오늘)에 만든 문서·고친 문서 (small 2026-10-11)
import type { CalendarView, DayDocRow } from './useCalendarPanel'

function DayGroup({ title, rows, onOpen }: { title: string; rows: DayDocRow[]; onOpen: (id: string) => void }) {
  if (rows.length === 0) return null
  return (
    <section className="doc-links-group">
      <h4 className="doc-links-title">
        {title}
        <span className="doc-links-count">{rows.length}</span>
      </h4>
      <ul className="doc-links-list">
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="doc-link-item" onClick={() => onOpen(row.id)}>
              <span className="doc-link-title">{row.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function CalendarDayDocs({ view }: { view: CalendarView }) {
  const { label, created, updated } = view.dayDocs
  return (
    <section className="calendar-day-docs">
      <h3 className="calendar-day-docs-title">{label}</h3>
      {created.length === 0 && updated.length === 0 ? (
        <p className="doc-links-empty">이날 만들거나 고친 문서가 없습니다.</p>
      ) : (
        <>
          <DayGroup title="만든 문서" rows={created} onOpen={view.onOpenDoc} />
          <DayGroup title="고친 문서" rows={updated} onOpen={view.onOpenDoc} />
        </>
      )}
    </section>
  )
}
