// 댓글 훅 — 편집기 핸들 붙이기·떼기, 스레드·레일 좌표·활성·입력 카드 상태, 해시 이동 대기 (specs/features/F-505.md 3.2, 5~8장)
import { createContext, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import type * as Y from 'yjs'

import {
  checkCommentBody,
  checkCommentCapacity,
  commentAllowed,
  groupCommentThreads,
  normalizeCommentBody,
  validateCommentEntry,
  type AnchorRange,
  type CommentActor,
  type CommentAuthor,
  type CommentEntry,
  type CommentRecord,
  type CommentThread,
} from '../lib/docComments'
import { restoreCommentEntries, resolveCommentAnchor, toCommentRecord } from '../lib/commentAnchor'
import { observeCommentKeys, type CommentDraft, type CommentLayout, type EditorComments } from '../editor/commentMarks'
import { createCommandCommentWriter, type CommandCommentWriter, type CommentCommandClient } from './commentOps'
import { commentAccess as computeCommentAccess, commentRailMode, initialCommentRailOpen, type CommentAccess } from './commentRail'
import { getPref, setPref } from './prefs'
import type { NoticeWithAction } from './NoticeBar'
import type { LineEnding } from '../types'

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
  | 'no_response' // 명령에 10초 동안 서버 응답이 없음 (C12, F-506)
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

// ----- 로컬 문서 댓글 저장·되살리기 (specs/features/F-508.md 3.3) — React 없이 도는 순수 함수 -----

// 되살리기 트랜잭션의 origin — 이 origin 의 변화는 저장을 부르지 않는다
export const LOCAL_COMMENT_RESTORE_ORIGIN: object = {}

// 저장 때 기록 만들기 — 스레드마다 첫 댓글 → 답글 순. 첫 댓글 범위는 ranges 에 있으면 그 값, 없으면 그 자리에서 푼다
export function buildLocalCommentRecords(input: {
  map: Y.Map<unknown>
  ytext: Y.Text
  text: string
  ranges: ReadonlyMap<string, AnchorRange | null>
}): CommentRecord[] {
  const { map, ytext, text, ranges } = input
  const { threads } = groupCommentThreads(map.entries())
  const records: CommentRecord[] = []
  for (const thread of threads) {
    const range = ranges.has(thread.id) ? (ranges.get(thread.id) ?? null) : resolveCommentAnchor(ytext, thread.root.anchor)
    records.push(toCommentRecord(thread.id, thread.root, text, range))
    for (const reply of thread.replies) {
      records.push(toCommentRecord(reply.id, reply.entry, text, null))
    }
  }
  return records
}

// 다시 열 때 기록에서 새 Y.Doc 에 심는다. map 이 비어 있지 않으면 두 번 심기를 막기 위해 아무것도 하지 않는다
export function restoreLocalComments(
  target: { doc: Y.Doc; map: Y.Map<unknown>; ytext: Y.Text },
  records: readonly CommentRecord[],
): { restored: number; orphaned: number } {
  if (target.map.size > 0) return { restored: 0, orphaned: 0 }
  const { entries, orphaned } = restoreCommentEntries(target.ytext, records)
  target.doc.transact(() => {
    for (const [id, entry] of entries) target.map.set(id, entry)
  }, LOCAL_COMMENT_RESTORE_ORIGIN)
  return { restored: entries.length, orphaned }
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
  sending: '보내는 중…', // F-506 7.2
  offline: '연결되면 댓글을 달 수 있습니다.', // C4
  rateLimited: '댓글을 너무 빨리 달고 있습니다. 잠시 뒤 다시 시도하세요.', // C5
  forbidden: '댓글을 달 권한이 없습니다.', // C6
  noResponse: '서버가 응답하지 않아 반영하지 못했습니다. 잠시 뒤 다시 시도하세요.', // C12
  localReadFailed: '이 문서의 댓글을 불러오지 못했습니다. 새로고침하면 다시 읽습니다.', // L1 (F-508)
}

// 명령 경로의 실패 중 알림 띠로 뜨는 것 (F-506 7.2). 해결·삭제는 입력칸이 없어 offline 도 띠로
function commandFailureNotice(reason: CommentWriteFailure, withInput: boolean): NoticeWithAction | null {
  if (reason === 'rate_limited') return { type: 'info', message: COMMENT_TEXT.rateLimited }
  if (reason === 'forbidden') return { type: 'error', message: COMMENT_TEXT.forbidden }
  if (reason === 'no_response') return { type: 'error', message: COMMENT_TEXT.noResponse }
  if (reason === 'offline' && !withInput) return { type: 'info', message: COMMENT_TEXT.offline }
  return null
}

// 명령 경로 상태 — 입력 카드·카드가 CommentRailPanel 을 거치지 않고 읽는다 (F-506 7.2)
export type CommentCommandState = { disconnected: boolean; busy: ReadonlySet<string> }
export const CommentCommandContext = createContext<CommentCommandState>({ disconnected: false, busy: new Set() })

// ----- 훅 -----

type CommentsHandle = { comments: EditorComments; view: EditorView; focus(): void; getText(lineEnding: LineEnding): string }

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
  // 읽기 전용 세션의 명령 클라이언트 (F-506 6.3). 없으면 null
  commands: CommentCommandClient | null
  // 경로가 local 일 때만 App 이 넘긴다 (F-508.md 3.3·6장)
  localComments?: {
    load(docId: string): Promise<CommentRecord[]> // store.getCommentRecords
    onChange(): void // docSaver.notifyCommentsChange
  }
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
  commandState: CommentCommandState
  // useDocSaver 의 getComments 로 넘긴다 — 되살리기를 마친 로컬 마운트일 때만 값, 그 밖은 null (F-508.md 3.3)
  localCommentRecords(): CommentRecord[] | null
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
  const { containerRef, handle, mountKey, access: rawAccess, viewMode, everSynced, showNotice, changeViewModeToEdit, commands, localComments } = input

  // 되살리기 상태 — 로컬 경로에서만 쓴다. 읽기 실패면 이 마운트 동안 접근을 read 로 낮춘다 (F-508.md 6.1·6.3)
  const [localRestore, setLocalRestore] = useState<{ mountKey: string | null; status: 'pending' | 'ready' | 'failed' }>({
    mountKey: null,
    status: 'pending',
  })
  const localReadOnly =
    rawAccess.kind === 'write' &&
    rawAccess.via === 'direct' &&
    Boolean(localComments) &&
    localRestore.mountKey === mountKey &&
    localRestore.status === 'failed'
  // localReadOnly 일 때마다 새 객체를 만들면 아래 useCallback 들의 deps 가 매 렌더 바뀐다 — 값으로 메모한다
  const access: CommentAccess = useMemo(() => (localReadOnly ? { kind: 'read' } : rawAccess), [localReadOnly, rawAccess])

  const canView = access.kind === 'read' || access.kind === 'write'
  const canWrite = access.kind === 'write'

  // App 이 매 렌더 새 객체를 넘겨도 붙이기·관찰 effect 가 덩달아 다시 돌지 않게 ref 로 받는다
  const localCommentsRef = useRef(localComments)
  useEffect(() => {
    localCommentsRef.current = localComments
  })

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

  // ----- 붙이기·떼기, 로컬은 되살리기 먼저(2장, F-508.md 6.1) -----
  const detachRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!canView || !handle || !mountKey) return
    let cancelled = false

    function doAttach() {
      if (cancelled) return
      const detach = handle!.comments.attach({
        onActivate: (id) => {
          setActiveIdState(id)
          handle!.comments.setActive(id)
          setOpen(true, false)
        },
        onLayout: (l) => setLayout(l),
      })
      detachRef.current = detach
    }

    const localOpt = localCommentsRef.current
    if (localOpt) {
      const docId = mountKey.split(':')[0]
      setLocalRestore({ mountKey, status: 'pending' })
      localOpt
        .load(docId)
        .then((records) => {
          if (cancelled) return
          restoreLocalComments(handle.comments, records)
          setLocalRestore({ mountKey, status: 'ready' })
          doAttach()
        })
        .catch((err) => {
          if (cancelled) return
          console.error('local_comments_read_failed', docId, err)
          showNotice({ type: 'error', message: COMMENT_TEXT.localReadFailed })
          setLocalRestore({ mountKey, status: 'failed' })
          doAttach()
        })
    } else {
      doAttach()
    }

    return () => {
      cancelled = true
      detachRef.current?.()
      detachRef.current = null
      setLayout(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, handle, mountKey])

  // ----- 로컬 저장 알리기 — 되살리기 origin 이 아닌 변화마다(5.2 끝) -----
  useEffect(() => {
    if (!localCommentsRef.current || !handle) return
    if (localRestore.mountKey !== mountKey || localRestore.status === 'pending') return
    const { map, doc } = handle.comments
    let touched = false
    let restoreOnly = true
    const onMap = (event: Y.YMapEvent<unknown>) => {
      touched = true
      if (event.transaction.origin !== LOCAL_COMMENT_RESTORE_ORIGIN) restoreOnly = false
    }
    const onAfter = () => {
      if (touched && !restoreOnly) localCommentsRef.current?.onChange()
      touched = false
      restoreOnly = true
    }
    map.observe(onMap)
    doc.on('afterTransaction', onAfter)
    return () => {
      map.unobserve(onMap)
      doc.off('afterTransaction', onAfter)
    }
  }, [handle, mountKey, localRestore])

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
  // 쓰기 수단은 경로·작성자·편집기가 바뀔 때만 새로 — 명령 쓰기 수단의 같은 id 기억(F-506 6.7)이 렌더마다 사라지지 않게
  const writeVia = access.kind === 'write' ? access.via : null
  const authorId = access.kind === 'write' ? access.author.id : null
  const authorEmail = access.kind === 'write' ? access.author.email : null
  useEffect(() => {
    if (!handle || writeVia === null) {
      writerRef.current = null
      return
    }
    if (writeVia === 'command') {
      if (!commands) {
        writerRef.current = null
        return
      }
      const writer: CommandCommentWriter = createCommandCommentWriter({ client: commands, map: handle.comments.map, newId: () => crypto.randomUUID() })
      writerRef.current = writer
      return () => {
        writer.dispose()
        if (writerRef.current === writer) writerRef.current = null
      }
    }
    writerRef.current = createDirectCommentWriter({
      doc: handle.comments.doc,
      map: handle.comments.map,
      author: authorId === null ? { id: null, email: null } : { id: authorId, email: authorEmail! },
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
    })
  }, [handle, writeVia, authorId, authorEmail, commands])

  // 명령 add 가 잠깐의 실패로 끝났을 때 꺼낸 후보 — 다음 보내기가 takeDraft 대신 쓴다 (F-506 7.3)
  const heldDraftRef = useRef<CommentDraft | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const markBusy = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      if (prev.has(id) === on) return prev
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])
  const disconnected = access.kind === 'write' && access.via === 'command' && !access.connected
  const commandState = useMemo(() => ({ disconnected, busy }), [disconnected, busy])

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
    heldDraftRef.current = null
    setReply(null)
    setComposer({ anchorTop: scrollTopOf(handle.view, range.from), sending: false, error: null })
    setOpen(true, false)
  }, [access, handle, viewMode, threads, showNotice, setOpen])

  const cancelComposer = useCallback(() => {
    heldDraftRef.current = null
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
      const draft = heldDraftRef.current ?? handle.comments.takeDraft()
      heldDraftRef.current = null
      if (!draft) {
        setComposer((c) => (c ? { ...c, sending: false, error: 'gone' } : c))
        return
      }
      void writer.add({ draft, body, mentions: [] }).then((result) => {
        if (result.ok) {
          setComposer(null)
          setActive(result.id)
          handle.focus()
          return
        }
        const reason = result.reason
        if (reason === 'offline' || reason === 'no_response' || reason === 'rate_limited') heldDraftRef.current = draft
        const notice = commandFailureNotice(reason, true)
        if (notice) showNotice(notice)
        setComposer((c) => (c ? { ...c, sending: false, error: notice ? null : reason } : c))
      })
    },
    [composer, handle, setActive, showNotice],
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
          return
        }
        const notice = commandFailureNotice(result.reason, true)
        if (notice) showNotice(notice)
        setReply((r) => (r && r.threadId === threadId ? { ...r, sending: false, error: notice ? null : result.reason } : r))
      })
    },
    [showNotice],
  )

  // ----- 7.3 해결·다시 열기 -----
  const toggleResolve = useCallback(
    (threadId: string, resolved: boolean) => {
      const writer = writerRef.current
      if (!writer) return
      markBusy(threadId, true)
      void writer.resolve(threadId, resolved).then((result) => {
        markBusy(threadId, false)
        if (result.ok && resolved && activeId === threadId) setActive(null)
        const notice = result.ok ? null : commandFailureNotice(result.reason, false)
        if (notice) showNotice(notice)
      })
    },
    [activeId, setActive, markBusy, showNotice],
  )

  // ----- 7.4 삭제 -----
  const removeComment = useCallback(
    (id: string) => {
      const writer = writerRef.current
      if (!writer) return
      markBusy(id, true)
      void writer.remove(id).then((result) => {
        markBusy(id, false)
        if (result.ok && activeId === id) setActive(null)
        const notice = result.ok ? null : commandFailureNotice(result.reason, false)
        if (notice) showNotice(notice)
      })
    },
    [activeId, setActive, markBusy, showNotice],
  )

  // useDocSaver 의 getComments 로 넘긴다 — 되살리기를 마친 로컬 마운트일 때만 값 (F-508.md 3.3)
  const localCommentRecords = useCallback((): CommentRecord[] | null => {
    if (!localCommentsRef.current || !handle) return null
    if (localRestore.mountKey !== mountKey || localRestore.status !== 'ready') return null
    return buildLocalCommentRecords({
      map: handle.comments.map,
      ytext: handle.comments.ytext,
      text: handle.getText('lf'),
      ranges: handle.comments.ranges(),
    })
  }, [handle, localRestore, mountKey])

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
    commandState,
    localCommentRecords,
  }
}

// commentAllowed 를 다시 내보낸다 — 화면이 삭제 메뉴 노출을 스스로 계산 (7.4)
export { commentAllowed, computeCommentAccess }
export type { CommentAccess }
