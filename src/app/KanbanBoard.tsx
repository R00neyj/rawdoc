// 칸반 보드 화면 — 숨긴 편집기의 EditorState 를 읽어 그리고, 고치기는 applyKanban 한 길로 쓴다 (F-2140 3장, F-2141 3장)
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import { setBoardComposing } from '../editor/boardComposition'
import { redoLocal, undoLocal } from '../editor/yBinding'
import { NEW_LANE_TITLE, addCardChange, addLaneChange, editCardChange, parseKanban, renameLaneChange, toggleCardChange } from '../lib/kanban'
import type { NoticeWithAction } from './NoticeBar'
import { useKanbanBoard, type ApplyKanban } from './useKanbanView'

export type KanbanBoardFocus = 'title' | 'board' | null

type KanbanBoardProps = {
  handle: EditorHandle
  title: string
  titleReadOnly: boolean
  readOnly: boolean
  onTitleChange: (value: string) => void
  onTitleCommit: () => void
  onOpenStray: (line: number) => void
  apply: ApplyKanban
  showNotice: (input: NoticeWithAction) => number
  // 문서를 열 때 받은 첫 포커스 요청 — 마운트 때 한 번 쓰고 비운다
  focusRef: RefObject<KanbanBoardFocus>
}

// add = 칸 아래 새 카드, lane = 칸 이름(added 는 `칸 추가` 로 연 것), card = 카드 첫 줄 글자
type Draft = { mode: 'add' | 'card'; value: string } | { mode: 'lane'; value: string; added: boolean }
type FocusRequest = { lane: number; card?: number; what: 'card' | 'title' | 'add' }

const LOST_MESSAGE = '다른 곳에서 지워져 고치지 못했습니다.'

export default function KanbanBoard({
  handle, title, titleReadOnly, readOnly, onTitleChange, onTitleCommit, onOpenStray, apply, showNotice, focusRef,
}: KanbanBoardProps) {
  const boardRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)
  // 포커스 중에는 바깥 제목으로 덮지 않고 blur 뒤 맞춘다 (docTitle.ts latestTitle 과 같은 규칙)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [draft, setDraftState] = useState<Draft | null>(null)
  // blur 가 이미 닫은 입력칸을 다시 쓰지 않게 핸들러는 렌더 값이 아니라 이 거울을 본다
  const draftRef = useRef<Draft | null>(null)
  const focusRequestRef = useRef<FocusRequest | null>(null)
  const [focusTick, setFocusTick] = useState(0)

  const setDraft = useCallback((next: Draft | null) => {
    draftRef.current = next
    setDraftState(next)
  }, [])

  const onTargetLost = useCallback(() => {
    if (!draftRef.current) return
    setDraft(null)
    showNotice({ type: 'info', message: LOST_MESSAGE })
  }, [setDraft, showNotice])

  const board = useKanbanBoard(handle, onTargetLost)
  const { lanes, target } = board
  const editing = readOnly ? null : draft

  const close = (focus: FocusRequest | null) => {
    setDraft(null)
    board.untrack()
    focusRequestRef.current = focus
    setFocusTick((n) => n + 1)
  }

  const lost = () => {
    close(null)
    showNotice({ type: 'info', message: LOST_MESSAGE })
  }

  // 옮긴 위치로 지금 원문을 다시 읽어 칸 번호를 찾는다 (3장 자리 추적)
  const currentLane = (): { text: string; lane: number } | null => {
    const pos = board.currentTarget()
    if (pos === null) return null
    const text = handle.view.state.doc.toString()
    const lane = parseKanban(text).findIndex((l) => l.headingFrom === pos)
    return lane < 0 ? null : { text, lane }
  }

  const currentCard = (): { text: string; pos: number; lane: number; card: number } | null => {
    const pos = board.currentTarget()
    if (pos === null) return null
    const text = handle.view.state.doc.toString()
    const parsed = parseKanban(text)
    for (let lane = 0; lane < parsed.length; lane++) {
      const card = parsed[lane].cards.findIndex((c) => c.from === pos)
      if (card >= 0) return { text, pos, lane, card }
    }
    return null
  }

  const addCard = (value: string): boolean => {
    const at = currentLane()
    if (!at) {
      lost()
      return false
    }
    apply(addCardChange(at.text, at.lane, value), 'kanban.add')
    return true
  }

  // blur 로 끝나면 포커스는 사용자가 옮긴 곳에 둔다
  const finishLane = (value: string | null, added: boolean, refocus: boolean) => {
    const at = currentLane()
    if (!at) return lost()
    if (value !== null) apply(renameLaneChange(at.text, at.lane, value), 'kanban.edit')
    close(refocus ? { lane: at.lane, what: added ? 'add' : 'title' } : null)
  }

  const finishCard = (value: string | null, refocus: boolean) => {
    const at = currentCard()
    if (!at) return lost()
    if (value !== null) apply(editCardChange(at.text, at.pos, value), 'kanban.edit')
    close(refocus ? { lane: at.lane, card: at.card, what: 'card' } : null)
  }

  const startAdd = (headingFrom: number) => {
    const pos = board.toCurrent(headingFrom)
    if (pos === null || readOnly) return
    board.track('lane', pos)
    setDraft({ mode: 'add', value: '' })
  }

  const startRename = (headingFrom: number, value: string) => {
    const pos = board.toCurrent(headingFrom)
    if (pos === null || readOnly) return
    board.track('lane', pos)
    setDraft({ mode: 'lane', value, added: false })
  }

  const startCardEdit = (from: number, value: string) => {
    const pos = board.toCurrent(from)
    if (pos === null || readOnly) return
    board.track('card', pos)
    setDraft({ mode: 'card', value })
  }

  const addLane = () => {
    if (!apply(addLaneChange(handle.view.state.doc.toString(), NEW_LANE_TITLE), 'kanban.add')) return
    const added = parseKanban(handle.view.state.doc.toString()).at(-1)
    if (!added) return
    board.track('lane', added.headingFrom)
    setDraft({ mode: 'lane', value: NEW_LANE_TITLE, added: true })
  }

  const toggle = (from: number) => {
    const pos = board.toCurrent(from)
    if (pos !== null) apply(toggleCardChange(handle.view.state.doc.toString(), pos), 'kanban.toggle')
  }

  const setComposing = (composing: boolean) => setBoardComposing(handle.view, boardRef.current, composing)

  // 숨겨진 편집기가 포커스를 들고 있으면(칸반 판정이 열린 뒤에 난 경우) 보드로 옮겨 숨은 편집기에 글자가 들어가지 않게 한다
  useLayoutEffect(() => {
    const request = focusRef.current
    focusRef.current = null
    const active = document.activeElement
    const inEditor = active instanceof HTMLElement && handle.view.dom.contains(active)
    if (request === 'title' || (inEditor && active.matches('textarea.doc-title'))) {
      titleRef.current?.focus()
      titleRef.current?.select()
    } else if (request === 'board' || inEditor) {
      boardRef.current?.focus()
    }
  }, [handle, focusRef])

  // 입력칸을 닫은 뒤 그 카드·칸 머리·새 칸의 `카드 추가` 로 돌아간다 (3장)
  useLayoutEffect(() => {
    const request = focusRequestRef.current
    const laneEl = request && boardRef.current?.querySelectorAll<HTMLElement>('.kanban-lane')[request.lane]
    if (!request || !laneEl) return
    const selector = request.what === 'card' ? '.kanban-card' : request.what === 'title' ? '.kanban-lane-title' : '.kanban-add-card'
    const el = laneEl.querySelectorAll<HTMLElement>(selector)[request.what === 'card' ? (request.card ?? 0) : 0]
    if (!el) return
    focusRequestRef.current = null
    el.focus()
  }, [focusTick, lanes])

  // 스냅샷 좌표의 추적 위치가 칸·카드 머리가 아니게 됐다 — 줄 머리 기호만 지워진 경우
  const targetLane = target ? lanes.findIndex((l) => (target.kind === 'lane' ? l.headingFrom === target.pos : l.cards.some((c) => c.from === target.pos))) : -1
  const orphaned = editing !== null && target !== null && targetLane < 0
  const { untrack } = board
  useLayoutEffect(() => {
    if (!orphaned) return
    untrack()
    onTargetLost()
  }, [orphaned, untrack, onTargetLost])

  const onBoardKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target
    if ((t instanceof HTMLInputElement && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement) return
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    const command = key === 'z' ? (e.shiftKey ? redoLocal : undoLocal) : key === 'y' && e.ctrlKey && !e.shiftKey ? redoLocal : null
    if (!command) return
    e.preventDefault()
    command(handle.view)
  }

  const inputHandlers = {
    onChange: (value: string) => draftRef.current && setDraft({ ...draftRef.current, value }),
    onComposing: setComposing,
  }

  return (
    <div ref={boardRef} className="kanban-board" role="region" aria-label="칸반 보드" tabIndex={-1} onKeyDown={onBoardKeyDown}>
      <input
        ref={titleRef}
        className="kanban-title"
        aria-label="문서 제목"
        value={titleDraft ?? title}
        readOnly={titleReadOnly}
        placeholder={titleReadOnly ? '' : '제목 없는 문서'}
        onFocus={() => setTitleDraft(title)}
        onChange={(e) => {
          setTitleDraft(e.target.value)
          onTitleChange(e.target.value)
        }}
        onBlur={() => {
          setTitleDraft(null)
          onTitleCommit()
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          boardRef.current?.focus()
        }}
      />
      {lanes.length === 0 && <p className="kanban-empty">칸이 없습니다. ## 로 시작하는 줄 하나가 칸 하나가 됩니다.</p>}
      {(lanes.length > 0 || !readOnly) && (
        <div className="kanban-lanes">
          {lanes.map((lane, laneIndex) => {
            const name = lane.title || '이름 없는 칸'
            const isTargetLane = laneIndex === targetLane && target !== null
            const renaming = isTargetLane && editing?.mode === 'lane'
            const adding = isTargetLane && editing?.mode === 'add'
            return (
              <section key={isTargetLane ? `edit-${target.key}` : laneIndex} className="kanban-lane" aria-label={name}>
                <header className="kanban-lane-head">
                  {renaming ? (
                    <BoardInput
                      className="kanban-lane-input"
                      label="칸 이름"
                      value={editing.value}
                      select={editing.added}
                      {...inputHandlers}
                      onEnter={() => finishLane(draftRef.current?.value ?? '', editing.added, true)}
                      onEscape={() => finishLane(null, editing.added, true)}
                      onBlur={() => draftRef.current && finishLane(draftRef.current.value, editing.added, false)}
                    />
                  ) : (
                    <h2
                      className="kanban-lane-title"
                      tabIndex={readOnly ? undefined : 0}
                      onClick={readOnly ? undefined : () => startRename(lane.headingFrom, lane.title)}
                      onKeyDown={
                        readOnly
                          ? undefined
                          : (e) => {
                              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
                              e.preventDefault()
                              startRename(lane.headingFrom, lane.title)
                            }
                      }
                    >
                      {name}
                    </h2>
                  )}
                  <span className="kanban-lane-count">{lane.cards.length}</span>
                </header>
                <ul className="kanban-cards">
                  {lane.cards.map((card, cardIndex) => {
                    const cardEditing = isTargetLane && editing?.mode === 'card' && target.kind === 'card' && card.from === target.pos
                    return (
                      <li
                        key={cardEditing ? `edit-${target.key}` : cardIndex}
                        className="kanban-card"
                        tabIndex={0}
                        onDoubleClick={(e) => {
                          if (!cardEditing && !(e.target instanceof HTMLInputElement)) startCardEdit(card.from, card.text)
                        }}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== 'F2') || e.nativeEvent.isComposing) return
                          e.preventDefault()
                          startCardEdit(card.from, card.text)
                        }}
                      >
                        {card.done !== null && (
                          <input
                            type="checkbox"
                            className="kanban-card-check"
                            aria-label="완료"
                            checked={card.done}
                            disabled={readOnly}
                            onChange={() => toggle(card.from)}
                          />
                        )}
                        {cardEditing ? (
                          <BoardInput
                            className="kanban-card-input"
                            label="카드 내용"
                            value={editing.value}
                            {...inputHandlers}
                            onEnter={() => finishCard(draftRef.current?.value ?? '', true)}
                            onEscape={() => finishCard(null, true)}
                            onBlur={() => draftRef.current && finishCard(draftRef.current.value, false)}
                          />
                        ) : (
                          <span className="kanban-card-text">{card.text}</span>
                        )}
                        {card.detail.length > 0 && <div className="kanban-card-detail">{card.detail.join('\n')}</div>}
                      </li>
                    )
                  })}
                </ul>
                {adding ? (
                  <BoardInput
                    className="kanban-card-input"
                    label="새 카드"
                    placeholder="카드 내용"
                    value={editing.value}
                    {...inputHandlers}
                    onEnter={() => {
                      const value = draftRef.current?.value ?? ''
                      if (value.trim() !== '' && addCard(value)) setDraft({ mode: 'add', value: '' })
                    }}
                    onEscape={() => close({ lane: laneIndex, what: 'add' })}
                    onBlur={() => {
                      if (!draftRef.current) return
                      const value = draftRef.current.value
                      if (value.trim() === '' || addCard(value)) close(null)
                    }}
                  />
                ) : (
                  !readOnly && (
                    <button type="button" className="kanban-add-card" onClick={() => startAdd(lane.headingFrom)}>
                      <span aria-hidden="true">+</span> 카드 추가
                    </button>
                  )
                )}
                {lane.strayLines.length > 0 && (
                  <button type="button" className="kanban-stray" onClick={() => onOpenStray(lane.strayLines[0])}>
                    {`카드가 아닌 줄 ${lane.strayLines.length}개`}
                  </button>
                )}
              </section>
            )
          })}
          {!readOnly && (
            <button type="button" className="kanban-add-lane" onClick={addLane}>
              <span aria-hidden="true">+</span> 칸 추가
            </button>
          )}
        </div>
      )}
    </div>
  )
}

type BoardInputProps = {
  className: string
  label: string
  placeholder?: string
  value: string
  select?: boolean
  onChange: (value: string) => void
  onComposing: (composing: boolean) => void
  onEnter: () => void
  onEscape: () => void
  onBlur: () => void
}

function BoardInput({ className, label, placeholder, value, select, onChange, onComposing, onEnter, onEscape, onBlur }: BoardInputProps) {
  const ref = useRef<HTMLInputElement | null>(null)
  const composingRef = useRef(false)
  const composingCb = useRef(onComposing)
  useLayoutEffect(() => {
    composingCb.current = onComposing
  })

  useLayoutEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    if (select) input.select()
    else input.setSelectionRange(input.value.length, input.value.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번만 포커스한다
  }, [])

  // 조합 중에 사라지면 compositionend 가 오지 않는다 — 게이트 보류가 남지 않게 끝을 알린다
  useLayoutEffect(
    () => () => {
      if (composingRef.current) composingCb.current(false)
    },
    [],
  )

  const setComposing = (composing: boolean) => {
    composingRef.current = composing
    onComposing(composing)
  }

  return (
    <input
      ref={ref}
      className={className}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key !== 'Enter' && e.key !== 'Escape') return
        e.preventDefault()
        e.stopPropagation()
        if (e.key === 'Enter') onEnter()
        else onEscape()
      }}
      onBlur={() => {
        if (composingRef.current) setComposing(false)
        onBlur()
      }}
    />
  )
}
