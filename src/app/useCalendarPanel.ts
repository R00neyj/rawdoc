// 오른쪽 패널 `달력` 보기 — 달 이동·날짜 문서 열기/만들기·그날 문서·달력 설정 (small 2026-10-10, 2026-10-11)
import { useMemo, useState, type RefObject } from 'react'
import { getPref, setPref } from './prefs'
import { flattenFolderTree } from '../lib/folderTree'
import { templateFolderIds, NEW_DOC_TEMPLATE_NONE } from '../lib/templates'
import {
  CALENDAR_DEFAULT_FORMAT,
  calendarDocDate,
  calendarDocDay,
  calendarDocIndex,
  calendarDocTitle,
  dayKey,
  docsOfDay,
  monthWeeks,
  resolveCalendarFolder,
  shiftMonth,
  type CalendarDate,
  type CalendarDay,
  type YearMonth,
} from '../lib/calendar'
import type { CalendarSettings } from './CalendarSettingsTab'
import type { CreateDocInput } from './useDocNavigation'
import type { TemplateContentVars } from './useNewDocTemplate'
import { displayDocTitle, type DocMeta } from './docMeta'
import type { Folder } from '../types'

export type UseCalendarPanelOptions = {
  closePanelIfNarrow: () => void
  // 설정에서 켰고 달력 보기가 보일 때만 그날 문서를 센다
  dayDocsActive: boolean
  docs: DocMeta[]
  docsRef: RefObject<DocMeta[]>
  folders: Folder[]
  currentDocId: string | null
  createDoc: (input: CreateDocInput) => Promise<boolean>
  selectDoc: (id: string) => Promise<void>
  ensureE2eeOpenForFolder: (folderId: string | null) => Promise<boolean>
  buildContentFromTemplate: (templateId: string, vars: TemplateContentVars) => Promise<{ content: string; failed: boolean }>
}

export type DayDocRow = { id: string; title: string }

export type CalendarView = {
  month: YearMonth
  weeks: CalendarDay[][]
  docIndex: Map<string, string>
  todayKey: string
  currentDocId: string | null
  // 열린 날짜 문서의 날, 아니면 오늘 — 그날 만든 문서·고친 문서. 끄거나 안 보이면 null
  dayDocs: { label: string; created: DayDocRow[]; updated: DayDocRow[] } | null
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onOpenDay: (day: CalendarDate) => void
  onOpenDoc: (id: string) => void
}

function todayYearMonth(): YearMonth {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

export type UseCalendarPanelResult = {
  view: CalendarView
  settings: CalendarSettings
}

export function useCalendarPanel(options: UseCalendarPanelOptions): UseCalendarPanelResult {
  const { closePanelIfNarrow, dayDocsActive, docs, docsRef, folders, currentDocId, createDoc, selectDoc, ensureE2eeOpenForFolder, buildContentFromTemplate } = options
  const [month, setMonth] = useState(todayYearMonth)
  const [folderPref, setFolderPref] = useState(() => getPref('md.calendarFolder', ''))
  const [formatPref, setFormatPref] = useState(() => getPref('md.calendarFormat', CALENDAR_DEFAULT_FORMAT))
  const [templatePref, setTemplatePref] = useState(() => getPref('md.calendarTemplate', NEW_DOC_TEMPLATE_NONE))

  const folderState = resolveCalendarFolder(folderPref, folders)
  const weeks = useMemo(() => monthWeeks(month.year, month.month), [month])
  const docIndex = useMemo(
    () => calendarDocIndex({ docs, folderId: folderState.folderId, format: formatPref, days: weeks.flat() }),
    [docs, folderState.folderId, formatPref, weeks],
  )
  const folderOptions = useMemo(() => {
    const hidden = templateFolderIds(folders)
    return flattenFolderTree(folders)
      .filter((f) => !hidden.has(f.id))
      .map((f) => ({ id: f.id, label: `${'\u00a0\u00a0'.repeat(f.depth)}${f.name}` }))
  }, [folders])

  const now = new Date()
  const todayKey = dayKey({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() })
  const currentDoc = docs.find((d) => d.id === currentDocId) ?? null
  const openedDay = currentDoc && currentDoc.e2ee !== 'locked' ? calendarDocDay(currentDoc, folderState.folderId, formatPref) : null
  const listKey = openedDay ? dayKey(openedDay) : todayKey
  const dayDocs = useMemo(() => {
    if (!dayDocsActive) return null
    const [year, month1, day] = listKey.split('-').map(Number)
    const date = { year, month: month1 - 1, day }
    const dateDocId = calendarDocIndex({ docs, folderId: folderState.folderId, format: formatPref, days: [date] }).get(listKey) ?? null
    const { created, updated } = docsOfDay({ docs, day: date, excludeId: dateDocId, hiddenFolderIds: templateFolderIds(folders) })
    const row = (d: DocMeta): DayDocRow => ({ id: d.id, title: d.e2ee === 'locked' ? '잠긴 문서' : displayDocTitle(d.title) })
    return { label: `${month1}월 ${day}일`, created: created.map(row), updated: updated.map(row) }
  }, [dayDocsActive, docs, folders, listKey, folderState.folderId, formatPref])

  // 있으면 열고, 없으면 설정 폴더에 템플릿 본문으로 만든다. 잠긴 금고 폴더는 먼저 열어 제목을 읽은 뒤 판정한다
  async function openDay(day: CalendarDate) {
    const { folderId } = resolveCalendarFolder(folderPref, folders)
    if (!(await ensureE2eeOpenForFolder(folderId))) return
    closePanelIfNarrow()
    const existing = calendarDocIndex({ docs: docsRef.current, folderId, format: formatPref, days: [day] }).get(dayKey(day))
    if (existing) {
      await selectDoc(existing)
      return
    }
    const title = calendarDocTitle(day, formatPref)
    await createDoc({
      folderId,
      title,
      focus: 'editor',
      content: () => buildContentFromTemplate(templatePref, { title, now: calendarDocDate(day, new Date()) }),
      failedMessage: '달력 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.',
    })
  }

  const view: CalendarView = {
    month,
    weeks,
    docIndex,
    todayKey,
    currentDocId,
    dayDocs,
    onPrevMonth: () => setMonth((m) => shiftMonth(m, -1)),
    onNextMonth: () => setMonth((m) => shiftMonth(m, 1)),
    onToday: () => setMonth(todayYearMonth()),
    onOpenDay: (day) => void openDay(day),
    onOpenDoc: (id) => {
      closePanelIfNarrow()
      void selectDoc(id)
    },
  }

  const settings: CalendarSettings = {
    folder: folderPref,
    folderOptions,
    folderMissing: folderState.missing,
    format: formatPref,
    template: templatePref,
    onChangeFolder: (value) => {
      setFolderPref(value)
      setPref('md.calendarFolder', value)
    },
    onChangeFormat: (value) => {
      setFormatPref(value)
      setPref('md.calendarFormat', value)
    },
    onChangeTemplate: (value) => {
      setTemplatePref(value)
      setPref('md.calendarTemplate', value)
    },
  }

  return { view, settings }
}
