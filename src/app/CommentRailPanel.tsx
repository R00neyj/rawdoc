// 레일·판 — 파일 이름은 스펙의 CommentRail.tsx 대신 CommentRailPanel — commentRail.ts 와 대소문자만 달라 tsc 가 막음(F-505 5·6장)

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import CommentThread from './CommentThread'
import CommentComposer from './CommentComposer'
import { layoutRailCards, COMMENT_CARD_GAP, type CommentAccess } from './commentRail'
import { checkCommentCapacity, type CommentActor, type CommentThread as CommentThreadData } from '../lib/docComments'
import type { CommentLayout } from '../editor/commentMarks'
import { COMMENT_TEXT, type CommentWriteFailure, type ComposerState, type ReplyState } from './useDocComments'

type CommentRailProps = {
  mode: 'rail' | 'sheet'
  open: boolean
  onClose: () => void
  access: CommentAccess
  ready: boolean
  canWrite: boolean
  threads: CommentThreadData[]
  threadById: Map<string, CommentThreadData>
  layout: CommentLayout | null
  activeId: string | null
  setActive: (id: string | null) => void
  showResolved: boolean
  setShowResolved: (v: boolean) => void
  orphansOpen: boolean
  setOrphansOpen: (v: boolean) => void
  composer: ComposerState | null
  sendComposer: (body: string) => void
  cancelComposer: () => void
  reply: ReplyState | null
  startReply: (threadId: string) => void
  sendReply: (threadId: string, body: string) => void
  toggleResolve: (threadId: string, resolved: boolean) => void
  removeComment: (id: string) => void
  reveal: (id: string) => void
  actorFor: CommentActor | null
  scrollElement: HTMLElement | null
  focusEditor: () => void
}

const HEAD_ID = 'comment-rail-head-title'

export default function CommentRailPanel({
  mode,
  open,
  onClose,
  access,
  ready,
  canWrite,
  threads,
  threadById,
  layout,
  activeId,
  setActive,
  showResolved,
  setShowResolved,
  orphansOpen,
  setOrphansOpen,
  composer,
  sendComposer,
  cancelComposer,
  reply,
  startReply,
  sendReply,
  toggleResolve,
  removeComment,
  reveal,
  actorFor,
  scrollElement,
  focusEditor,
}: CommentRailProps) {
  const headRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const trackWrapRef = useRef<HTMLDivElement | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // 카드 높이 — state 로 둬 렌더 중 ref 를 읽지 않는다(react-hooks/refs). 값 자체가 바뀔 때만 새 Map
  const [cardHeights, setCardHeights] = useState<Map<string, number>>(() => new Map())

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [open])

  const mentionable = actorFor?.kind === 'server'

  const anchoredVisible = useMemo(() => {
    if (!layout) return []
    return layout.anchored
      .map((place) => threadById.get(place.threadId))
      .filter((t): t is CommentThreadData => Boolean(t) && (showResolved || t!.root.resolved === null))
  }, [layout, threadById, showResolved])

  const anchoredTops = useMemo(() => {
    const map = new Map<string, number>()
    if (layout) for (const place of layout.anchored) map.set(place.threadId, place.top)
    return map
  }, [layout])

  const orphanThreads = useMemo(() => {
    if (!layout) return []
    return layout.orphans
      .map((id) => threadById.get(id))
      .filter((t): t is CommentThreadData => Boolean(t) && (showResolved || t!.root.resolved === null))
  }, [layout, threadById, showResolved])

  // ----- 5.2 카드 정렬 (레일만) -----
  type Card = { id: string; thread: CommentThreadData | null; anchorTop: number }
  const cards: Card[] = useMemo(() => {
    const list: Card[] = anchoredVisible.map((t) => ({ id: t.id, thread: t, anchorTop: anchoredTops.get(t.id) ?? 0 }))
    if (composer) {
      list.push({ id: 'draft', thread: null, anchorTop: composer.anchorTop })
      list.sort((a, b) => a.anchorTop - b.anchorTop)
    }
    return list
  }, [anchoredVisible, anchoredTops, composer])

  const tops = useMemo(() => {
    if (mode !== 'rail') return []
    const inputs = cards.map((c) => ({ id: c.id, anchorTop: c.anchorTop, height: cardHeights.get(c.id) ?? 1 }))
    const activeForLayout = composer ? 'draft' : activeId
    return layoutRailCards(inputs, activeForLayout, COMMENT_CARD_GAP, 0)
  }, [cards, activeId, composer, mode, cardHeights])

  function measureCard(id: string, el: HTMLElement | null) {
    if (!el) return
    const h = el.getBoundingClientRect().height
    setCardHeights((prev) => {
      if (prev.get(id) === h) return prev
      const next = new Map(prev)
      next.set(id, h)
      return next
    })
  }

  useEffect(() => {
    if (mode !== 'rail' || typeof ResizeObserver === 'undefined') return
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setCardHeights((prev) => {
        let next: Map<string, number> | null = null
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.cardId
          if (!id) continue
          const h = entry.contentRect.height
          if (prev.get(id) !== h) {
            if (!next) next = new Map(prev)
            next.set(id, h)
          }
        }
        return next ?? prev
      })
    })
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [mode, cards.length])

  // ----- 5.3 스크롤 따라가기 -----
  useLayoutEffect(() => {
    if (mode !== 'rail' || !scrollElement) return
    function apply() {
      const track = trackRef.current
      if (!track) return
      const headH = headRef.current?.offsetHeight ?? 0
      track.style.transform = `translateY(${-(headH + scrollElement!.scrollTop)}px)`
    }
    apply()
    scrollElement.addEventListener('scroll', apply, { passive: true })
    return () => scrollElement.removeEventListener('scroll', apply)
  }, [mode, scrollElement, tops])

  // 카드 영역이 스스로 스크롤하지 않게 — 포커스 이동으로 생기는 스크롤을 되돌린다 (5.3 끝)
  useEffect(() => {
    if (mode !== 'rail') return
    const el = trackWrapRef.current
    if (!el) return
    function reset() {
      el!.scrollTop = 0
    }
    el.addEventListener('scroll', reset, { passive: true })
    return () => el.removeEventListener('scroll', reset)
  }, [mode])

  function activateAndMaybeClose(id: string) {
    reveal(id)
    if (mode === 'sheet') onClose()
  }

  const replyCapacityFor = (threadId: string) => checkCommentCapacity(threads, threadId)

  let body: ReactNode
  if (access.kind === 'loading' || !ready) {
    body = <p className="comment-rail-empty">불러오는 중…</p>
  } else if (access.kind === 'unavailable') {
    body = <p className="comment-rail-empty">{COMMENT_TEXT.unavailable}</p>
  } else if (!composer && cards.length === 0) {
    if (threads.length === 0) {
      body = <p className="comment-rail-empty">{canWrite ? '이 문서에 댓글이 없습니다. 본문을 선택하고 댓글을 달아 보세요.' : '이 문서에 댓글이 없습니다.'}</p>
    } else {
      body = <p className="comment-rail-empty">열린 댓글이 없습니다.</p>
    }
  } else {
    body = (
      <div className="comment-rail-track-wrap" ref={trackWrapRef}>
        <div className="comment-rail-track" ref={mode === 'rail' ? trackRef : undefined}>
          {cards.map((card, i) => (
            <div
              key={card.id}
              data-card-id={card.id}
              className="comment-card-slot"
              style={mode === 'rail' ? { transform: `translateY(${tops[i] ?? card.anchorTop}px)`, visibility: card.id === 'draft' || cardHeights.has(card.id) ? 'visible' : 'hidden' } : undefined}
              ref={mode === 'rail' ? (el) => measureCard(card.id, el) : undefined}
            >
              {card.thread ? (
                <CommentThread
                  thread={card.thread}
                  active={composer ? false : activeId === card.id}
                  isOrphan={false}
                  now={now}
                  actor={actorFor}
                  canWrite={canWrite}
                  replyPending={reply && reply.threadId === card.id ? { sending: reply.sending, error: reply.error as CommentWriteFailure | null } : null}
                  replyCapacity={activeId === card.id ? replyCapacityFor(card.id) : null}
                  onActivate={() => activateAndMaybeClose(card.id)}
                  onToggleResolve={() => toggleResolve(card.id, card.thread!.root.resolved === null)}
                  onStartReply={() => startReply(card.id)}
                  onSendReply={(body) => sendReply(card.id, body)}
                  onDelete={removeComment}
                  onEscapeToEditor={focusEditor}
                />
              ) : (
                composer && (
                  <CommentComposer
                    sending={composer.sending}
                    error={composer.error as CommentWriteFailure | null}
                    mentionable={mentionable}
                    onSend={sendComposer}
                    onCancel={cancelComposer}
                  />
                )
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const orphanCount = orphanThreads.length
  const containerRef = useRef<HTMLElement | null>(null)

  // 6장 — 판 바깥 pointerdown 으로 닫기. 앵커·거터·상단바 댓글 버튼은 예외
  useEffect(() => {
    if (mode !== 'sheet' || !open) return
    function handlePointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement
      if (containerRef.current?.contains(target)) return
      if (target.closest('.cm-comment-anchor, .cm-comment-gutter-marker, .comment-rail-toggle')) return
      onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [mode, open, onClose])

  const content = (
    <>
      <div className="comment-rail-head" ref={headRef}>
        <h2 id={HEAD_ID}>댓글</h2>
        <label className="comment-rail-resolved-toggle">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          해결된 댓글 보기
        </label>
        {mode === 'sheet' && (
          <button type="button" className="comment-sheet-close" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
      {body}
      {orphanCount > 0 && (
        <div className="comment-orphans">
          <button type="button" className="comment-orphans-head" aria-expanded={orphansOpen} onClick={() => setOrphansOpen(!orphansOpen)}>
            본문이 지워진 댓글 {orphanCount}
          </button>
          {orphansOpen && (
            <div className="comment-orphans-list">
              {orphanThreads.map((t) => (
                <CommentThread
                  key={t.id}
                  thread={t}
                  active={activeId === t.id}
                  isOrphan
                  now={now}
                  actor={actorFor}
                  canWrite={canWrite}
                  replyPending={reply && reply.threadId === t.id ? { sending: reply.sending, error: reply.error as CommentWriteFailure | null } : null}
                  replyCapacity={activeId === t.id ? replyCapacityFor(t.id) : null}
                  onActivate={() => setActive(t.id)}
                  onToggleResolve={() => toggleResolve(t.id, t.root.resolved === null)}
                  onStartReply={() => startReply(t.id)}
                  onSendReply={(body) => sendReply(t.id, body)}
                  onDelete={removeComment}
                  onEscapeToEditor={focusEditor}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )

  if (mode === 'rail') {
    return (
      <aside className="comment-rail" aria-label="댓글" ref={containerRef as RefObject<HTMLElement>}>
        {content}
      </aside>
    )
  }
  return (
    <section
      className="comment-sheet"
      role="dialog"
      aria-modal="false"
      aria-label="댓글"
      ref={containerRef as RefObject<HTMLElement>}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      {content}
    </section>
  )
}
