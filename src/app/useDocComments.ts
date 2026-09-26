// 댓글 훅 — 편집기 핸들 붙이기·떼기, 스레드·레일 좌표·활성·입력 카드 상태, 해시 이동 대기 (specs/features/F-505.md 3.2, 5~8장)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import type * as Y from 'yjs'

import {
  checkCommentBody,
  checkCommentCapacity,
  commentAllowed,
  groupCommentThreads,
  normalizeCommentBody,
  validateCommentEntry,
  type CommentActor,
  type CommentAuthor,
  type CommentEntry,
  type CommentThread,
} from '../lib/docComments'
import { observeCommentKeys, type CommentDraft, type CommentLayout, type EditorComments } from '../editor/commentMarks'
import { commentAccess as computeCommentAccess, commentRailMode, initialCommentRailOpen, type CommentAccess } from './commentRail'
import { getPref, setPref } from './prefs'
import type { NoticeWithAction } from './NoticeBar'

// ----- 3.2 쓰기 실패 사유·결과 -----

export type CommentWriteFailure =
  | 'empty'
  | 'too_long' // 본문 (C2)
  | 'doc_full'
  | 'thread_full' // 한도 (C3)
  | 'gone' // 후보 범위가 지워짐 (C10)
  | 'not_found' // 대상 댓글이 없음 (C9)
  | 'invalid' // 모양 검사 실패 (C11)
  | 'forbidden'
  | 'rate_limited'
  | 'offline' // 명령 경로 전용 — F-506 (C6·C5·C4)
export type CommentWriteResult = { ok: true; id: string } | { ok: false; reason: CommentWriteFailure }

export type CommentWriter = {
  add(input: { draft: CommentDraft; body: string; mentions: string[] }): Promise<CommentWriteResult>
  reply(input: { parent: string; body: string; mentions: string[] }): Promise<CommentWriteResult>
  resolve(threadId: string, resolved: boolean): Promise<CommentWriteResult>
  remove(id: string): Promise<CommentWriteResult>
}

// React 없이 도는 쓰기 — 편집기 Y.Doc 에 트랜잭션 하나씩. U9~U16 이 부른다
export type WriteTarget = { doc: Y.Doc; map: Y.Map<unknown>; author: CommentAuthor; now: () => number; newId: () => string }

function bodyFailure(rawBody: string): CommentWriteFailure | null {
  const err = checkCommentBody(normalizeCommentBody(rawBody))
  if (err === 'empty_body') return 'empty'
  if (err === 'body_too_long') return 'too_long'
  return null
}

function currentThreads(t: Pick<WriteTarget, 'map'>): CommentThread[] {
  return groupCommentThreads(t.map.entries()).threads
}

export function writeNewThread(
  t: WriteTarget,
  input: { draft: CommentDraft; body: string; mentions: string[] },
): CommentWriteResult {
  const bf = bodyFailure(input.body)
  if (bf) return { ok: false, reason: bf }
  const threads = currentThreads(t)
  const capacity = checkCommentCapacity(threads, null)
  if (capacity) return { ok: false, reason: capacity }
  const id = t.newId()
  const entry: CommentEntry = {
    v: 1,
    parent: null,
    anchor: input.draft.anchor,
    quote: input.draft.quote,
    body: normalizeCommentBody(input.body),
    mentions: input.mentions,
    author: t.author,
    createdAt: t.now(),
    resolved: null,
  }
  if (!validateCommentEntry(entry).ok) return { ok: false, reason: 'invalid' }
  t.doc.transact(() => {
    t.map.set(id, entry)
  })
  return { ok: true, id }
}

export function writeReply(t: WriteTarget, input: { parent: string; body: string; mentions: string[] }): CommentWriteResult {
  const bf = bodyFailure(input.body)
  if (bf) return { ok: false, reason: bf }
  const threads = currentThreads(t)
  const parentThread = threads.find((th) => th.id === input.parent)
  if (!parentThread) return { ok: false, reason: 'not_found' }
  const capacity = checkCommentCapacity(threads, input.parent)
  if (capacity) return { ok: false, reason: capacity }
  const id = t.newId()
  const entry: CommentEntry = {
    v: 1,
    parent: input.parent,
    anchor: null,
    quote: '',
    body: normalizeCommentBody(input.body),
    mentions: input.mentions,
    author: t.author,
    createdAt: t.now(),
    resolved: null,
  }
  if (!validateCommentEntry(entry).ok) return { ok: false, reason: 'invalid' }
  t.doc.transact(() => {
    t.map.set(id, entry)
    // 부모가 해결 상태면 같은 트랜잭션에서 다시 연다 (F-500 4.4 2번)
    if (parentThread.root.resolved !== null) {
      t.map.set(input.parent, { ...parentThread.root, resolved: null })
    }
  })
  return { ok: true, id }
}

export function writeResolved(t: WriteTarget, threadId: string, resolved: boolean): CommentWriteResult {
  const thread = currentThreads(t).find((th) => th.id === threadId)
  if (!thread) return { ok: false, reason: 'not_found' }
  const nextEntry: CommentEntry = { ...thread.root, resolved: resolved ? { by: t.author, at: t.now() } : null }
  if (!validateCommentEntry(nextEntry).ok) return { ok: false, reason: 'invalid' }
  t.doc.transact(() => {
    t.map.set(threadId, nextEntry)
  })
  return { ok: true, id: threadId }
}

export function writeDelete(t: WriteTarget, id: string): CommentWriteResult {
  const raw = t.map.get(id)
  if (raw === undefined) return { ok: false, reason: 'not_found' }
  const check = validateCommentEntry(raw)
  if (!check.ok) return { ok: false, reason: 'not_found' }
  const toDelete = [id]
  if (check.entry.parent === null) {
    for (const [otherId, otherRaw] of t.map.entries()) {
      const otherCheck = validateCommentEntry(otherRaw)
      if (otherCheck.ok && otherCheck.entry.parent === id) toDelete.push(otherId)
    }
  }
  t.doc.transact(() => {
    for (const delId of toDelete) t.map.delete(delId)
  })
  return { ok: true, id }
}

export function createDirectCommentWriter(t: WriteTarget): CommentWriter {
  return {
    add: async (input) => writeNewThread(t, input),
    reply: async (input) => writeReply(t, input),
    resolve: async (threadId, resolved) => writeResolved(t, threadId, resolved),
    remove: async (id) => writeDelete(t, id),
  }
}

// ----- 화면 문구 (F-500 5.1, F-505 9장) -----

export const COMMENT_TEXT = {
  selectFirst: '댓글을 달 부분을 먼저 선택하세요.', // C1
  tooLong: '댓글은 1,000자까지 쓸 수 있습니다.', // C2
  docFull: '이 문서의 댓글이 500개에 이르러 더 달 수 없습니다.', // C3
  threadFull: '이 스레드의 답글이 100개에 이르러 더 달 수 없습니다.', // C3
  vaultForbidden: '금고 문서에는 댓글을 달 수 없습니다.', // C7
  unavailable: '이 화면에서는 댓글을 볼 수 없습니다. 실시간 연결이 되면 보입니다.', // C8
  notFound: '댓글을 찾지 못했습니다. 지워졌을 수 있습니다.', // C9
  gone: '댓글을 달 부분이 지워졌습니다. 본문을 다시 선택하세요.', // C10
  invalid: '댓글을 달지 못했습니다.', // C11
}

// ----- 훅 -----

type CommentsHandle = { comments: EditorComments; view: EditorView; focus(): void }

export type ComposerState = { anchorTop: number; sending: boolean; error: string | null }
export type ReplyState = { threadId: string; sending: boolean; error: string | null }

export type PendingCommentTarget = { docId: string; threadId: string }

export type UseDocCommentsInput = {
  containerRef: RefObject<HTMLElement | null>
  handle: CommentsHandle | null
  mountKey: string | null // `${docId}:${remountNonce}` — 바뀔 때마다 문서별 상태를 새로 잡는다
  access: CommentAccess
  viewMode: 'live' | 'raw' | 'view'
  everSynced: boolean
  showNotice: (notice: NoticeWithAction) => void
  changeViewModeToEdit: () => void
}

export type UseDocCommentsResult = {
  access: CommentAccess
  canWrite: boolean
  mode: 'rail' | 'sheet'
  open: boolean
  setOpen: (open: boolean, persist: boolean) => void
  openThreadCount: number
  ready: boolean // 첫 onLayout 이 왔거나(붙지 않는 경로는 곧바로) 초기화가 끝났다
  threads: CommentThread[]
  threadById: Map<string, CommentThread>
  layout: CommentLayout | null
  activeId: string | null
  setActive: (id: string | null) => void
  showResolved: boolean
  setShowResolved: (v: boolean) => void
  orphansOpen: boolean
  setOrphansOpen: (v: boolean) => void
  composer: ComposerState | null
  beginComment: () => void
  sendComposer: (body: string) => void
  cancelComposer: () => void
  reply: ReplyState | null
  startReply: (threadId: string) => void
  sendReply: (threadId: string, body: string) => void
  cancelReply: () => void
  toggleResolve: (threadId: string, resolved: boolean) => void
  removeComment: (id: string) => void
  reveal: (id: string) => void
  actorFor: CommentActor | null
  setPendingTarget: (target: PendingCommentTarget) => void
}

function readRailPref(): 'open' | 'closed' | null {
  const v = getPref('md.commentRail', '')
  return v === 'open' || v === 'closed' ? v : null
}

export function scrollTopOf(view: EditorView, pos: number): number {
  const scroller = view.scrollDOM
  const offset = view.documentTop - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
  return offset + view.lineBlockAt(Math.min(pos, view.state.doc.length)).top
}

export function useDocComments(input: UseDocCommentsInput): UseDocCommentsResult {
  const { containerRef, handle, mountKey, access, viewMode, everSynced, showNotice, changeViewModeToEdit } = input

  const canView = access.kind === 'read' || access.kind === 'write'
  const canWrite = access.kind === 'write'

  const [mainWidth, setMainWidth] = useState(0)
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    function compute() {
      setMainWidth(el!.clientWidth)
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
    // containerRef 는 참조가 안 바뀌는 ref 객체라 mountKey 도 넣어 문서가 열려 .content-area 가 처음 붙는 시점에도 다시 잰다
  }, [containerRef, mountKey])
  const mode = commentRailMode(mainWidth)

  const [open, setOpenState] = useState(false)
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current === mode) return
    prevModeRef.current = mode
    setOpenState((wasOpen) => (mode === 'sheet' ? false : wasOpen))
  }, [mode])

  const setOpen = useCallback((next: boolean, persist: boolean) => {
    setOpenState(next)
    if (persist) setPref('md.commentRail', next ? 'open' : 'closed')
  }, [])

  const [threads, setThreads] = useState<CommentThread[]>([])
  const [layout, setLayout] = useState<CommentLayout | null>(null)
  const [activeId, setActiveIdState] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const [orphansOpen, setOrphansOpen] = useState(false)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [reply, setReply] = useState<ReplyState | null>(null)
  const pendingTargetRef = useRef<PendingCommentTarget | null>(null)
  // 붙인 뒤 첫 onLayout(또는 붙지 않는 경로) 때 한 번 정하는 처음 열림 판정을 이미 했는가 — 렌더 중에 다음 mountKey 와 비교해 조정한다(리액트 "prop 이 바뀌면 상태 조정" 패턴, react-hooks/set-state-in-effect 를 피한다)
  const [initializedFor, setInitializedFor] = useState<string | null | undefined>(undefined)

  const setActive = useCallback(
    (id: string | null) => {
      setActiveIdState(id)
      handle?.comments.setActive(id)
    },
    [handle],
  )

  // 문서를 떠나면 입력 중인 새 댓글·답글을 버린다 (7.1 9번) — 렌더 중 mountKey 변화를 보고 조정
  const [resetFor, setResetFor] = useState(mountKey)
  if (resetFor !== mountKey) {
    setResetFor(mountKey)
    setComposer(null)
    setReply(null)
    setOrphansOpen(false)
    setShowResolved(false)
    setActiveIdState(null)
  }

  // 앵커 밖 누르기로 활성을 끈다 — F-504 는 앵커 밖 클릭을 알리지 않는다(7.5, F-504 4.2)
  useEffect(() => {
    if (!canView || !handle) return
    const dom = handle.view.contentDOM
    function onPointerDown(e: PointerEvent) {
      const raw = e.target as Node | null
      const el = raw instanceof Element ? raw : raw?.parentElement ?? null
      if (el?.closest('.cm-comment-anchor')) return
      setActiveIdState(null)
      handle!.comments.setActive(null)
    }
    dom.addEventListener('pointerdown', onPointerDown)
    return () => dom.removeEventListener('pointerdown', onPointerDown)
  }, [canView, handle])

  // ----- 붙이기·떼기 (2장) -----
  useEffect(() => {
    if (!canView || !handle) return
    const detach = handle.comments.attach({
      onActivate: (id) => {
        setActiveIdState(id)
        handle.comments.setActive(id)
        setOpen(true, false)
      },
      onLayout: (l) => setLayout(l),
    })
    return () => {
      detach()
      setLayout(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, handle, mountKey])

  // ----- 스레드 읽기 (2장) -----
  useEffect(() => {
    if (!canView || !handle) return
    const { map } = handle.comments
    function recompute() {
      setThreads(groupCommentThreads(map.entries()).threads)
    }
    recompute()
    const unobserve = observeCommentKeys(map, recompute)
    return () => {
      unobserve()
      setThreads([])
    }
  }, [canView, handle])

  const openThreadCount = threads.filter((t) => t.root.resolved === null).length

  // ----- 처음 열림(5.1) — 붙인 뒤 첫 onLayout 때, 또는 붙지 않는 경로는 그 순간 0 으로. 렌더 중 조정 -----
  if (initializedFor !== mountKey) {
    if (!canView) {
      setInitializedFor(mountKey)
      setOpenState(initialCommentRailOpen(readRailPref(), 0))
    } else if (layout) {
      setInitializedFor(mountKey)
      setOpenState(initialCommentRailOpen(readRailPref(), openThreadCount))
    }
  }

  const threadById = new Map(threads.map((t) => [t.id, t]))

  const actorFor: CommentActor | null = access.kind === 'write' ? access.actor : null

  const writerRef = useRef<CommentWriter | null>(null)
  useEffect(() => {
    if (!handle || access.kind !== 'write' || access.via !== 'direct') {
      writerRef.current = null
      return
    }
    writerRef.current = createDirectCommentWriter({
      doc: handle.comments.doc,
      map: handle.comments.map,
      author: access.author,
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
    })
  }, [handle, access])

  const reveal = useCallback(
    (id: string) => {
      handle?.comments.reveal(id)
      setActive(id)
    },
    [handle, setActive],
  )

  // ----- 7.6 해시 이동 -----
  // 이미 준비된 문서에 대상을 잡으면 아래 effect 의 다른 의존성이 안 바뀌어 판정이 돌지 않는다 — 잡을 때마다 올려 다시 돌린다
  const [pendingSeq, setPendingSeq] = useState(0)
  const setPendingTarget = useCallback((target: PendingCommentTarget) => {
    pendingTargetRef.current = target
    setPendingSeq((n) => n + 1)
  }, [])

  useEffect(() => {
    const target = pendingTargetRef.current
    if (!target || target.docId !== mountKey?.split(':')[0]) return
    if (access.kind === 'loading') return // 경로 판정을 기다린다
    if (access.kind === 'none') {
      pendingTargetRef.current = null
      showNotice({ type: 'info', message: COMMENT_TEXT.notFound })
      return
    }
    if (access.kind === 'unavailable') {
      pendingTargetRef.current = null
      queueMicrotask(() => setOpen(true, false))
      return
    }
    const ready = everSynced && layout !== null
    if (!ready) return
    pendingTargetRef.current = null
    let threadId = target.threadId
    const replyOwner = threads.find((t) => t.replies.some((r) => r.id === threadId))
    if (replyOwner) threadId = replyOwner.id
    if (layout.anchored.some((a) => a.threadId === threadId)) {
      const thread = threadById.get(threadId)
      if (thread && thread.root.resolved !== null) setShowResolved(true)
      if (viewMode === 'view') changeViewModeToEdit()
      setOpen(true, false)
      reveal(threadId)
    } else if (layout.orphans.includes(threadId)) {
      setOpen(true, false)
      setOrphansOpen(true)
      setActive(threadId)
    } else {
      showNotice({ type: 'info', message: COMMENT_TEXT.notFound })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountKey, access, everSynced, layout, threads, pendingSeq])

  // ----- 7.1 달기 -----
  const beginComment = useCallback(() => {
    if (access.kind === 'none') {
      showNotice({ type: 'info', message: COMMENT_TEXT.vaultForbidden })
      return
    }
    if (access.kind !== 'write' || !handle) return
    if (viewMode !== 'live' && viewMode !== 'raw') return
    const capacity = checkCommentCapacity(threads, null)
    if (capacity === 'doc_full') {
      showNotice({ type: 'error', message: COMMENT_TEXT.docFull })
      return
    }
    const range = handle.comments.beginDraft()
    if (range === null) {
      showNotice({ type: 'info', message: COMMENT_TEXT.selectFirst })
      return
    }
    setReply(null)
    setComposer({ anchorTop: scrollTopOf(handle.view, range.from), sending: false, error: null })
    setOpen(true, false)
  }, [access, handle, viewMode, threads, showNotice, setOpen])

  const cancelComposer = useCallback(() => {
    handle?.comments.clearDraft()
    setComposer(null)
    handle?.focus()
  }, [handle])

  const sendComposer = useCallback(
    (body: string) => {
      if (!composer || !handle) return
      const writer = writerRef.current
      if (!writer) return
      setComposer((c) => (c ? { ...c, sending: true, error: null } : c))
      const draft = handle.comments.takeDraft()
      if (!draft) {
        setComposer((c) => (c ? { ...c, sending: false, error: 'gone' } : c))
        return
      }
      void writer.add({ draft, body, mentions: [] }).then((result) => {
        if (result.ok) {
          setComposer(null)
          setActive(result.id)
          handle.focus()
        } else {
          setComposer((c) => (c ? { ...c, sending: false, error: result.reason } : c))
        }
      })
    },
    [composer, handle, setActive],
  )

  // ----- 7.2 답글 -----
  const startReply = useCallback((threadId: string) => {
    setReply({ threadId, sending: false, error: null })
  }, [])

  const cancelReply = useCallback(() => {
    setReply(null)
  }, [])

  const sendReply = useCallback(
    (threadId: string, body: string) => {
      const writer = writerRef.current
      if (!writer) return
      setReply((r) => (r && r.threadId === threadId ? { ...r, sending: true, error: null } : r))
      void writer.reply({ parent: threadId, body, mentions: [] }).then((result) => {
        if (result.ok) {
          setReply(null)
        } else {
          setReply((r) => (r && r.threadId === threadId ? { ...r, sending: false, error: result.reason } : r))
        }
      })
    },
    [],
  )

  // ----- 7.3 해결·다시 열기 -----
  const toggleResolve = useCallback(
    (threadId: string, resolved: boolean) => {
      const writer = writerRef.current
      if (!writer) return
      void writer.resolve(threadId, resolved).then((result) => {
        if (result.ok && resolved && activeId === threadId) setActive(null)
      })
    },
    [activeId, setActive],
  )

  // ----- 7.4 삭제 -----
  const removeComment = useCallback(
    (id: string) => {
      const writer = writerRef.current
      if (!writer) return
      void writer.remove(id).then((result) => {
        if (result.ok && activeId === id) setActive(null)
      })
    },
    [activeId, setActive],
  )

  return {
    access,
    canWrite,
    mode,
    open,
    setOpen,
    openThreadCount,
    ready: initializedFor === mountKey,
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
    beginComment,
    sendComposer,
    cancelComposer,
    reply,
    startReply,
    sendReply,
    cancelReply,
    toggleResolve,
    removeComment,
    reveal,
    actorFor,
    setPendingTarget,
  }
}

// commentAllowed 를 다시 내보낸다 — 화면이 삭제 메뉴 노출을 스스로 계산 (7.4)
export { commentAllowed, computeCommentAccess }
export type { CommentAccess }
