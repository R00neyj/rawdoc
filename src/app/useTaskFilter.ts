// `할 일` 보기 전역 필터(Tasks Global Filter)와 글자에서 표시 숨기기 — 기기별 (small 2026-10-11)
import { useMemo, useState } from 'react'
import { getPref, setPref } from './prefs'
import { parseTaskFilters, type TaskFilter } from '../lib/docTodos'

export const DEFAULT_TASK_FILTER = '#task, #할일, #todo'

export type TaskFilterSettings = {
  taskFilterText: string
  taskFilterHide: boolean
  onChangeTaskFilter: (value: string) => void
  onChangeTaskFilterHide: (on: boolean) => void
}

export function useTaskFilter(): { taskFilter: TaskFilter; settings: TaskFilterSettings } {
  const [text, setText] = useState(() => getPref('md.taskFilter', DEFAULT_TASK_FILTER))
  // Tasks 의 Remove global filter from description 기본값(false)과 같게 꺼짐
  const [hide, setHide] = useState(() => getPref('md.taskFilterHide', 'off') === 'on')
  const taskFilter = useMemo(() => ({ filters: parseTaskFilters(text), hide }), [text, hide])
  return {
    taskFilter,
    settings: {
      taskFilterText: text,
      taskFilterHide: hide,
      onChangeTaskFilter: (value) => {
        setText(value)
        setPref('md.taskFilter', value)
      },
      onChangeTaskFilterHide: (on) => {
        setHide(on)
        setPref('md.taskFilterHide', on ? 'on' : 'off')
      },
    },
  }
}
