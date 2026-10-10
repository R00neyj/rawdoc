// 오른쪽 패널 — 보기 목록을 가진 칸을 위아래로 쌓는다. 넓은 창은 메인 열 오른쪽 고정 폭, 좁은 창은 오른쪽에서 겹쳐 연다 (small 2026-10-10, 2026-10-11)
import { dayKey, type CalendarDay } from '../lib/calendar'
import { IconChevron, IconChevronLeft, IconClose } from './icons'
import usePresence from './usePresence'
import PanelLinks from './PanelLinks'
import PanelTodos from './PanelTodos'
import PanelGraph from './PanelGraph'
import CalendarDayDocs from './CalendarDayDocs'
import { PANEL_VIEW_LABELS, type PanelSlotState, type PanelViewId } from './useRightPanel'
import type { CalendarView } from './useCalendarPanel'
import type { DocGraphView, DocLinksView, DocTodosView } from './usePanelDocs'
import type { PhoneSideSections } from './usePhoneSidePanel'

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
      <CalendarDayDocs view={view} />
    </div>
  )
}

export type PanelViews = { calendar: CalendarView; graph: DocGraphView; links: DocLinksView; todos: DocTodosView }

// 링크·할 일처럼 길어지는 보기는 남은 높이를 채우고 안에서 스크롤한다
const FILL_VIEW: Record<PanelViewId, boolean> = { calendar: false, graph: false, links: true, todos: true }

function ViewBody({ view, views }: { view: PanelViewId; views: PanelViews }) {
  if (view === 'calendar') return <CalendarMonth view={views.calendar} />
  if (view === 'graph') return <PanelGraph view={views.graph} />
  return view === 'links' ? <PanelLinks view={views.links} /> : <PanelTodos view={views.todos} />
}

function SlotArrow({ slot, step }: { slot: PanelSlotState; step: 1 | -1 }) {
  return (
    <button type="button" className="icon-btn" aria-label={step < 0 ? '이전 보기' : '다음 보기'} onClick={() => slot.onCycle(step)}>
      {step < 0 ? <IconChevronLeft size={18} /> : <IconChevron size={18} />}
    </button>
  )
}

export type PhoneSidePanelProps = {
  sections: PhoneSideSections
  onToggleSection: (key: keyof PhoneSideSections) => void
  onOutlineSlot: (el: HTMLElement | null) => void
  hasDoc: boolean
  top: PanelSlotState | null
}

function SectionToggle({ label, expanded, onToggle }: { label: string; expanded: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="side-panel-toggle" aria-expanded={expanded} onClick={onToggle}>
      <IconChevron size={18} className="side-panel-chevron" />
      {label}
    </button>
  )
}

// 휴대폰 폭 — 왼쪽 밀기로 여는 위 칸(‹ › 로 보기 넘기기)·아래 목차 패널. 표시할 항목을 다 끄면 목차 칸만. 목차 줄은 Outline 이 onOutlineSlot 자리로 포털한다
// 닫힘·접힘도 전환이 보이게 패널은 usePresence 로, 칸 몸통은 늘 그려 두고 flex-grow 로 줄인다
function PhoneSidePanel({ open, views, onClose, phone }: { open: boolean; views: PanelViews; onClose: () => void; phone: PhoneSidePanelProps }) {
  const { sections, onToggleSection, onOutlineSlot, hasDoc, top } = phone
  const { mounted, state } = usePresence(open)
  if (!mounted) return null
  const outlineToggle = <SectionToggle label="목차" expanded={sections.outline} onToggle={() => onToggleSection('outline')} />
  return (
    <>
      {open && <div className="outline-panel-backdrop" onClick={onClose} />}
      <nav className="outline-panel side-panel" data-ui="right-panel" aria-label="오른쪽 패널" data-state={state} inert={state === 'closed'}>
        <div className="outline-panel-head">
          {top ? <SectionToggle label={PANEL_VIEW_LABELS[top.view]} expanded={sections.top} onToggle={() => onToggleSection('top')} /> : outlineToggle}
          {top && top.views.length > 1 && (
            <span className="panel-slot-nav">
              <SlotArrow slot={top} step={-1} />
              <SlotArrow slot={top} step={1} />
            </span>
          )}
          <button type="button" className="icon-btn outline-panel-close" aria-label="패널 닫기" onClick={onClose}>
            <IconClose size={20} />
          </button>
        </div>
        {top && (
          <>
            <div className="side-panel-body" data-collapsed={sections.top ? undefined : ''} inert={!sections.top}>
              <ViewBody view={top.view} views={views} />
            </div>
            <div className="side-panel-head">{outlineToggle}</div>
          </>
        )}
        <div className="side-panel-body" data-collapsed={sections.outline ? undefined : ''} inert={!sections.outline}>
          {hasDoc ? <div className="side-panel-slot" ref={onOutlineSlot} /> : <p className="side-panel-empty">문서를 열면 제목이 여기에 나옵니다.</p>}
        </div>
      </nav>
    </>
  )
}

export default function RightPanel({
  open,
  narrow,
  slots,
  views,
  onClose,
  phone,
}: {
  open: boolean
  narrow: boolean
  slots: PanelSlotState[]
  views: PanelViews
  onClose: () => void
  phone?: PhoneSidePanelProps
}) {
  if (phone) return <PhoneSidePanel open={open} views={views} onClose={onClose} phone={phone} />
  if (!open) return null
  return (
    <aside className={narrow ? 'right-panel right-panel--overlay' : 'right-panel'} data-ui="right-panel" aria-label="오른쪽 패널">
      {slots.map((slot, index) => (
        <div key={slot.id} className={FILL_VIEW[slot.view] ? 'panel-slot panel-slot--fill' : 'panel-slot'} data-collapsed={slot.collapsed ? '' : undefined}>
          <div className="right-panel-head">
            <h2>
              <button type="button" className="panel-slot-toggle" aria-expanded={!slot.collapsed} onClick={slot.onToggleCollapsed}>
                <IconChevron size={18} className="side-panel-chevron" />
                <span aria-live={slot.views.length > 1 ? 'polite' : undefined}>{PANEL_VIEW_LABELS[slot.view]}</span>
              </button>
            </h2>
            {slot.views.length > 1 && (
              <span className="panel-slot-nav">
                <SlotArrow slot={slot} step={-1} />
                <SlotArrow slot={slot} step={1} />
              </span>
            )}
            {index === 0 && (
              <button type="button" className="icon-btn right-panel-close" aria-label="오른쪽 패널 닫기" onClick={onClose}>
                <IconClose size={18} />
              </button>
            )}
          </div>
          {/* 접힌 칸은 보기를 그리지 않는다 — 데이터도 useRightPanel.shownViews 에서 빠져 계산하지 않는다 */}
          {!slot.collapsed && <ViewBody view={slot.view} views={views} />}
        </div>
      ))}
    </aside>
  )
}
