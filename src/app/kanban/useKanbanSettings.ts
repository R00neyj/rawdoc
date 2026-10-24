// 설정 `칸반` 탭 — 지금 연 칸반 문서의 완료 칸을 읽고, 쓰기는 applyKanban 한 길 (small 2026-10-14)
import { useEffect, useMemo, useState } from 'react'
import { kanbanDoneChange, kanbanDoneChoices, type KanbanDoneChoices } from '../../lib/kanban/kanban'
import type { EditorHandle } from '../../editor/Editor'
import type { ApplyKanban } from './useKanbanView'

export type KanbanSettings = {
  isKanban: boolean
  // 칸이 없으면 null
  choices: KanbanDoneChoices | null
  readOnly: boolean
  onChangeDone: (title: string | null) => void
}

// handle 은 지금 문서가 칸반일 때만 준다. 대화상자가 열린 동안만 원문 변경을 따라 다시 읽는다
export function useKanbanSettings({ open, handle, readOnly, apply }: { open: boolean; handle: EditorHandle | null; readOnly: boolean; apply: ApplyKanban }): KanbanSettings {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!open || !handle) return
    return handle.onChanges(() => setTick((n) => n + 1))
  }, [open, handle])
  // tick 은 원문이 바뀌었을 때 다시 읽게 하는 의존이다
  const choices = useMemo(
    () => (open && handle ? kanbanDoneChoices(handle.view.state.doc.toString()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, handle, tick],
  )
  return {
    isKanban: handle !== null,
    choices,
    readOnly,
    onChangeDone: (title) => {
      if (handle) apply(kanbanDoneChange(handle.view.state.doc.toString(), title), 'kanban.done')
    },
  }
}
