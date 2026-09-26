// 댓글 편집기 표시 — 앵커 장식·거터·위치 따라가기·레일 좌표 (specs/features/F-504.md)
import { MapMode, StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Extension, Range, Transaction, TransactionSpec } from '@codemirror/state'
import { BlockType, Decoration, EditorView, GutterMarker, ViewPlugin, gutter } from '@codemirror/view'
import type { BlockInfo, DecorationSet, ViewUpdate } from '@codemirror/view'
import type * as Y from 'yjs'

import { createCommentAnchor, resolveCommentAnchor, resolveCommentAnchors } from '../lib/commentAnchor'
import { commentQuote, groupCommentThreads, sortThreadsByPosition, toAnchorRange } from '../lib/docComments'
import type { AnchorRange, CommentAnchor, CommentThread } from '../lib/docComments'
import { Y_COMMENTS_NAME } from '../lib/docRoomProtocol'
import { forceRecalc, isForced } from './composition'
import { REMOTE_HOLD_CHECK_MS, compositionAlive } from './remoteGate'
import { isCellCompositionStarted } from './preview/tableWidget'

export const COMMENT_RERESOLVE_MS = 300

// ----- 3장 계약 -----

export type CommentPlace = { threadId: string; from: number; to: number; top: number }
export type CommentLayout = {
  anchored: CommentPlace[]
  orphans: string[]
}
export type CommentDraft = { anchor: CommentAnchor; range: AnchorRange; quote: string }

export type AttachCommentsOptions = {
  onActivate: (threadId: string, via: 'anchor' | 'gutter') => void
  onLayout: (layout: CommentLayout) => void
}

export type EditorComments = {
  readonly doc: Y.Doc
  readonly map: Y.Map<unknown>
  readonly ytext: Y.Text
  attach(options: AttachCommentsOptions): () => void
  attached(): boolean
  ranges(): ReadonlyMap<string, AnchorRange | null>
  setActive(threadId: string | null): void
  reveal(threadId: string): boolean
  beginDraft(): AnchorRange | null
  takeDraft(): CommentDraft | null
  clearDraft(): void
}

export type CommentSyncDeps = {
  getState(): EditorState
  dispatch(spec: TransactionSpec): void
  ytext: Y.Text
  map: Y.Map<unknown>
  isComposing(): boolean
  isAlive(): boolean
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type CommentSync = {
  start(): void
  mapChanged(keys: ReadonlySet<string>): void
  afterUpdate(update: { transactions: readonly Transaction[] }): void
  ranges(): ReadonlyMap<string, AnchorRange | null>
  setActive(threadId: string | null): void
  beginDraft(): AnchorRange | null
  takeDraft(): CommentDraft | null
  clearDraft(): void
  dispose(options?: { keepField?: boolean }): void
}

// ----- 필드 (2장 "가진 것") -----

type RawRange = { from: number; to: number }

export type CommentFieldValue = {
  readonly threads: readonly CommentThread[]
  readonly ranges: ReadonlyMap<string, AnchorRange | null>
  readonly active: string | null
  readonly draft: RawRange | null
  readonly pending: ReadonlySet<string>
  // 경계 글자가 지워질 때마다 오른다 — 동기화가 ③ 타이머를 다시 거는 신호 (5.4)
  readonly boundarySeq: number
  readonly decorations: DecorationSet
}

type ThreadsUpdate = { threads: readonly CommentThread[] | null; resolved: ReadonlyMap<string, AnchorRange | null> }

const threadsEffect = StateEffect.define<ThreadsUpdate>()
const activeEffect = StateEffect.define<string | null>()
const draftEffect = StateEffect.define<RawRange | null>()
const clearEffect = StateEffect.define<null>()

const EMPTY: CommentFieldValue = {
  threads: [],
  ranges: new Map(),
  active: null,
  draft: null,
  pending: new Set(),
  boundarySeq: 0,
  decorations: Decoration.none,
}

const draftMark = Decoration.mark({ class: 'cm-comment-anchor-draft' })

function buildDecorations(value: Omit<CommentFieldValue, 'decorations'>): DecorationSet {
  const marks: Range<Decoration>[] = []
  for (const thread of value.threads) {
    if (thread.root.resolved !== null) continue
    const range = value.ranges.get(thread.id)
    if (!range) continue
    const active = value.active === thread.id
    marks.push(
      Decoration.mark({
        class: active ? 'cm-comment-anchor cm-comment-anchor-active' : 'cm-comment-anchor',
        attributes: { 'data-thread-id': thread.id },
      }).range(range.from, range.to),
    )
  }
  if (value.draft && value.draft.from < value.draft.to) marks.push(draftMark.range(value.draft.from, value.draft.to))
  return Decoration.set(marks, true)
}

// 시작은 오른쪽 글자, 끝은 왼쪽 글자에 붙는다 — 앵커의 assoc 0 / -1 과 같은 방향 (5.3)
function mapDoc(value: CommentFieldValue, tr: Transaction): CommentFieldValue {
  const { changes } = tr
  // ④ 글자를 넣은 트랜잭션이면 고아도 다시 풀 것에 넣는다 — 늦은 되돌리기로 살아난 앵커 (F-500 4.2)
  let inserted = false
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    if (toB > fromB) inserted = true
  })
  const ranges = new Map<string, AnchorRange | null>()
  let pending: Set<string> | null = null
  for (const [id, range] of value.ranges) {
    if (!range) {
      ranges.set(id, null)
      if (inserted) {
        pending ??= new Set(value.pending)
        pending.add(id)
      }
      continue
    }
    if (changes.mapPos(range.from, 1, MapMode.TrackAfter) === null || changes.mapPos(range.to, -1, MapMode.TrackBefore) === null) {
      pending ??= new Set(value.pending)
      pending.add(id)
    }
    ranges.set(id, toAnchorRange(changes.mapPos(range.from, 1), changes.mapPos(range.to, -1)))
  }
  const draft = value.draft ? { from: changes.mapPos(value.draft.from, 1), to: changes.mapPos(value.draft.to, -1) } : null
  return {
    ...value,
    ranges,
    draft,
    pending: pending ?? value.pending,
    boundarySeq: pending ? value.boundarySeq + 1 : value.boundarySeq,
  }
}

function applyThreads(value: CommentFieldValue, update: ThreadsUpdate): CommentFieldValue {
  const threads = update.threads ?? value.threads
  const ranges = new Map<string, AnchorRange | null>()
  const pending = new Set<string>()
  for (const thread of threads) {
    const id = thread.id
    if (update.resolved.has(id)) {
      ranges.set(id, update.resolved.get(id) ?? null)
    } else {
      ranges.set(id, value.ranges.get(id) ?? null)
      if (value.pending.has(id)) pending.add(id)
    }
  }
  return { ...value, threads, ranges, pending }
}

export const commentField = StateField.define<CommentFieldValue>({
  create: () => EMPTY,
  update(value, tr) {
    let next = value
    if (tr.docChanged && (next.ranges.size > 0 || next.draft)) next = mapDoc(next, tr)
    for (const effect of tr.effects) {
      if (effect.is(clearEffect)) next = EMPTY
      else if (effect.is(threadsEffect)) next = applyThreads(next, effect.value)
      else if (effect.is(activeEffect)) next = { ...next, active: effect.value }
      else if (effect.is(draftEffect)) next = { ...next, draft: effect.value }
    }
    if (next === value || next === EMPTY) return next
    return { ...next, decorations: buildDecorations(next) }
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
})

// ----- 거터 세기 (4.3) -----

function countedThreads(value: CommentFieldValue, from: number, to: number): { thread: CommentThread; range: AnchorRange }[] {
  const out: { thread: CommentThread; range: AnchorRange }[] = []
  for (const thread of value.threads) {
    if (thread.root.resolved !== null) continue
    const range = value.ranges.get(thread.id)
    if (range && range.from >= from && range.from <= to) out.push({ thread, range })
  }
  return out
}

// 점 위젯(맨 위 제목 등)은 세지 않는다 — 위치 0 스레드가 두 번 세어지지 않게
export function commentGutterCount(value: CommentFieldValue, from: number, to: number, widget: boolean): number {
  if (widget && from === to) return 0
  return countedThreads(value, from, to).length
}

export function commentGutterPick(value: CommentFieldValue, from: number, to: number): string | null {
  const counted = countedThreads(value, from, to)
  if (counted.length === 0) return null
  const ranges = new Map(counted.map(({ thread, range }) => [thread.id, range]))
  return sortThreadsByPosition(
    counted.map(({ thread }) => thread),
    ranges,
  ).anchored[0].id
}

// ----- ② 관찰 (5.2) -----

// map.observe 로 바뀐 키를 모으고 afterTransaction 에서 넘긴다 — 그때는 y-sync 가 본문을 CM 에 넣은 뒤다 (n8)
export function observeCommentKeys(map: Y.Map<unknown>, onKeys: (keys: ReadonlySet<string>) => void): () => void {
  const doc = map.doc
  if (!doc) return () => {}
  let keys: Set<string> | null = null
  const onMap = (event: Y.YMapEvent<unknown>) => {
    keys ??= new Set()
    for (const key of event.keysChanged) keys.add(key)
  }
  const onAfter = () => {
    if (!keys) return
    const changed = keys
    keys = null
    onKeys(changed)
  }
  map.observe(onMap)
  doc.on('afterTransaction', onAfter)
  return () => {
    map.unobserve(onMap)
    doc.off('afterTransaction', onAfter)
  }
}

// ----- 뷰 없이 도는 동기화 (3장, 5장, 6장) -----

type Work = {
  start: boolean
  keys: Set<string>
  pending: boolean
  active?: { id: string | null }
  clearDraft: boolean
}

function emptyWork(): Work {
  return { start: false, keys: new Set(), pending: false, clearDraft: false }
}

function hasWork(work: Work): boolean {
  return work.start || work.keys.size > 0 || work.pending || work.active !== undefined || work.clearDraft
}

// composition.ts isForced 와 같은 판정 — 여기서는 트랜잭션 목록만 받는다
function hasForceRecalc(transactions: readonly Transaction[]): boolean {
  return transactions.some((tr) => tr.effects.some((effect) => effect.is(forceRecalc)))
}

export function createCommentSync(deps: CommentSyncDeps): CommentSync {
  let disposed = false
  let queued = emptyWork()
  let reresolveTimer: unknown = null
  let holdTimer: unknown = null
  let lastSeq = readField()?.boundarySeq ?? 0

  function readField(): CommentFieldValue | undefined {
    return deps.getState().field(commentField, false)
  }

  // 지금의 Y.Text·CM 상태로 효과를 짓는다 — 보내는 순간에 계산해야 마이크로태스크로 밀려도 위치가 맞다
  function effectsFor(work: Work): StateEffect<unknown>[] {
    const field = readField()
    if (!field) return []
    const effects: StateEffect<unknown>[] = []
    const refreshThreads = work.start || work.keys.size > 0
    if (refreshThreads || (work.pending && field.pending.size > 0)) {
      const threads = refreshThreads ? groupCommentThreads(deps.map.entries()).threads : field.threads
      let resolved: Map<string, AnchorRange | null>
      if (work.start) {
        resolved = resolveCommentAnchors(
          deps.ytext,
          threads.map((thread) => [thread.id, thread.root] as const),
        )
      } else {
        resolved = new Map()
        for (const thread of threads) {
          const id = thread.id
          const due = work.keys.has(id) || !field.ranges.has(id) || (work.pending && field.pending.has(id))
          if (due) resolved.set(id, resolveCommentAnchor(deps.ytext, thread.root.anchor))
        }
      }
      effects.push(threadsEffect.of({ threads: refreshThreads ? threads : null, resolved }))
    }
    if (work.active !== undefined) effects.push(activeEffect.of(work.active.id))
    if (work.clearDraft) effects.push(draftEffect.of(null))
    return effects
  }

  function run(work: Work) {
    if (disposed) return
    const effects = effectsFor(work)
    if (effects.length > 0) deps.dispatch({ effects })
  }

  // CM 업데이트 도중이면 던진다 — 그때는 마이크로태스크로 다시 (remoteCursors.ts requestRefresh 와 같게)
  function send(work: Work) {
    try {
      run(work)
    } catch {
      queueMicrotask(() => run(work))
    }
  }

  function merge(work: Work) {
    queued.start ||= work.start
    for (const key of work.keys) queued.keys.add(key)
    queued.pending ||= work.pending
    if (work.active !== undefined) queued.active = work.active
    queued.clearDraft ||= work.clearDraft
  }

  function takeQueued(): Work {
    const work = queued
    queued = emptyWork()
    return work
  }

  function stopHold() {
    if (holdTimer !== null) deps.clearTimeout(holdTimer)
    holdTimer = null
  }

  function armHold() {
    if (holdTimer === null) holdTimer = deps.setTimeout(holdCheck, REMOTE_HOLD_CHECK_MS)
  }

  // 살아 있는 조합이면 2초 뒤 다시 본다. 끝난 조합(F-303 5.4)이면 모은 것을 보낸다 (6장)
  function holdCheck() {
    holdTimer = null
    if (disposed || !hasWork(queued)) return
    if (deps.isComposing() && deps.isAlive()) {
      armHold()
      return
    }
    send(takeQueued())
  }

  // 조합 중이면 모아 두고, 아니면 곧바로 보낸다
  function request(work: Work) {
    if (disposed) return
    if (deps.isComposing()) {
      merge(work)
      armHold()
      return
    }
    send(work)
  }

  function stopReresolve() {
    if (reresolveTimer !== null) deps.clearTimeout(reresolveTimer)
    reresolveTimer = null
  }

  function armReresolve() {
    stopReresolve()
    reresolveTimer = deps.setTimeout(() => {
      reresolveTimer = null
      request({ ...emptyWork(), pending: true })
    }, COMMENT_RERESOLVE_MS)
  }

  return {
    start() {
      request({ ...emptyWork(), start: true })
    },

    mapChanged(keys) {
      if (keys.size === 0) return
      request({ ...emptyWork(), keys: new Set(keys) })
    },

    afterUpdate(update) {
      if (disposed) return
      if (hasForceRecalc(update.transactions) && !deps.isComposing()) {
        stopReresolve()
        stopHold()
        const work = takeQueued()
        work.pending = true
        // forceRecalc 트랜잭션 다음에 보낸다 — 업데이트 안에서는 dispatch 할 수 없다 (6장)
        queueMicrotask(() => {
          if (hasWork(work)) run(work)
        })
      }
      const seq = readField()?.boundarySeq ?? 0
      if (seq !== lastSeq) {
        lastSeq = seq
        armReresolve()
      }
    },

    ranges() {
      const field = readField()
      const out = new Map<string, AnchorRange | null>()
      if (disposed || !field) return out
      for (const thread of field.threads) {
        const id = thread.id
        out.set(id, field.pending.has(id) ? resolveCommentAnchor(deps.ytext, thread.root.anchor) : (field.ranges.get(id) ?? null))
      }
      return out
    },

    setActive(threadId) {
      request({ ...emptyWork(), active: { id: threadId } })
    },

    beginDraft() {
      if (disposed || deps.isComposing()) return null
      const main = deps.getState().selection.main
      if (main.empty) return null
      const range = { from: main.from, to: main.to }
      const spec = { effects: draftEffect.of(range) }
      try {
        deps.dispatch(spec)
      } catch {
        queueMicrotask(() => {
          if (!disposed) deps.dispatch(spec)
        })
      }
      return range
    },

    takeDraft() {
      if (disposed) return null
      const state = deps.getState()
      const draft = state.field(commentField, false)?.draft ?? null
      request({ ...emptyWork(), clearDraft: true })
      if (!draft) return null
      const range = toAnchorRange(draft.from, draft.to)
      if (!range) return null
      const anchor = createCommentAnchor(deps.ytext, range.from, range.to)
      if (!anchor) return null
      return { anchor, range, quote: commentQuote(state.doc.sliceString(range.from, range.to)) }
    },

    clearDraft() {
      request({ ...emptyWork(), clearDraft: true })
    },

    dispose(options) {
      if (disposed) return
      disposed = true
      stopReresolve()
      stopHold()
      queued = emptyWork()
      if (options?.keepField) return
      try {
        deps.dispatch({ effects: clearEffect.of(null) })
      } catch {
        // 뷰가 업데이트 중이면 필드는 다음 붙이기의 start 가 덮어쓴다
      }
    },
  }
}

// ----- 거터 (4.3) -----

class CommentGutterMarker extends GutterMarker {
  constructor(readonly count: number) {
    super()
  }

  eq(other: GutterMarker): boolean {
    return other instanceof CommentGutterMarker && other.count === this.count
  }

  toDOM(): Node {
    const marker = document.createElement('div')
    marker.className = 'cm-comment-gutter-marker'
    marker.dataset.count = String(this.count)
    marker.title = `댓글 ${this.count}개`
    marker.setAttribute('aria-hidden', 'true')
    if (this.count >= 2) marker.textContent = String(this.count)
    return marker
  }
}

const markerCache = new Map<number, CommentGutterMarker>()

function markerFor(count: number): CommentGutterMarker | null {
  if (count < 1) return null
  let marker = markerCache.get(count)
  if (!marker) {
    marker = new CommentGutterMarker(count)
    if (count <= 20) markerCache.set(count, marker)
  }
  return marker
}

function composing(view: EditorView): boolean {
  return view.compositionStarted || isCellCompositionStarted(view)
}

const commentGutterExtension = gutter({
  class: 'cm-comment-gutter',
  lineMarker(view, line) {
    const value = view.state.field(commentField, false)
    return value ? markerFor(commentGutterCount(value, line.from, line.to, false)) : null
  },
  widgetMarker(view, _widget, block) {
    const value = view.state.field(commentField, false)
    return value ? markerFor(commentGutterCount(value, block.from, block.to, true)) : null
  },
  lineMarkerChange: (update) => update.startState.field(commentField, false) !== update.state.field(commentField, false),
  initialSpacer: () => new CommentGutterMarker(1),
  domEventHandlers: {
    mousedown(view, line, event) {
      const mouse = event as MouseEvent
      if (mouse.button !== 0 || composing(view)) return false
      const target = mouse.target instanceof Element ? mouse.target : null
      if (!target?.closest('.cm-gutterElement')?.querySelector('.cm-comment-gutter-marker')) return false
      const plugin = view.plugin(commentsPlugin)
      const value = view.state.field(commentField, false)
      if (!plugin?.options || !value) return false
      const id = commentGutterPick(value, line.from, line.to)
      if (id === null) return false
      plugin.options.onActivate(id, 'gutter')
      return true
    },
  },
})

// 줄 번호 compartment 안, lineNumbers() 바로 뒤에 둔다 — 붙어 있고 줄 번호가 켜져 있을 때만 (4.3, Q2)
export function commentGutter(): Extension {
  return commentGutterExtension
}

// ----- 뷰 플러그인 — 관찰·타이머·클릭·레일 좌표 (3.1, 4.2, 4.4) -----

type CommentSource = { map: Y.Map<unknown>; ytext: Y.Text; setGutter(on: boolean): void }

function sameLayout(a: CommentLayout | null, b: CommentLayout): boolean {
  if (!a || a.anchored.length !== b.anchored.length || a.orphans.length !== b.orphans.length) return false
  for (let i = 0; i < a.anchored.length; i++) {
    const x = a.anchored[i]
    const y = b.anchored[i]
    if (x.threadId !== y.threadId || x.from !== y.from || x.to !== y.to || x.top !== y.top) return false
  }
  return a.orphans.every((id, i) => id === b.orphans[i])
}

// 텍스트 줄이 그려져 있으면 그 줄 첫 글자와의 세로 차이로 시각 줄을 고른다. 아니면 높이 지도의 줄(또는 위젯) 윗변 (4.4)
function blockTop(view: EditorView, pos: number): number {
  let block: BlockInfo = view.lineBlockAt(pos)
  if (Array.isArray(block.type)) {
    const parts = block.type as readonly BlockInfo[]
    block = parts.find((part) => part.type === BlockType.Text && pos >= part.from && pos <= part.to) ?? block
  }
  if (block.type !== BlockType.Text) return block.top
  const { from, to } = view.viewport
  if (pos < from || pos > to) return block.top
  const at = view.coordsAtPos(pos, 1)
  const first = view.coordsAtPos(block.from, 1)
  if (!at || !first) return block.top
  return block.top + Math.max(0, at.top - first.top)
}

function readLayout(view: EditorView): CommentLayout | null {
  const scroller = view.scrollDOM
  if (scroller.clientHeight === 0) return null
  const value = view.state.field(commentField, false)
  if (!value) return null
  const { anchored, orphans } = sortThreadsByPosition(value.threads, value.ranges)
  const offset = view.documentTop - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop
  return {
    anchored: anchored.map((thread) => {
      const range = value.ranges.get(thread.id) as AnchorRange
      const top = Math.round((offset + blockTop(view, range.from)) * 100) / 100
      return { threadId: thread.id, from: range.from, to: range.to, top }
    }),
    orphans: orphans.map((thread) => thread.id),
  }
}

class CommentsView {
  options: AttachCommentsOptions | null = null
  sync: CommentSync | null = null
  private source: CommentSource | null = null
  private unobserve: (() => void) | null = null
  private lastLayout: CommentLayout | null = null
  private gutterPending = false
  private readonly measureKey = {}

  constructor(readonly view: EditorView) {}

  attach(source: CommentSource, options: AttachCommentsOptions) {
    this.detach()
    const view = this.view
    this.source = source
    this.options = options
    const sync = createCommentSync({
      getState: () => view.state,
      dispatch: (spec) => view.dispatch(spec),
      ytext: source.ytext,
      map: source.map,
      isComposing: () => composing(view),
      isAlive: () => compositionAlive(view),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    })
    this.sync = sync
    this.unobserve = observeCommentKeys(source.map, (keys) => sync.mapChanged(keys))
    sync.start()
    if (composing(view)) this.gutterPending = true
    else source.setGutter(true)
    this.scheduleLayout()
  }

  detach(keepField = false) {
    this.unobserve?.()
    this.unobserve = null
    this.sync?.dispose({ keepField })
    const hadSource = this.source
    this.sync = null
    this.options = null
    this.source = null
    this.lastLayout = null
    this.gutterPending = false
    if (hadSource && !keepField) hadSource.setGutter(false)
  }

  update(update: ViewUpdate) {
    if (!this.sync) return
    this.sync.afterUpdate(update)
    if (this.gutterPending && isForced(update) && !composing(this.view)) {
      this.gutterPending = false
      const source = this.source
      queueMicrotask(() => {
        if (this.source === source) source?.setGutter(true)
      })
    }
    const fieldChanged = update.startState.field(commentField, false) !== update.state.field(commentField, false)
    if (fieldChanged || update.docChanged || update.heightChanged || update.geometryChanged || update.viewportChanged) {
      this.scheduleLayout()
    }
  }

  destroy() {
    this.detach(true)
  }

  // 한 프레임에 최대 한 번 — 같은 key 로 요청한다 (4.4)
  scheduleLayout() {
    if (!this.options) return
    this.view.requestMeasure({
      key: this.measureKey,
      read: (view) => readLayout(view),
      write: (layout) => {
        if (!layout || !this.options || sameLayout(this.lastLayout, layout)) return
        this.lastLayout = layout
        this.options.onLayout(layout)
      },
    })
  }
}

const commentsPlugin = ViewPlugin.fromClass(CommentsView)

// 앵커 글자 클릭 — 가장 안쪽 span 이 이긴다. 끌어서 고르면 부르지 않는다. 기본 동작은 막지 않는다 (4.2)
const anchorClick = EditorView.domEventHandlers({
  click(event, view) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false
    if (composing(view)) return false
    const plugin = view.plugin(commentsPlugin)
    if (!plugin?.options) return false
    if (!view.state.selection.main.empty) return false
    const target = event.target instanceof Element ? event.target : null
    const anchor = target?.closest<HTMLElement>('.cm-comment-anchor')
    if (!anchor || !view.contentDOM.contains(anchor)) return false
    const id = anchor.dataset.threadId
    if (id) plugin.options.onActivate(id, 'anchor')
    return false
  },
})

// 필드 + 플러그인. 늘 확장 목록에 둔다 — 붙기 전에는 장식·거터가 없다
export function commentMarks(): Extension {
  return [commentField, commentsPlugin, anchorClick]
}

// ----- 핸들의 comments 필드 (3장) -----

// detach 는 편집기 destroy 가 부른다 — 뷰를 곧 없애므로 필드를 비우는 트랜잭션을 보내지 않는다
export function createEditorComments(input: {
  view: EditorView
  doc: Y.Doc
  ytext: Y.Text
  setGutter(on: boolean): void
  isDestroyed(): boolean
}): { comments: EditorComments; detach(): void } {
  const { view, doc, ytext, setGutter, isDestroyed } = input
  const map = doc.getMap<unknown>(Y_COMMENTS_NAME)
  const plugin = () => view.plugin(commentsPlugin)
  const sync = () => plugin()?.sync ?? null

  const comments: EditorComments = {
    doc,
    map,
    ytext,

    attach(options) {
      const current = plugin()
      if (!current || isDestroyed()) return () => {}
      current.attach({ map, ytext, setGutter }, options)
      const mine = current.sync
      return () => {
        if (current.sync === mine) current.detach()
      }
    },

    attached: () => sync() !== null,

    ranges: () => sync()?.ranges() ?? new Map(),

    setActive(threadId) {
      sync()?.setActive(threadId)
    },

    // 가운데로 스크롤하고 활성. 커서·선택은 옮기지 않는다 (3.3)
    reveal(threadId) {
      const active = sync()
      if (!active || isDestroyed() || view.scrollDOM.clientHeight === 0) return false
      const range = view.state.field(commentField, false)?.ranges.get(threadId)
      if (!range) return false
      view.dispatch({ effects: EditorView.scrollIntoView(range.from, { y: 'center' }) })
      active.setActive(threadId)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (isDestroyed() || view.scrollDOM.clientHeight === 0) return
          const now = view.state.field(commentField, false)?.ranges.get(threadId)
          if (!now) return
          const coords = view.coordsAtPos(now.from, 1)
          if (!coords) return
          const rect = view.scrollDOM.getBoundingClientRect()
          const center = rect.top + view.scrollDOM.clientTop + view.scrollDOM.clientHeight / 2
          const delta = (coords.top + coords.bottom) / 2 - center
          if (Math.abs(delta) > 0.5) view.scrollDOM.scrollTop += delta
        })
      })
      return true
    },

    beginDraft: () => sync()?.beginDraft() ?? null,
    takeDraft: () => sync()?.takeDraft() ?? null,

    clearDraft() {
      sync()?.clearDraft()
    },
  }

  return { comments, detach: () => plugin()?.detach(true) }
}

