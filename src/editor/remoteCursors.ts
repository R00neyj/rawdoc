// 원격 커서·선택 그리기와 내 커서 보내기. yRemoteSelections 대신 직접 — 나중에 붙이고, 조이고, 조합 중 얼린다 (specs/features/F-307.md 5장·6장)
import { Prec, StateEffect } from '@codemirror/state'
import type { Extension, Range } from '@codemirror/state'
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view'
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

import type { PeerCursor } from '../lib/docRoomProtocol'
import { peerColorIndex, peerLabel, readPeerState } from '../lib/peers'
import { isForced } from './composition'
import { REMOTE_HOLD_CHECK_MS, compositionAlive } from './remoteGate'
import { isCellCompositionStarted } from './preview/tableWidget'

export const CURSOR_SEND_MS = 250
export const CURSOR_LABEL_MS = 1500

type Timers = {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

// ----- 내 커서 보내기 (5.2·5.3) -----

type ReadCursor = () => PeerCursor | null

export type CursorSender = {
  offer(input: { peers: number; focused: boolean; read: ReadCursor }): void
  resend(input: { focused: boolean; read: ReadCursor }): void
  dispose(): void
}

// 250ms 에 최대 한 번, 앞·뒤 가장자리 둘 다. 창은 상대 위치를 만들 때마다 열린다 — 만들기 비용도 조인다
export function createCursorSender(
  deps: Timers & { now(): number; publish(cursor: PeerCursor | null): void; intervalMs?: number },
): CursorSender {
  const interval = deps.intervalMs ?? CURSOR_SEND_MS
  let windowEnd = -Infinity
  let timer: unknown = null
  let pending: { read: ReadCursor; force: boolean } | null = null
  let lastSent: { json: string; cursor: PeerCursor | null } | null = null
  let disposed = false

  function flush(job: { read: ReadCursor; force: boolean }) {
    windowEnd = deps.now() + interval
    const cursor = job.read()
    const json = JSON.stringify(cursor)
    if (!job.force && lastSent?.json === json) return
    lastSent = { json, cursor }
    deps.publish(cursor)
  }

  function arm() {
    timer = deps.setTimeout(() => {
      timer = null
      if (disposed || !pending) return
      const job = pending
      pending = null
      flush(job)
      arm()
    }, Math.max(0, windowEnd - deps.now()))
  }

  function schedule(job: { read: ReadCursor; force: boolean }) {
    if (disposed) return
    if (timer !== null) {
      pending = { read: job.read, force: job.force || (pending?.force ?? false) }
      return
    }
    if (deps.now() >= windowEnd) {
      flush(job)
    } else {
      pending = job
    }
    arm()
  }

  return {
    offer({ peers, focused, read }) {
      if (peers === 0 || !focused) return
      schedule({ read, force: false })
    },
    resend({ focused, read }) {
      schedule({ read: focused ? read : () => lastSent?.cursor ?? null, force: true })
    },
    dispose() {
      disposed = true
      pending = null
      if (timer !== null) deps.clearTimeout(timer)
      timer = null
    },
  }
}

// 같은 값이어도 clock 을 올리고 change 를 낸다 — 서버는 clock 이 안 오른 항목을 되돌림으로 보고 버린다 (5.3)
export function publishCursor(awareness: Awareness, cursor: PeerCursor | null): void {
  const prev = awareness.getLocalState()
  if (prev === null) return
  const next = { ...prev, cursor }
  const same = JSON.stringify(prev) === JSON.stringify(next)
  awareness.setLocalState(next)
  if (same) awareness.emit('change', [{ added: [], updated: [awareness.clientID], removed: [] }, 'local'])
}

// ----- 조합 중 얼리기 (6.2) -----

export type RemoteCursorSync = {
  remoteChanged(ids: number[]): void
  caughtUp(): boolean
  held(): boolean
  dispose(): void
}

// 뷰 없이 도는 판정 — 조합 중이면 밀어 두고, forceRecalc 또는 2초 점검에서 따라잡는다
export function createRemoteCursorSync(
  deps: Timers & { isComposing(): boolean; isAlive(): boolean; resolve(ids: number[] | 'all'): void },
): RemoteCursorSync {
  let holding = false
  let timer: unknown = null
  let disposed = false

  function stop() {
    if (timer !== null) deps.clearTimeout(timer)
    timer = null
  }

  function check() {
    timer = null
    if (disposed || !holding) return
    if (deps.isComposing() && deps.isAlive()) {
      timer = deps.setTimeout(check, REMOTE_HOLD_CHECK_MS)
      return
    }
    holding = false
    deps.resolve('all')
  }

  return {
    remoteChanged(ids) {
      if (disposed) return
      if (!deps.isComposing()) {
        deps.resolve(ids)
        return
      }
      holding = true
      if (timer === null) timer = deps.setTimeout(check, REMOTE_HOLD_CHECK_MS)
    },
    caughtUp() {
      if (!holding) return false
      holding = false
      stop()
      return true
    },
    held: () => holding,
    dispose() {
      disposed = true
      holding = false
      stop()
    },
  }
}

// ----- 그리기 (6.3·6.4) -----

type PeerMark = { anchor: number; head: number; color: number; label: string; seq: number }

class CaretWidget extends WidgetType {
  constructor(
    readonly clientId: number,
    readonly color: number,
    readonly label: string,
    readonly seq: number,
  ) {
    super()
  }

  eq(other: CaretWidget): boolean {
    return other.clientId === this.clientId && other.color === this.color && other.label === this.label && other.seq === this.seq
  }

  toDOM(): HTMLElement {
    const caret = document.createElement('span')
    caret.className = 'cm-remote-caret'
    caret.dataset.people = String(this.color)
    caret.dataset.peerClient = String(this.clientId)
    caret.setAttribute('aria-hidden', 'true')
    const label = document.createElement('span')
    label.className = 'cm-remote-caret-label'
    label.textContent = this.label
    caret.append(label)
    return caret
  }

  ignoreEvent(): boolean {
    return true
  }
}

const refreshEffect = StateEffect.define<number[] | 'all'>()

type Source = { awareness: Awareness; ytext: Y.Text }
type AwarenessChange = { added: number[]; updated: number[]; removed: number[] }

// 조합 판정은 F-303 5.1 과 같다
function composing(view: EditorView): boolean {
  return view.compositionStarted || isCellCompositionStarted(view)
}

function toIndex(json: unknown, ytext: Y.Text, max: number): number | null {
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), ytext.doc!)
  if (!abs || abs.type !== ytext) return null
  return Math.min(abs.index, max)
}

class RemoteCursorsView {
  decorations: DecorationSet = Decoration.none
  private source: Source | null = null
  private marks = new Map<number, PeerMark>()
  private known = new Set<number>()
  private sender: CursorSender | null = null
  private sync: RemoteCursorSync | null = null
  private offAwareness: (() => void) | null = null

  constructor(readonly view: EditorView) {}

  attach(source: Source) {
    this.detach()
    this.source = source
    const timers: Timers = {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    }
    this.sender = createCursorSender({ ...timers, now: () => performance.now(), publish: (cursor) => publishCursor(source.awareness, cursor) })
    this.sync = createRemoteCursorSync({
      ...timers,
      isComposing: () => composing(this.view),
      isAlive: () => compositionAlive(this.view),
      resolve: (ids) => this.requestRefresh(ids),
    })
    const onChange = ({ added, updated, removed }: AwarenessChange) => this.onAwareness([...added, ...updated, ...removed])
    source.awareness.on('change', onChange)
    this.offAwareness = () => source.awareness.off('change', onChange)
    // 붙는 순간 이미 있는 접속자는 "새로 보였다" 로 친다 (5.2 표 끝 줄)
    if (this.notePeers()) this.sender.resend({ focused: this.focused(), read: () => this.readCursor() })
    this.requestRefresh('all')
  }

  detach() {
    this.offAwareness?.()
    this.offAwareness = null
    this.sender?.dispose()
    this.sync?.dispose()
    this.sender = null
    this.sync = null
    this.source = null
    this.marks.clear()
    this.known.clear()
    this.decorations = Decoration.none
  }

  update(update: ViewUpdate) {
    if (!this.source) return
    if (update.docChanged) {
      // 문서 변경은 옮기기만 한다 — 위젯이 같은 것으로 남아 DOM 이 새로 안 생긴다 (6.3)
      this.decorations = this.decorations.map(update.changes)
      for (const mark of this.marks.values()) {
        const forward = mark.head > mark.anchor
        mark.anchor = update.changes.mapPos(mark.anchor, forward ? 1 : -1)
        mark.head = update.changes.mapPos(mark.head, forward ? -1 : 1)
      }
    }
    let ids: Set<number> | 'all' | null = null
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (!effect.is(refreshEffect)) continue
        if (effect.value === 'all' || ids === 'all') ids = 'all'
        else ids = new Set([...(ids ?? []), ...effect.value])
      }
    }
    if (isForced(update) && this.sync?.caughtUp()) ids = 'all'
    if (ids) this.resolve(ids, update.state.doc.length)
    if (update.selectionSet || update.focusChanged) {
      this.sender?.offer({ peers: this.known.size, focused: this.focused(), read: () => this.readCursor() })
    }
  }

  destroy() {
    this.detach()
  }

  private focused(): boolean {
    return this.view.hasFocus && document.hasFocus()
  }

  private readCursor(): PeerCursor | null {
    const ytext = this.source?.ytext
    if (!ytext) return null
    const { anchor, head } = this.view.state.selection.main
    const rel = (index: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, Math.min(index, ytext.length)))
    return { anchor: rel(anchor), head: rel(head) }
  }

  // 접속자 집합을 새로 읽는다. 없던 clientID 가 생겼으면 true
  private notePeers(): boolean {
    const source = this.source
    if (!source) return false
    const current = new Set<number>()
    source.awareness.getStates().forEach((state, id) => {
      if (id !== source.awareness.clientID && readPeerState(state)) current.add(id)
    })
    const appeared = [...current].some((id) => !this.known.has(id))
    this.known = current
    return appeared
  }

  private onAwareness(changed: number[]) {
    const source = this.source
    if (!source) return
    const ids = changed.filter((id) => id !== source.awareness.clientID)
    if (ids.length === 0) return
    if (this.notePeers()) this.sender?.resend({ focused: this.focused(), read: () => this.readCursor() })
    this.sync?.remoteChanged(ids)
  }

  private requestRefresh(ids: number[] | 'all') {
    if (!this.source) return
    const run = () => {
      if (this.source) this.view.dispatch({ effects: refreshEffect.of(ids) })
    }
    try {
      run()
    } catch {
      queueMicrotask(run)
    }
  }

  // 그 사람들의 커서를 다시 풀고 장식을 다시 짓는다. 위치가 달라진 사람만 이동 번호가 오른다 (6.4)
  private resolve(ids: Set<number> | 'all', docLength: number) {
    const source = this.source
    if (!source) return
    const states = source.awareness.getStates()
    const own = source.awareness.clientID
    const targets = ids === 'all' ? new Set([...this.marks.keys(), ...states.keys()]) : ids
    for (const id of targets) {
      const state = id === own ? null : readPeerState(states.get(id))
      let anchor: number | null = null
      let head: number | null = null
      if (state?.cursor) {
        try {
          anchor = toIndex(state.cursor.anchor, source.ytext, docLength)
          head = toIndex(state.cursor.head, source.ytext, docLength)
        } catch {
          anchor = head = null
        }
      }
      if (!state || anchor === null || head === null) {
        this.marks.delete(id)
        continue
      }
      const prev = this.marks.get(id)
      const moved = !prev || prev.anchor !== anchor || prev.head !== head
      this.marks.set(id, {
        anchor,
        head,
        color: peerColorIndex(state.user.id),
        label: peerLabel(state.user.email),
        seq: moved ? (prev?.seq ?? 0) + 1 : prev.seq,
      })
    }
    this.decorations = this.build()
  }

  private build(): DecorationSet {
    const ranges: Range<Decoration>[] = []
    for (const [id, mark] of this.marks) {
      const from = Math.min(mark.anchor, mark.head)
      const to = Math.max(mark.anchor, mark.head)
      if (from < to) {
        ranges.push(Decoration.mark({ class: 'cm-remote-selection', attributes: { 'data-people': String(mark.color) } }).range(from, to))
      }
      const widget = new CaretWidget(id, mark.color, mark.label, mark.seq)
      ranges.push(Decoration.widget({ widget, side: mark.head > mark.anchor ? -1 : 1 }).range(mark.head))
    }
    return Decoration.set(ranges, true)
  }
}

const remoteCursorsPlugin = ViewPlugin.fromClass(RemoteCursorsView, { decorations: (plugin) => plugin.decorations })

// 늘 확장 목록에 둔다. 붙은 소스가 없으면 빈 장식이다 (5.1)
export function remoteCursors(): Extension {
  return Prec.low(remoteCursorsPlugin)
}

// Compartment 재구성 없이 붙인다 — 재구성은 blockPreview StateField 를 새로 만들 수 있다 (5.1)
export function attachRemoteCursors(view: EditorView, source: { awareness: Awareness; ytext: Y.Text }): () => void {
  const plugin = view.plugin(remoteCursorsPlugin)
  if (!plugin) return () => {}
  plugin.attach(source)
  return () => plugin.detach()
}
