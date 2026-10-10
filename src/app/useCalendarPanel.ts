// 오른쪽 패널(달력) 열림·달 이동·날짜 문서 열기/만들기·달력 설정 (small 2026-10-10)
import { useCallback, useMemo, useState, type RefObject } from 'react'
import { getPref, setPref } from './prefs'
import { flattenFolderTree } from '../lib/folderTree'
import { templateFolderIds, NEW_DOC_TEMPLATE_NONE } from '../lib/templates'
import {
  CALENDAR_DEFAULT_FORMAT,
  calendarDocDate,
  calendarDocIndex,
  calendarDocTitle,
  dayKey,
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
import type { DocMeta } from './docMeta'
import type { Folder } from '../types'

export type UseCalendarPanelOptions = {
  narrow: boolean
  docs: DocMeta[]
  docsRef: RefObject<DocMeta[]>
  folders: Folder[]
  currentDocId: string | null
  createDoc: (input: CreateDocInput) => Promise<boolean>
  selectDoc: (id: string) => Promise<void>
  ensureE2eeOpenForFolder: (folderId: string | null) => Promise<boolean>
  buildContentFromTemplate: (templateId: string, vars: TemplateContentVars) => Promise<{ content: string; failed: boolean }>
}

export type CalendarView = {
  month: YearMonth
  weeks: CalendarDay[][]
  docIndex: Map<string, string>
  todayKey: string
  currentDocId: string | null
  onPrevMonth: () => void
  onNextMonth: () => void
  onToday: () => void
  onOpenDay: (day: CalendarDate) => void
}

function todayYearMonth(): YearMonth {
  const now = new Date()
  return { year: now.getFullYear(), month: now.getMonth() }
}

export type UseCalendarPanelResult = {
  panelOpen: boolean
  togglePanel: () => void
  openPanel: () => void
  closePanel: () => void
  view: CalendarView
  settings: CalendarSettings
}

export function useCalendarPanel(options: UseCalendarPanelOptions): UseCalendarPanelResult {
  const { narrow, docs, docsRef, folders, currentDocId, createDoc, selectDoc, ensureE2eeOpenForFolder, buildContentFromTemplate } = options
  const [widePref, setWidePref] = useState(() => getPref('md.rightPanel', 'closed'))
  const [narrowOpen, setNarrowOpen] = useState(false)
  // 넓은 창으로 돌아가면 겹침 열림은 버린다 — 렌더 중 조정
  const [narrowSeen, setNarrowSeen] = useState(narrow)
  if (narrow !== narrowSeen) {
    setNarrowSeen(narrow)
    if (!narrow) setNarrowOpen(false)
  }
  const panelOpen = narrow ? narrowOpen : widePref === 'open'

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

  // 밀기·Esc 구독이 렌더마다 다시 걸리지 않게 안정 함수로 둔다
  const setPanelOpen = useCallback(
    (open: boolean) => {
      if (narrow) {
        setNarrowOpen(open)
        return
      }
      const value = open ? 'open' : 'closed'
      setWidePref(value)
      setPref('md.rightPanel', value)
    },
    [narrow],
  )
  const openPanel = useCallback(() => setPanelOpen(true), [setPanelOpen])
  const closePanel = useCallback(() => setPanelOpen(false), [setPanelOpen])

  // 있으면 열고, 없으면 설정 폴더에 템플릿 본문으로 만든다. 잠긴 금고 폴더는 먼저 열어 제목을 읽은 뒤 판정한다
  async function openDay(day: CalendarDate) {
    const { folderId } = resolveCalendarFolder(folderPref, folders)
    if (!(await ensureE2eeOpenForFolder(folderId))) return
    if (narrow) setNarrowOpen(false)
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

  const now = new Date()
  const view: CalendarView = {
    month,
    weeks,
    docIndex,
    todayKey: dayKey({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }),
    currentDocId,
    onPrevMonth: () => setMonth((m) => shiftMonth(m, -1)),
    onNextMonth: () => setMonth((m) => shiftMonth(m, 1)),
    onToday: () => setMonth(todayYearMonth()),
    onOpenDay: (day) => void openDay(day),
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

  return {
    panelOpen,
    togglePanel: () => setPanelOpen(!panelOpen),
    openPanel,
    closePanel,
    view,
    settings,
  }
}
