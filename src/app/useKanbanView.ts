// 칸반 문서의 보기 상태와 보드 스냅샷 — 읽기는 편집기 EditorState, 쓰기는 view.dispatch 한 길 (F-2140 2·3장, F-2141 2장)
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { MapMode, type ChangeDesc } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { isKanbanDoc, kanbanFlagChange, parseKanban, type KanbanChange, type KanbanLane } from '../lib/kanban'
import { nextKanbanView, type KanbanView } from './kanbanView'
import type { EditorHandle } from '../editor/Editor'

type ViewMode = 'live' | 'raw' | 'view'
export type KanbanUserEvent = `kanban.${'add' | 'edit' | 'move' | 'moveLane' | 'removeLane' | 'removeCard' | 'toggle' | 'flag' | 'done'}`
export type ApplyKanban = (change: KanbanChange | KanbanChange[] | null, userEvent: KanbanUserEvent) => boolean
type KanbanState = { docId: string | null; isKanban: boolean; view: KanbanView }

export type UseKanbanViewOptions = {
  editorRef: RefObject<EditorHandle | null>
  editorHandle: EditorHandle | null
  docId: string | null
  // openDoc 이 지금 문서다 — 아니면 편집기가 없거나 다른 문서의 것이다
  ready: boolean
  // 공유 화면·지도가 편집 영역을 덮었다
  covered: boolean
  showNotice: (input: { type: 'info'; message: string }) => unknown
}

export type UseKanbanViewResult = {
  isKanban: boolean
  view: KanbanView
  boardShown: boolean
  handle: EditorHandle | null
  choose: (view: KanbanView) => void
  chooseMode: (mode: ViewMode) => void
  applyKanban: ApplyKanban
  showBoard: () => void
  // 할 일 패널에서 누른 카드 — 그 문서 보드가 뜨면 한 번 보인다 (small 2026-10-14)
  revealCard: (docId: string, line: number) => void
  revealTick: number
  takeReveal: () => number | null
}

// 변경 하나 = 트랜잭션 하나 = 되돌리기 한 단계 (F-2138 1장)
export function applyKanbanTo(view: EditorView, change: KanbanChange | KanbanChange[] | null, userEvent: KanbanUserEvent): boolean {
  if (change === null || view.state.readOnly) return false
  view.dispatch({ changes: change, userEvent })
  return true
}

export function useKanbanView({ editorRef, editorHandle, docId, ready, covered, showNotice }: UseKanbanViewOptions): UseKanbanViewResult {
  const [state, setState] = useState<KanbanState>({ docId: null, isKanban: false, view: 'source' })
  const stateRef = useRef(state)
  const openedDocRef = useRef<string | null>(null)
  const revealRef = useRef<{ docId: string; line: number } | null>(null)
  const [revealTick, setRevealTick] = useState(0)

  // 바뀐 게 없으면 App 을 다시 그리지 않는다 — 칸반이 아닌 문서도 변경마다 부른다
  const commit = useCallback((next: KanbanState) => {
    const prev = stateRef.current
    if (prev.docId === next.docId && prev.isKanban === next.isKanban && prev.view === next.view) return
    // 다른 문서로 옮겼으면 못 쓴 요청을 버린다
    if (prev.docId !== next.docId && revealRef.current?.docId !== next.docId) revealRef.current = null
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

  const applyKanban = useCallback<ApplyKanban>(
    (change, userEvent) => {
      const handle = ready ? editorRef.current : null
      return handle ? applyKanbanTo(handle.view, change, userEvent) : false
    },
    [ready, editorRef],
  )

  // 칸반 문서가 아니면 `kanban: true` 한 줄을 더한 뒤 보드를 고른다 (F-2143 3장)
  const showBoard = useCallback(() => {
    const handle = ready ? editorRef.current : null
    if (!handle) return
    const text = handle.view.state.doc.toString()
    if (!isKanbanDoc(text)) {
      if (parseKanban(text).length === 0) return void showNotice({ type: 'info', message: '칸으로 쓸 ## 제목이 없습니다.' })
      if (!applyKanbanTo(handle.view, kanbanFlagChange(text), 'kanban.flag')) return
    }
    choose('board')
  }, [ready, editorRef, showNotice, choose])

  // 지금 문서면 보드로 바꾸고, 다른 문서면 열린 뒤 보드가 받아 간다
  const revealCard = useCallback((docId: string, line: number) => {
    revealRef.current = { docId, line }
    setRevealTick((n) => n + 1)
    if (stateRef.current.docId === docId && stateRef.current.isKanban) choose('board')
  }, [choose])

  const takeReveal = useCallback(() => {
    const pending = revealRef.current
    if (!pending || pending.docId !== stateRef.current.docId) return null
    revealRef.current = null
    return pending.line
  }, [])

  const isKanban = ready && editorHandle !== null && state.docId === docId && state.isKanban
  const boardShown = isKanban && state.view === 'board' && !covered
  return {
    isKanban, view: state.view, boardShown, handle: boardShown ? editorHandle : null, choose, chooseMode, applyKanban, showBoard,
    revealCard, revealTick, takeReveal,
  }
}

// 입력칸을 연 카드 `from` 또는 칸 `headingFrom`. key 는 연 순간의 위치라 다시 그려도 입력칸이 그대로 남는다 (F-2141 3장)
export type KanbanTarget = { kind: 'card' | 'lane'; key: number; pos: number }

type BoardSnap = { handle: EditorHandle; lanes: KanbanLane[]; target: KanbanTarget | null }

// 줄 머리에서 시작해 줄 전체를 지운 변경은 pos 를 가로지르지 않아 TrackDel 이 못 본다 — 줄 안 한 글자로 지워짐을 함께 본다
function mapTarget(changes: ChangeDesc, pos: number): number | null {
  const next = changes.mapPos(pos, 1, MapMode.TrackDel)
  return next === null || changes.mapPos(pos + 1, 1, MapMode.TrackDel) === null ? null : next
}

export type KanbanBoardState = {
  lanes: KanbanLane[]
  // lanes 와 같은 시점의 좌표
  target: KanbanTarget | null
  // 스냅샷 좌표 → 지금 원문 좌표, 그 사이 지워졌으면 null
  toCurrent: (pos: number) => number | null
  // 지금 원문 좌표로 추적을 시작한다
  track: (kind: KanbanTarget['kind'], pos: number) => void
  untrack: () => void
  // 추적 중인 위치의 지금 원문 좌표
  currentTarget: () => number | null
}

// 보드가 떠 있는 동안만 칸·카드 배열을 든다 — 변경은 표시만 하고 rAF 한 번에 묶어 다시 읽는다 (F-2140 3장)
export function useKanbanBoard(handle: EditorHandle, onTargetLost: () => void): KanbanBoardState {
  const [snap, setSnap] = useState<BoardSnap>(() => ({ handle, lanes: parseKanban(handle.view.state.doc.toString()), target: null }))
  if (snap.handle !== handle) setSnap({ handle, lanes: parseKanban(handle.view.state.doc.toString()), target: null })
  const targetRef = useRef<KanbanTarget | null>(null)
  // 스냅샷 뒤에 쌓인 변경 — 스냅샷 좌표를 지금 원문 좌표로 옮긴다
  const pendingRef = useRef<ChangeDesc | null>(null)
  const lostRef = useRef(onTargetLost)
  useLayoutEffect(() => {
    lostRef.current = onTargetLost
  })

  // 렌더에서 읽은 뒤 구독 전에 변경이 끼지 않게 같은 커밋 layout 단계에서 붙인다
  useLayoutEffect(() => {
    let frame = 0
    targetRef.current = null
    pendingRef.current = null
    const read = () => {
      frame = 0
      pendingRef.current = null
      setSnap({ handle, lanes: parseKanban(handle.view.state.doc.toString()), target: targetRef.current })
    }
    const off = handle.onChanges(({ changes }) => {
      pendingRef.current = pendingRef.current ? pendingRef.current.composeDesc(changes.desc) : changes.desc
      const target = targetRef.current
      if (target) {
        const pos = mapTarget(changes.desc, target.pos)
        targetRef.current = pos === null ? null : { ...target, pos }
        if (pos === null) lostRef.current()
      }
      if (!frame) frame = requestAnimationFrame(read)
    })
    return () => {
      off()
      cancelAnimationFrame(frame)
    }
  }, [handle])

  const toCurrent = useCallback((pos: number) => (pendingRef.current ? mapTarget(pendingRef.current, pos) : pos), [])
  const track = useCallback((kind: KanbanTarget['kind'], pos: number) => {
    const target = { kind, key: pos, pos }
    targetRef.current = target
    // 스냅샷이 지금 원문보다 늦으면 다음 read 가 함께 옮겨 준다
    if (!pendingRef.current) setSnap((prev) => ({ ...prev, target }))
  }, [])
  const untrack = useCallback(() => {
    targetRef.current = null
    setSnap((prev) => (prev.target ? { ...prev, target: null } : prev))
  }, [])
  const currentTarget = useCallback(() => targetRef.current?.pos ?? null, [])

  return { lanes: snap.lanes, target: snap.target, toCurrent, track, untrack, currentTarget }
}
