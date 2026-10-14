// 칸반 문서의 보기 상태와 보드 스냅샷 — 편집기 EditorState 를 읽기만 한다 (F-2140 2·3장)
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { isKanbanDoc, parseKanban, type KanbanLane } from '../lib/kanban'
import { nextKanbanView, type KanbanView } from './kanbanView'
import type { EditorHandle } from '../editor/Editor'

type ViewMode = 'live' | 'raw' | 'view'
type KanbanState = { docId: string | null; isKanban: boolean; view: KanbanView }

export type UseKanbanViewOptions = {
  editorRef: RefObject<EditorHandle | null>
  editorHandle: EditorHandle | null
  docId: string | null
  // openDoc 이 지금 문서다 — 아니면 편집기가 없거나 다른 문서의 것이다
  ready: boolean
  // 공유 화면·지도가 편집 영역을 덮었다
  covered: boolean
}

export type UseKanbanViewResult = {
  isKanban: boolean
  view: KanbanView
  boardShown: boolean
  handle: EditorHandle | null
  choose: (view: KanbanView) => void
  chooseMode: (mode: ViewMode) => void
}

export function useKanbanView({ editorRef, editorHandle, docId, ready, covered }: UseKanbanViewOptions): UseKanbanViewResult {
  const [state, setState] = useState<KanbanState>({ docId: null, isKanban: false, view: 'source' })
  const stateRef = useRef(state)
  const openedDocRef = useRef<string | null>(null)

  // 바뀐 게 없으면 App 을 다시 그리지 않는다 — 칸반이 아닌 문서도 변경마다 부른다
  const commit = useCallback((next: KanbanState) => {
    const prev = stateRef.current
    if (prev.docId === next.docId && prev.isKanban === next.isKanban && prev.view === next.view) return
    stateRef.current = next
    setState(next)
  }, [])

  // 핸들 상태는 한 커밋 늦게 바뀔 수 있어 layout 단계의 editorRef 로 읽는다 — 문서 전환 커밋에 옛 핸들을 새 문서로 읽지 않게
  useLayoutEffect(() => {
    const handle = ready ? editorRef.current : null
    if (!handle) {
      if (!ready) openedDocRef.current = null
      return
    }
    const opened = openedDocRef.current !== docId
    openedDocRef.current = docId
    const apply = (open: boolean) => {
      const doc = handle.view.state.doc
      // 첫 줄이 `---` 가 아니면 프론트매터가 없다 — 칸반이 아닌 큰 문서는 변경마다 본문을 문자열로 만들지 않는다
      const isKanban = doc.line(1).text.startsWith('---') && isKanbanDoc(doc.toString())
      const view = nextKanbanView(stateRef.current.view, open ? { kind: 'open', isKanban } : { kind: 'kanbanChanged', isKanban })
      commit({ docId, isKanban, view })
    }
    apply(opened)
    let frame = 0
    const off = handle.onChanges(() => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        apply(false)
      })
    })
    return () => {
      off()
      cancelAnimationFrame(frame)
    }
  }, [editorRef, editorHandle, docId, ready, commit])

  const choose = useCallback((view: KanbanView) => {
    const prev = stateRef.current
    commit({ ...prev, view: nextKanbanView(prev.view, { kind: 'choose', view }) })
  }, [commit])

  const chooseMode = useCallback((mode: ViewMode) => {
    const prev = stateRef.current
    commit({ ...prev, view: nextKanbanView(prev.view, { kind: 'chooseMode', mode }) })
  }, [commit])

  const isKanban = ready && editorHandle !== null && state.docId === docId && state.isKanban
  const boardShown = isKanban && state.view === 'board' && !covered
  return { isKanban, view: state.view, boardShown, handle: boardShown ? editorHandle : null, choose, chooseMode }
}

// 보드가 떠 있는 동안만 칸·카드 배열을 든다 — 변경은 표시만 하고 rAF 한 번에 묶어 다시 읽는다 (F-2140 3장)
export function useKanbanLanes(handle: EditorHandle): KanbanLane[] {
  const [snap, setSnap] = useState(() => ({ handle, lanes: parseKanban(handle.view.state.doc.toString()) }))
  if (snap.handle !== handle) setSnap({ handle, lanes: parseKanban(handle.view.state.doc.toString()) })

  // 렌더에서 읽은 뒤 구독 전에 변경이 끼지 않게 같은 커밋 layout 단계에서 붙인다
  useLayoutEffect(() => {
    let frame = 0
    const read = () => {
      frame = 0
      setSnap({ handle, lanes: parseKanban(handle.view.state.doc.toString()) })
    }
    const off = handle.onChanges(() => {
      if (!frame) frame = requestAnimationFrame(read)
    })
    return () => {
      off()
      cancelAnimationFrame(frame)
    }
  }, [handle])

  return snap.lanes
}
