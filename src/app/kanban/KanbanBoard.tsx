// 칸반 보드 화면 — 숨긴 편집기의 EditorState 를 읽어 그리고, 고치기는 applyKanban 한 길로 쓴다 (F-2140 3장, F-2141 3장, F-2142)
import {
  Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject,
} from 'react'
import type { EditorHandle } from '../../editor/Editor'
import type { WikiContext } from '../../editor/preview/wikiLinks'
import { renderMarkdownInline } from '../../viewer/renderMarkdown'
import type { ResolveAttachment } from '../../viewer/fillMarkdownAssets'
import type { OnImageFiles } from '../../editor/imageInsert'
import { cardImageView } from '../../lib/kanban/kanbanImages'
import { setBoardComposing } from '../../editor/boardComposition'
import { redoLocal, undoLocal } from '../../editor/yBinding'
import {
  NEW_LANE_TITLE, addCardChange, addLaneChange, cardDraft, editCardChange, kanbanDetailLines, moveCardChanges, moveLaneChanges, parseKanban, removeCardChange, removeLaneChange,
  removeCheckChange, renameLaneChange, toggleCardChange, toggleCheckChange, type KanbanLane,
} from '../../lib/kanban/kanban'
import { IconMore } from '../icons'
import { getPref } from '../prefs'
import {
  KANBAN_LONG_PRESS_MS, dropSlot, edgeScroll, keyMoveTarget, laneMoveTarget, mapCardPos, moveTarget, neighborCard, pickupState, type KanbanDir,
} from './kanbanDrag'
import KanbanMenu, { type KanbanMenuActions, type KanbanMenuState, type KanbanMenuTarget } from './KanbanMenu'
import type { NoticeWithAction } from '../notices/NoticeBar'
import BoardInput from './BoardInput'
import KanbanCardImages from './KanbanCardImages'
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
  // 카드 글자의 위키링크 — 보기 모드와 같은 해석·열기
  resolveWikiLink: (target: string) => string | null
  onOpenWikiLink: (target: string, heading: string | null) => void
  // 카드 입력칸 `[[` 자동완성 문맥 — 편집기와 같은 것
  wikiContext: WikiContext
  apply: ApplyKanban
  showNotice: (input: NoticeWithAction) => number
  // 문서를 열 때 받은 첫 포커스 요청 — 마운트 때 한 번 쓰고 비운다
  focusRef: RefObject<KanbanBoardFocus>
  onOpenSettings: () => void
  // 할 일 패널에서 누른 카드 줄 — tick 이 바뀌거나 처음 그릴 때 한 번 받아 간다 (small 2026-10-14)
  revealTick: number
  takeReveal: () => number | null
  // 카드 썸네일 첨부 읽기 — 보기 모드와 같은 것
  resolveAttachment?: ResolveAttachment
  // 카드 입력칸 이미지 붙여넣기 — 편집기와 같은 저장 콜백
  onImageFiles?: OnImageFiles
}

// add = 칸 아래 새 카드, lane = 칸 이름(added 는 `칸 추가` 로 연 것), card = 카드 첫 줄 글자
type Draft = { mode: 'add' | 'card'; value: string } | { mode: 'lane'; value: string; added: boolean }
// stale = 옮기기 직전 스냅샷 — 다음 스냅샷이 그려진 뒤에 포커스한다
type FocusRequest = { lane: number; card?: number; what: 'card' | 'title' | 'add'; stale?: KanbanLane[] }
type CardAt = { lane: number; card: number }
type MoveTo = { lane: number; index: number }
// 끌거나 키로 옮기는 카드의 지금 원문 위치. el 은 키로 옮긴 뒤 아직 포커스가 못 따라간 카드, 끌기면 null
type Moving = { pos: number; el: HTMLElement | null; lost?: () => void }

const LOST_MESSAGE = '다른 곳에서 지워져 고치지 못했습니다.'
const UNNAMED_LANE = '이름 없는 칸'
const ARROWS: Partial<Record<string, KanbanDir>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const detailIndent = () => ' '.repeat(Number(getPref('md.indent', '4')))

export default function KanbanBoard({
  handle, title, titleReadOnly, readOnly, onTitleChange, onTitleCommit, onOpenStray, resolveWikiLink, onOpenWikiLink, wikiContext, apply, showNotice, focusRef, onOpenSettings,
  revealTick, takeReveal, resolveAttachment, onImageFiles,
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
  const [live, setLive] = useState('')
  const movingRef = useRef<Moving | null>(null)

  // 입력칸 자리 추적(board.track)과 따로 옮긴다 — 끄는 사이 그 카드가 지워지면 끌기를 조용히 끝낸다 (F-2142 3장)
  useLayoutEffect(
    () =>
      handle.onChanges(({ changes }) => {
        const moving = movingRef.current
        if (!moving) return
        const pos = mapCardPos(changes.desc, moving.pos)
        if (pos !== null) {
          moving.pos = pos
          return
        }
        movingRef.current = null
        moving.lost?.()
      }),
    [handle],
  )

  // 지금 원문을 다시 읽어 옮기고, 포커스는 다음 스냅샷에서 옮긴 카드로 (F-2142 3·4장)
  const moveCard = (pos: number, pick: (from: CardAt, parsed: KanbanLane[]) => MoveTo | null, el: HTMLElement | null) => {
    const text = handle.view.state.doc.toString()
    const parsed = parseKanban(text)
    const from = cardAt(parsed, pos)
    const to = from && pick(from, parsed)
    if (!from || !to) return
    movingRef.current = null
    if (!apply(moveCardChanges(text, from, to), 'kanban.move')) return
    const lane = parseKanban(handle.view.state.doc.toString())[to.lane]
    const moved = lane?.cards[to.index]
    if (!moved) return
    if (el) movingRef.current = { pos: moved.from, el }
    setLive(`${moved.text} — ${lane.title || UNNAMED_LANE} ${to.index + 1}번째`)
    focusRequestRef.current = { lane: to.lane, card: to.index, what: 'card', stale: lanes }
    setFocusTick((n) => n + 1)
  }

  // 칸 머리 위치로 지금 원문을 다시 읽어 옮기고, 포커스는 옮긴 칸 이름으로
  const moveLane = (pos: number, to: number | 'left' | 'right') => {
    const text = handle.view.state.doc.toString()
    const parsed = parseKanban(text)
    const from = parsed.findIndex((l) => l.headingFrom === pos)
    const index = from < 0 ? null : laneMoveTarget(from, parsed.length, to)
    movingRef.current = null
    if (index === null || !apply(moveLaneChanges(text, from, index), 'kanban.moveLane')) return
    setLive(`${parsed[from].title || UNNAMED_LANE} 칸 ${index + 1}번째`)
    focusRequestRef.current = { lane: index, what: 'title', stale: lanes }
    setFocusTick((n) => n + 1)
  }

  const drag = useCardDrag(boardRef, {
    track: (from, cancel) => {
      const pos = board.toCurrent(from)
      if (pos === null) return false
      movingRef.current = { pos, el: null, lost: cancel }
      return true
    },
    drop: (at) => {
      const moving = movingRef.current
      if (!moving || moving.el !== null) return
      if (at.kind === 'lane') moveLane(moving.pos, at.slot)
      else moveCard(moving.pos, (from) => moveTarget(from, at.lane, at.slot), null)
    },
    release: () => {
      if (movingRef.current?.el === null) movingRef.current = null
    },
  })

  // Alt+방향키는 카드를 옮기고(Alt+← 뒤로 가기도 막는다), 방향키만은 옆 카드로 포커스를 옮긴다 (F-2142 4장)
  const onCardArrow = (e: KeyboardEvent<HTMLLIElement>, at: CardAt, cardFrom: number) => {
    const dir = ARROWS[e.key]
    if (!dir || e.ctrlKey || e.metaKey || e.shiftKey) return
    const counts = lanes.map((l) => l.cards.length)
    if (e.altKey) {
      e.preventDefault()
      const el = e.currentTarget
      const pending = movingRef.current
      const pos = pending !== null && pending.el === el ? pending.pos : board.toCurrent(cardFrom)
      if (pos === null || readOnly) return
      moveCard(pos, (from, parsed) => keyMoveTarget(from, parsed.map((l) => l.cards.length), dir), el)
      return
    }
    const next = neighborCard(at, counts, dir)
    const el = next && cardElement(boardRef.current, next)
    if (!el) return
    e.preventDefault()
    el.focus()
  }

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
    const at = cardAt(parseKanban(text), pos)
    return at && { text, pos, ...at }
  }

  const addCard = (value: string): boolean => {
    const at = currentLane()
    if (!at) {
      lost()
      return false
    }
    apply(addCardChange(at.text, at.lane, value, getPref('md.kanbanNewCardCheck', 'on') === 'on', detailIndent()), 'kanban.add')
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
    if (value !== null) apply(editCardChange(at.text, at.pos, value, detailIndent()), 'kanban.edit')
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

  // 메뉴는 스냅샷 번호로 연다 — 고를 때 지금 원문 위치로 옮겨 읽는다
  const snapCardPos = (lane: number, card: number) => {
    const found = lanes[lane]?.cards[card]
    return found ? board.toCurrent(found.from) : null
  }
  const snapLanePos = (lane: number) => (lanes[lane] ? board.toCurrent(lanes[lane].headingFrom) : null)
  const undoNotice = (message: string) => showNotice({ type: 'info', message, action: { label: '되돌리기', onClick: () => undoLocal(handle.view) } })

  const removeLane = (lane: number) => {
    const pos = snapLanePos(lane)
    const text = handle.view.state.doc.toString()
    const parsed = parseKanban(text)
    const index = parsed.findIndex((l) => l.headingFrom === pos)
    if (index < 0 || !apply(removeLaneChange(text, index), 'kanban.removeLane')) return
    const { title, cards } = parsed[index]
    if (cards.length > 0) undoNotice(`칸 "${title || UNNAMED_LANE}"과 카드 ${cards.length}개를 지웠습니다.`)
    if (parsed.length === 1) return boardRef.current?.focus()
    focusRequestRef.current = { lane: Math.max(0, index - 1), what: 'title', stale: lanes }
    setFocusTick((n) => n + 1)
  }

  const removeCard = (lane: number, card: number) => {
    const pos = snapCardPos(lane, card)
    const text = handle.view.state.doc.toString()
    const at = pos === null ? null : cardAt(parseKanban(text), pos)
    if (pos === null || !at || !apply(removeCardChange(text, pos), 'kanban.removeCard')) return
    undoNotice('카드를 지웠습니다.')
    const left = parseKanban(handle.view.state.doc.toString())[at.lane]?.cards.length ?? 0
    focusRequestRef.current = left > 0 ? { lane: at.lane, card: Math.min(at.card, left - 1), what: 'card', stale: lanes } : { lane: at.lane, what: 'add', stale: lanes }
    setFocusTick((n) => n + 1)
  }

  const menuActions: KanbanMenuActions = {
    editCard: (lane, card) => {
      const found = lanes[lane]?.cards[card]
      if (found) startCardEdit(found.from, cardDraft(found))
    },
    toggleCheck: (lane, card) => {
      const pos = snapCardPos(lane, card)
      if (pos !== null) apply(toggleCheckChange(handle.view.state.doc.toString(), pos), 'kanban.toggle')
    },
    removeCheck: (lane, card) => {
      const pos = snapCardPos(lane, card)
      if (pos !== null) apply(removeCheckChange(handle.view.state.doc.toString(), pos), 'kanban.toggle')
    },
    moveCardTo: (lane, card, toLane) => {
      const pos = snapCardPos(lane, card)
      if (pos !== null) moveCard(pos, (from, parsed) => (from.lane === toLane ? null : { lane: toLane, index: parsed[toLane]?.cards.length ?? 0 }), null)
    },
    showSource: (lane, card) => {
      const pos = snapCardPos(lane, card)
      if (pos !== null) onOpenStray(handle.view.state.doc.lineAt(pos).number)
    },
    removeCard,
    renameLane: (lane) => lanes[lane] && startRename(lanes[lane].headingFrom, lanes[lane].title),
    moveLane: (lane, dir) => {
      const pos = snapLanePos(lane)
      if (pos !== null) moveLane(pos, dir)
    },
    removeLane,
    addLane: () => addLane(),
    openSettings: onOpenSettings,
  }

  const [menu, setMenu] = useState<KanbanMenuState | null>(null)
  const openMenu = (target: KanbanMenuTarget, x: number, y: number, returnFocus: HTMLElement | null) => setMenu({ target, x, y, returnFocus })
  // 메뉴가 닫히며 포커스가 갈 곳을 잃으면 연 자리로 돌린다 — 항목이 포커스를 옮겼으면 그대로
  const closeMenu = () => {
    const back = menu?.returnFocus
    setMenu(null)
    requestAnimationFrame(() => {
      if (back?.isConnected && (document.activeElement === document.body || document.activeElement === null)) back.focus()
    })
  }
  const openMenuFrom = (target: KanbanMenuTarget, button: HTMLElement, returnFocus: HTMLElement | null) => {
    const r = button.getBoundingClientRect()
    openMenu(target, r.left, r.bottom + 2, returnFocus)
  }

  // 입력칸·링크·열린 메뉴 안은 브라우저 메뉴 그대로, 휴대폰 길게 누르기는 끌기 몫이라 열지 않는다
  const onBoardContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target instanceof Element ? e.target : null
    const native = e.nativeEvent as MouseEvent & { pointerType?: string }
    if (readOnly || e.defaultPrevented || !t || native.pointerType === 'touch' || t.closest('input, textarea, a, .item-menu-list, .cm-editor')) return
    const laneEl = t.closest<HTMLElement>('.kanban-lanes > .kanban-lane')
    const laneEls = Array.from(boardRef.current?.querySelectorAll<HTMLElement>('.kanban-lanes > .kanban-lane') ?? [])
    const lane = laneEl ? laneEls.indexOf(laneEl) : -1
    const cardEl = laneEl && t.closest<HTMLElement>('.kanban-cards > .kanban-card')
    const card = cardEl ? Array.from(laneEl.querySelectorAll('.kanban-cards > .kanban-card')).indexOf(cardEl) : -1
    // 카드 밖 칸 자리(머리·빈 칸·`카드 추가` 둘레)는 칸 `⋯` 와 같은 메뉴 (tweak 2026-10-14)
    const target: KanbanMenuTarget = card >= 0 ? { kind: 'card', lane, card } : lane >= 0 ? { kind: 'lane', lane } : { kind: 'board' }
    const headEl = laneEl?.querySelector<HTMLElement>('.kanban-lane-head') ?? null
    const anchor = cardEl ?? headEl ?? boardRef.current
    e.preventDefault()
    const returnFocus = target.kind === 'lane' ? headEl?.querySelector<HTMLElement>('.kanban-lane-title') ?? null : anchor
    // Shift+F10·메뉴 키는 좌표가 0 이라 그 요소 아래에 연다
    if (e.clientX === 0 && e.clientY === 0 && anchor) openMenuFrom(target, anchor, returnFocus)
    else openMenu(target, e.clientX, e.clientY, returnFocus)
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

  // 입력칸을 닫은 뒤 그 카드·칸 머리·새 칸의 `카드 추가` 로, 옮긴 뒤에는 옮긴 카드로 돌아간다 (F-2141 3장, F-2142 3장)
  useLayoutEffect(() => {
    const request = focusRequestRef.current
    const laneEl = request && request.stale !== lanes && boardRef.current?.querySelectorAll<HTMLElement>('.kanban-lane')[request.lane]
    if (!request || !laneEl) return
    const selector = request.what === 'card' ? '.kanban-cards > .kanban-card' : request.what === 'title' ? '.kanban-lane-title' : '.kanban-add-card'
    const el = laneEl.querySelectorAll<HTMLElement>(selector)[request.what === 'card' ? (request.card ?? 0) : 0]
    if (!el) return
    focusRequestRef.current = null
    if (movingRef.current?.el) movingRef.current = null
    el.focus()
  }, [focusTick, lanes])

  // 할 일 패널에서 누른 카드로 스크롤하고 잠깐 강조한다 — 포커스도 옮겨 키보드로 이어 쓴다
  useLayoutEffect(() => {
    const line = takeReveal()
    const doc = handle.view.state.doc
    if (line === null || line > doc.lines) return
    const at = cardAt(parseKanban(doc.toString()), doc.line(line).from)
    const el = at && cardElement(boardRef.current, at)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    el.focus({ preventScroll: true })
    el.classList.add('kanban-card--reveal')
    el.addEventListener('animationend', () => el.classList.remove('kanban-card--reveal'), { once: true })
  }, [revealTick, takeReveal, handle])

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
    if ((t instanceof HTMLInputElement && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement || (t instanceof Element && t.closest('.cm-editor'))) return
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    const key = e.key.toLowerCase()
    const command = key === 'z' ? (e.shiftKey ? redoLocal : undoLocal) : key === 'y' && e.ctrlKey && !e.shiftKey ? redoLocal : null
    if (!command) return
    e.preventDefault()
    command(handle.view)
  }

  // 카드 글자 속 위키링크는 보기 모드처럼 문서를 연다 (Viewer handleClick 과 같은 규칙)
  const onBoardClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const anchor = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a.wikilink') : null
    if (!anchor) return
    e.preventDefault()
    const wikiTarget = anchor.dataset.wikilink
    if (wikiTarget !== undefined) onOpenWikiLink(wikiTarget, anchor.dataset.wikilinkHeading ?? null)
  }

  const inputHandlers = {
    onChange: (value: string) => draftRef.current && setDraft({ ...draftRef.current, value }),
    onComposing: setComposing,
  }

  return (
    <div
      ref={boardRef}
      className="kanban-board"
      role="region"
      aria-label="칸반 보드"
      tabIndex={-1}
      data-readonly={readOnly ? '' : undefined}
      data-dragging={drag.dragging ? '' : undefined}
      onKeyDown={onBoardKeyDown}
      onClick={onBoardClick}
      onContextMenu={onBoardContextMenu}
    >
      <div className="kanban-head">
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
        {!readOnly && (
          <MoreButton
            label="보드"
            expanded={menu?.target.kind === 'board'}
            onOpen={(button) => openMenuFrom({ kind: 'board' }, button, button)}
            onClose={closeMenu}
          />
        )}
      </div>
      {lanes.length === 0 && <p className="kanban-empty">칸이 없습니다. ## 로 시작하는 줄 하나가 칸 하나가 됩니다.</p>}
      {(lanes.length > 0 || !readOnly) && (
        <div className="kanban-lanes">
          {lanes.map((lane, laneIndex) => {
            const name = lane.title || UNNAMED_LANE
            const isTargetLane = laneIndex === targetLane && target !== null
            const renaming = isTargetLane && editing?.mode === 'lane'
            const adding = isTargetLane && editing?.mode === 'add'
            const laneHeld = drag.held?.kind === 'lane' && drag.held.lane === laneIndex
            return (
              <Fragment key={isTargetLane ? `edit-${target.key}` : laneIndex}>
              {drag.marker?.kind === 'lane' && drag.marker.slot === laneIndex && <div className="kanban-lane-drop-marker" aria-hidden="true" />}
              <section
                className={`kanban-lane${laneHeld ? ' kanban-lane--dragging' : ''}${renaming && editing.added ? ' kanban-lane--added' : ''}`}
                aria-label={name}
              >
                {!readOnly && !renaming && (
                  <div
                    className="kanban-lane-grip"
                    aria-hidden="true"
                    title="끌어서 칸 옮기기"
                    onPointerDown={(e) => drag.start(e, { kind: 'lane', lane: laneIndex }, lane.headingFrom)}
                    onContextMenu={drag.blockLongPressMenu}
                  />
                )}
                <header
                  className="kanban-lane-head"
                  onPointerDown={readOnly || renaming ? undefined : (e) => drag.start(e, { kind: 'lane', lane: laneIndex }, lane.headingFrom)}
                  onContextMenu={drag.blockLongPressMenu}
                >
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
                      title={name}
                      tabIndex={readOnly ? undefined : 0}
                      onClick={readOnly ? undefined : () => startRename(lane.headingFrom, lane.title)}
                      onKeyDown={
                        readOnly
                          ? undefined
                          : (e) => {
                              if (e.nativeEvent.isComposing) return
                              const dir = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null
                              if (dir && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                                e.preventDefault()
                                const pos = board.toCurrent(lane.headingFrom)
                                if (pos !== null) moveLane(pos, dir)
                                return
                              }
                              if (e.key !== 'Enter') return
                              e.preventDefault()
                              startRename(lane.headingFrom, lane.title)
                            }
                      }
                    >
                      {name}
                    </h2>
                  )}
                  <span className="kanban-lane-count">{lane.cards.length}</span>
                  {!readOnly && (
                    <MoreButton
                      label={`${name} 칸`}
                      expanded={menu?.target.kind === 'lane' && menu.target.lane === laneIndex}
                      onOpen={(button) => openMenuFrom({ kind: 'lane', lane: laneIndex }, button, button)}
                      onClose={closeMenu}
                    />
                  )}
                </header>
                <ul className="kanban-cards">
                  {lane.cards.map((card, cardIndex) => {
                    const cardEditing = isTargetLane && editing?.mode === 'card' && target.kind === 'card' && card.from === target.pos
                    const held = drag.held?.kind === 'card' && drag.held.lane === laneIndex && drag.held.card === cardIndex
                    const view = cardImageView(card.text, kanbanDetailLines(card.detail))
                    return (
                      <Fragment key={cardEditing ? `edit-${target.key}` : cardIndex}>
                        {drag.marker?.kind === 'card' && drag.marker.lane === laneIndex && drag.marker.slot === cardIndex && (
                          <li className="kanban-drop-marker" aria-hidden="true" />
                        )}
                        <li
                          className={held ? 'kanban-card kanban-card--dragging' : 'kanban-card'}
                          tabIndex={0}
                          onPointerDown={readOnly || cardEditing ? undefined : (e) => drag.start(e, { kind: 'card', lane: laneIndex, card: cardIndex }, card.from)}
                          onContextMenu={drag.blockLongPressMenu}
                          onDoubleClick={(e) => {
                            if (!cardEditing && !(e.target instanceof Element && e.target.closest('input, a, button, .cm-editor'))) startCardEdit(card.from, cardDraft(card))
                          }}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget || e.nativeEvent.isComposing) return
                            if (e.key !== 'Enter' && e.key !== 'F2') return onCardArrow(e, { lane: laneIndex, card: cardIndex }, card.from)
                            e.preventDefault()
                            startCardEdit(card.from, cardDraft(card))
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
                              multiline={{ indent: detailIndent() }}
                              wikiContext={wikiContext}
                              onImageFiles={readOnly ? undefined : onImageFiles}
                              {...inputHandlers}
                              onEnter={() => finishCard(draftRef.current?.value ?? '', true)}
                              onEscape={() => finishCard(null, true)}
                              onBlur={() => draftRef.current && finishCard(draftRef.current.value, false)}
                            />
                          ) : (
                            <span className="kanban-card-text" dangerouslySetInnerHTML={{ __html: renderMarkdownInline(view.text, { resolveWikiLink }) }} />
                          )}
                          {!cardEditing && view.lines.length > 0 && (
                            <div className="kanban-card-detail">
                              {view.lines.map((line, i) => (
                                <div key={i} className="kanban-detail-line" style={{ '--detail-indent': line.indent } as CSSProperties}>
                                  {line.kind !== 'text' && (
                                    <span className="kanban-detail-mark" aria-hidden="true">
                                      {line.kind === 'check' ? (line.done ? '☑' : '☐') : line.indent > 0 ? '◦' : '•'}
                                    </span>
                                  )}
                                  <span dangerouslySetInnerHTML={{ __html: renderMarkdownInline(line.text, { resolveWikiLink }) }} />
                                </div>
                              ))}
                            </div>
                          )}
                          {!cardEditing && view.images.length > 0 && <KanbanCardImages images={view.images} resolveAttachment={resolveAttachment} />}
                          {!readOnly && !cardEditing && (
                            <MoreButton
                              label="카드"
                              expanded={menu?.target.kind === 'card' && menu.target.lane === laneIndex && menu.target.card === cardIndex}
                              onOpen={(button) => openMenuFrom({ kind: 'card', lane: laneIndex, card: cardIndex }, button, button.closest('li'))}
                              onClose={closeMenu}
                            />
                          )}
                        </li>
                      </Fragment>
                    )
                  })}
                  {drag.marker?.kind === 'card' && drag.marker.lane === laneIndex && drag.marker.slot === lane.cards.length && (
                    <li className="kanban-drop-marker" aria-hidden="true" />
                  )}
                </ul>
                {adding ? (
                  <BoardInput
                    className="kanban-card-input"
                    label="새 카드"
                    placeholder="카드 내용"
                    value={editing.value}
                    multiline={{ indent: detailIndent() }}
                    wikiContext={wikiContext}
                    onImageFiles={readOnly ? undefined : onImageFiles}
                    {...inputHandlers}
                    onEnter={() => {
                      const value = draftRef.current?.value ?? ''
                      if (value.split('\n')[0].trim() !== '' && addCard(value)) setDraft({ mode: 'add', value: '' })
                    }}
                    onEscape={() => close({ lane: laneIndex, what: 'add' })}
                    onBlur={() => {
                      if (!draftRef.current) return
                      const value = draftRef.current.value
                      if (value.split('\n')[0].trim() === '' || addCard(value)) close(null)
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
              </Fragment>
            )
          })}
          {drag.marker?.kind === 'lane' && drag.marker.slot === lanes.length && <div className="kanban-lane-drop-marker" aria-hidden="true" />}
          {!readOnly && (
            <button type="button" className="kanban-add-lane" onClick={addLane}>
              <span aria-hidden="true">+</span> 칸 추가
            </button>
          )}
        </div>
      )}
      <p className="kanban-live" aria-live="polite">
        {live}
      </p>
      {menu && !readOnly && <KanbanMenu menu={menu} lanes={lanes} unnamed={UNNAMED_LANE} actions={menuActions} onClose={closeMenu} />}
    </div>
  )
}

function cardAt(lanes: KanbanLane[], pos: number): CardAt | null {
  for (let lane = 0; lane < lanes.length; lane++) {
    const card = lanes[lane].cards.findIndex((c) => c.from === pos)
    if (card >= 0) return { lane, card }
  }
  return null
}

function cardElement(board: HTMLElement | null, at: CardAt): HTMLElement | null {
  const lane = board?.querySelectorAll<HTMLElement>('.kanban-lane')[at.lane]
  return lane?.querySelectorAll<HTMLElement>('.kanban-cards > .kanban-card')[at.card] ?? null
}

type DragItem = { kind: 'card'; lane: number; card: number } | { kind: 'lane'; lane: number }
// 카드는 칸 lane 의 카드 틈, 칸은 칸 줄의 틈 — slot 은 끄는 것이 자리에 남은 기준
type DropAt = { kind: 'card'; lane: number; slot: number } | { kind: 'lane'; slot: number }
type DragCallbacks = {
  // 누른 카드·칸 머리를 지금 원문 좌표로 추적하기 시작한다. 이미 지워졌으면 false
  track: (from: number, cancel: () => void) => boolean
  drop: (at: DropAt) => void
  release: () => void
}
type Gesture = { pointerId: number; picked: boolean; cancel: () => void }

// 마우스·터치·펜 한 길의 카드·칸 끌기 — 집기 판정, 복제·놓을 자리, 가장자리 자동 스크롤 (F-2142 3장)
function useCardDrag(boardRef: RefObject<HTMLDivElement | null>, callbacks: DragCallbacks) {
  const [held, setHeld] = useState<DragItem | null>(null)
  const [marker, setMarker] = useState<DropAt | null>(null)
  const [dragging, setDragging] = useState(false)
  const gestureRef = useRef<Gesture | null>(null)
  const touchPressRef = useRef(false)
  const callbacksRef = useRef(callbacks)
  useLayoutEffect(() => {
    callbacksRef.current = callbacks
  })

  // 집은 뒤에는 브라우저 스크롤을 막는다 — React 의 터치 리스너는 passive 라 직접 단다
  useEffect(() => {
    const board = boardRef.current
    if (!board) return
    const block = (e: TouchEvent) => {
      if (gestureRef.current?.picked && e.cancelable) e.preventDefault()
    }
    board.addEventListener('touchmove', block, { passive: false })
    return () => {
      board.removeEventListener('touchmove', block)
      gestureRef.current?.cancel()
    }
  }, [boardRef])

  const start = (e: ReactPointerEvent<HTMLElement>, item: DragItem, from: number) => {
    const pointerType = e.pointerType === 'mouse' ? 'mouse' : e.pointerType === 'pen' ? 'pen' : 'touch'
    touchPressRef.current = pointerType !== 'mouse'
    const target = e.target instanceof Element ? e.target : null
    if (gestureRef.current || !e.isPrimary || e.button !== 0 || target?.closest('input, button, textarea, a, .cm-editor')) return
    const el = e.currentTarget
    const startX = e.clientX
    const startY = e.clientY
    const startTime = performance.now()
    let x = startX
    let y = startY
    let timer = 0
    let frame = 0
    let ghost: HTMLElement | null = null
    let drop: DropAt | null = null

    const locate = () => {
      if (ghost) ghost.style.transform = `translate(${x - startX}px, ${y - startY}px)`
      const next = item.kind === 'lane' ? laneDropAt(boardRef.current, x) : dropAt(boardRef.current, x, y)
      drop = next
      setMarker((prev) => {
        const sameLane = (prev?.kind === 'card' ? prev.lane : null) === (next?.kind === 'card' ? next.lane : null)
        return prev?.kind === next?.kind && prev?.slot === next?.slot && sameLane ? prev : next
      })
    }
    const tick = () => {
      frame = requestAnimationFrame(tick)
      if (scrollEdges(boardRef.current, drop, x, y)) locate()
    }
    const pick = () => {
      window.clearTimeout(timer)
      gesture.picked = true
      try {
        el.setPointerCapture(gesture.pointerId)
      } catch {
        // 이미 뗀 포인터 — 이어지는 pointerup 이 끝낸다
      }
      ghost = makeGhost(item.kind === 'lane' ? (el.closest<HTMLElement>('.kanban-lane') ?? el) : el, item.kind === 'lane' ? 'kanban-lane' : 'kanban-card')
      boardRef.current?.append(ghost)
      window.getSelection()?.removeAllRanges()
      setHeld(item)
      setDragging(true)
      locate()
      frame = requestAnimationFrame(tick)
    }
    // 타이머와 움직임이 함께 부른다 — 집거나, 스크롤로 넘기거나, 더 기다린다
    const judge = () => {
      const next = pickupState({ pointerType, dx: x - startX, dy: y - startY, elapsedMs: performance.now() - startTime })
      if (next === 'pick') pick()
      else if (next === 'cancel') end(false)
      return next
    }
    const wait = () => {
      timer = window.setTimeout(() => {
        if (judge() === 'wait') wait()
      }, Math.max(1, KANBAN_LONG_PRESS_MS - (performance.now() - startTime)))
    }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== gesture.pointerId) return
      x = ev.clientX
      y = ev.clientY
      if (gesture.picked) locate()
      else judge()
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId === gesture.pointerId) end(gesture.picked)
    }
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === gesture.pointerId) end(false)
    }
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape' || !gesture.picked) return
      ev.preventDefault()
      ev.stopPropagation()
      end(false)
    }
    const end = (commit: boolean) => {
      if (gestureRef.current !== gesture) return
      gestureRef.current = null
      window.clearTimeout(timer)
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      ghost?.remove()
      if (commit && drop) callbacksRef.current.drop(drop)
      callbacksRef.current.release()
      if (!gesture.picked) return
      // 집었다 놓은 뒤 따라오는 click 이 칸 이름 고치기를 열지 않게 한 번 삼킨다
      const swallow = (ev: MouseEvent) => ev.stopPropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0)
      setHeld(null)
      setMarker(null)
      // 밀기 훅은 같은 손가락의 touchend 에서 data-dragging 을 본다 — pointerup 다음 작업에서 내린다
      window.setTimeout(() => setDragging(false), 0)
    }
    const gesture: Gesture = { pointerId: e.pointerId, picked: false, cancel: () => end(false) }

    if (!callbacksRef.current.track(from, gesture.cancel)) return
    gestureRef.current = gesture
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    if (pointerType !== 'mouse') wait()
  }

  // 길게 눌러 뜨는 메뉴만 막는다 — 마우스 오른쪽 단추는 그대로
  const blockLongPressMenu = (e: ReactMouseEvent) => {
    if (touchPressRef.current) e.preventDefault()
  }

  return { held, marker, dragging, start, blockLongPressMenu }
}

// 포인터 x 가 든 칸, 그 칸 카드들의 세로 가운데로 자리 — 칸 줄 밖이면 null
function dropAt(board: HTMLElement | null, x: number, y: number): DropAt | null {
  const row = board?.querySelector<HTMLElement>('.kanban-lanes')
  if (!row) return null
  const box = row.getBoundingClientRect()
  if (x < box.left || x >= box.right) return null
  const laneEls = row.querySelectorAll<HTMLElement>(':scope > .kanban-lane')
  for (let lane = 0; lane < laneEls.length; lane++) {
    const r = laneEls[lane].getBoundingClientRect()
    if (x < r.left || x >= r.right) continue
    const mids = Array.from(laneEls[lane].querySelectorAll<HTMLElement>('.kanban-cards > .kanban-card'), (card) => {
      const c = card.getBoundingClientRect()
      return c.top + c.height / 2
    })
    return { kind: 'card', lane, slot: dropSlot(mids, y) }
  }
  return null
}

// 칸 끌기 — 칸들의 가로 가운데로 틈을 고른다. 칸 줄 밖이면 null
function laneDropAt(board: HTMLElement | null, x: number): DropAt | null {
  const row = board?.querySelector<HTMLElement>('.kanban-lanes')
  if (!row) return null
  const box = row.getBoundingClientRect()
  if (x < box.left || x >= box.right) return null
  const mids = Array.from(row.querySelectorAll<HTMLElement>(':scope > .kanban-lane'), (lane) => {
    const r = lane.getBoundingClientRect()
    return r.left + r.width / 2
  })
  return { kind: 'lane', slot: dropSlot(mids, x) }
}

// 칸 줄은 가로로, 세로는 그 칸 목록이 스크롤되면 목록을 아니면 보드를 민다. 움직였으면 true
function scrollEdges(board: HTMLElement | null, at: DropAt | null, x: number, y: number): boolean {
  const row = board?.querySelector<HTMLElement>('.kanban-lanes')
  if (!board || !row) return false
  const list = at?.kind === 'card' ? row.querySelectorAll<HTMLElement>(':scope > .kanban-lane')[at.lane]?.querySelector<HTMLElement>('.kanban-cards') : null
  const column = list && list.scrollHeight > list.clientHeight + 1 ? list : board
  const movedX = nudge(row, 'x', x)
  return nudge(column, 'y', y) || movedX
}

function nudge(el: HTMLElement, axis: 'x' | 'y', pos: number): boolean {
  const r = el.getBoundingClientRect()
  const delta = axis === 'x' ? edgeScroll(pos, r.left, r.right) : edgeScroll(pos, r.top, r.bottom)
  if (delta === 0) return false
  const before = axis === 'x' ? el.scrollLeft : el.scrollTop
  if (axis === 'x') el.scrollLeft += delta
  else el.scrollTop += delta
  return (axis === 'x' ? el.scrollLeft : el.scrollTop) !== before
}

// 손가락·커서를 따라가는 복제 — 체크 칸 checked 는 속성이 아니라 값이라 따로 옮긴다
function makeGhost(source: HTMLElement, kindClass: string): HTMLElement {
  const rect = source.getBoundingClientRect()
  const ghost = source.cloneNode(true) as HTMLElement
  ghost.className = `${kindClass} kanban-drag-ghost`
  ghost.removeAttribute('tabindex')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.style.left = `${rect.left}px`
  ghost.style.top = `${rect.top}px`
  ghost.style.width = `${rect.width}px`
  const copies = ghost.querySelectorAll<HTMLInputElement>('.kanban-card-check')
  source.querySelectorAll<HTMLInputElement>('.kanban-card-check').forEach((check, i) => {
    if (copies[i]) copies[i].checked = check.checked
  })
  return ghost
}

// 칸 머리·카드의 `⋯` — 누르면 보드의 메뉴를 이 버튼 아래에 연다. 열린 채 누르면 닫는다
function MoreButton({ label, expanded, onOpen, onClose }: { label: string; expanded: boolean; onOpen: (button: HTMLElement) => void; onClose: () => void }) {
  return (
    <button
      type="button"
      className="item-menu-btn kanban-more"
      aria-label={`${label} 메뉴`}
      aria-haspopup="menu"
      aria-expanded={expanded}
      // 메뉴의 바깥 누르기 닫기가 먼저 닫아 다시 열리지 않게 한다
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => (expanded ? onClose() : onOpen(e.currentTarget))}
    >
      <IconMore size={16} />
    </button>
  )
}

