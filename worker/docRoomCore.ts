// DocRoom 규칙 (specs/features/F-304.md 6~9장). partyserver·cloudflare:workers 를 import 하지 않는다 — node 테스트가 통째로 부른다
import * as Y from 'yjs'

import {
  SOCKET_CLOSE,
  Y_COMMENTS_NAME,
  Y_CONTENT_NAME,
  Y_TITLE_NAME,
  encodeCommentOpReply,
  encodeDocRoomMessage,
  parseCommentOp,
} from '../src/lib/docRoomProtocol'
import type { CommentOp, CommentOpRejectReason } from '../src/lib/docRoomProtocol'
import {
  COMMENT_OPS_PER_MINUTE,
  checkCommentCapacity,
  commentAllowed,
  commentQuote,
  commentRejectReason,
  commentSig,
  groupCommentThreads,
  validateCommentEntry,
} from '../src/lib/docComments'
import type { CommentActor, CommentEntry, CommentRecord, CommentThread } from '../src/lib/docComments'
import { resolveCommentAnchor, resolveCommentAnchors, restoreCommentEntries } from '../src/lib/commentAnchor'
import { planCommentFixes } from './commentGuard'
import type { CommentChange } from './commentGuard'
import {
  ALL_COMMENTS_SQL,
  KNOWN_COMMENTS_SQL,
  NOTIFICATIONS_PER_BATCH_MAX,
  commentBundleStatements,
  commentRowOf,
  notificationTargets,
  rowToCommentRecord,
} from './commentRows'
import type { CommentRow, DocCommentDbRow, NotificationDraft } from './commentRows'
import { loadDocPeople } from './docPeople'
import { fromEditorText, toEditorText } from '../src/lib/lineEnding'
import type { LineEnding } from '../src/lib/lineEnding'
import { isWriteBlocked, resolveDocAccess, roleAtLeast } from './access'
import { rebaseExternal } from '../src/lib/textRebase'
import type { TextEdit } from '../src/lib/textRebase'
import { MAX_CONTENT_BYTES, MAX_TITLE_CHARS, utf8ByteLength } from './validate'
import { YStore } from './yStore'
import type { DoStorageLike } from './yStore'
import { updateDocRow } from './docWrite'
import type { DocRow } from './docWrite'
import { isDailyLimitReached, rowToUsage, snapshotUsageStatement, utcDay } from './usage'
import type { UsageRow } from './usage'

export const FLUSH_DEBOUNCE_MS = 5_000
export const FLUSH_MAX_WAIT_MS = 30_000
export const LOAD_FLUSH_DELAY_MS = 5_000
export const SNAPSHOT_RETRY_MS = 5_000
export const SNAPSHOT_RETRY_MAX = 3
export const REVALIDATE_INTERVAL_MS = 60_000
export const SLOW_SNAPSHOT_MS = 60_000

export const COMMENT_RATE_WINDOW_MS = 60_000

export type RoomRole = 'owner' | 'edit' | 'view'
export type RoomConnState = { userId: string; email: string; role: RoomRole }

export interface RoomConnection {
  readonly state: unknown
  close(code: number, reason: string): void
}

// 명령 속도 칸을 연결 상태(WebSocket 첨부)에 쓴다 — hibernation 을 넘긴다 (F-503 4.3)
export type StatefulConnection = RoomConnection & { setState(update: (prev: unknown) => unknown): unknown }
export const COMMENT_RATE_KEY = 'commentRate'
export type CommentRateState = { start: number; count: number }

export interface DocRoomHost<C extends RoomConnection = RoomConnection> {
  docId: string
  env: Env
  storage: DoStorageLike
  doc: Y.Doc
  connections(): Iterable<C>
  sendCustom(conn: C, message: string): void
  broadcastCustom(message: string): void
  // 초기화(onLoad)가 끝날 때까지. 이미 됐으면 곧바로 (F-308 5.3)
  ensureLoaded(): Promise<void>
  // 그동안 이 DO 에 다른 이벤트(새 연결·메시지·RPC)가 들어오지 않는다
  exclusive<T>(fn: () => Promise<T>): Promise<T>
  // DO 알람을 at(ms) 에 건다. 이미 걸린 알람은 바뀐다 (F-2027 5.5)
  setAlarm(at: number): Promise<void>
}

// /v1 PUT 이 DO 에 넘기는 값 — 검사는 Worker 가 끝냈다 (F-308 5.1)
export type RoomTextWrite = {
  title?: string
  content?: string
  baseVersion: number
  docVersion: number
}
export type RoomDocState = {
  title: string
  content: string
  version: number
  updatedAt: number | null
}
export type RoomTextWriteResult =
  | { type: 'ok'; doc: RoomDocState }
  | { type: 'conflict'; doc: RoomDocState }
  | { type: 'too_large'; bytes: number }
  | { type: 'not_found' }
  | { type: 'unavailable' }

// 로그인 이관 (F-503 5장) — 검사는 Worker 가 끝냈다
export type RoomCommentImport = { records: CommentRecord[]; user: { id: string; email: string }; docVersion: number }
export type RoomCommentImportResult =
  | { type: 'ok'; imported: number; orphaned: number }
  | { type: 'exists' }
  | { type: 'not_found' }
  | { type: 'unavailable' }

type D1DocRow = { title: string; content: string; line_ending: LineEnding; version: number; owner_id: string }
// rowBytes — base 가 가리키는 D1 행 본문의 실제 UTF-8 바이트 (F-2027 4.4)
type Base = { content: string; title: string; version: number; lineEnding: LineEnding; updatedAt: number | null; rowBytes: number }
type SnapshotResult = 'ok' | 'retry' | 'gone'
// 한 스냅숏이 D1 댓글 복사본에 쓸 것 (F-502 4.2). keys = dirty 에서 떼어 온 키
type CommentPlan = { keys: string[]; full: boolean; upserts: CommentRow[]; deletes: string[]; drafts: NotificationDraft[] }
type KnownComment = { sig: string; anchorSig: string }

// D1 읽기 셋은 금고 행을 거른다 — DO 는 금고 문서를 없는 문서로 본다 (F-401 X16)
const READ_ROW_SQL = 'SELECT title, content, line_ending, version, owner_id FROM docs WHERE id = ? AND e2ee_key IS NULL'
const BLOCKED_SQL = 'SELECT blocked_at FROM users WHERE id = ?'
const ACCESS_ROW_SQL = 'SELECT id, owner_id, folder_id FROM docs WHERE id = ? AND e2ee_key IS NULL'
const UPDATE_SQL = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?'
const FULL_ROW_SQL = 'SELECT * FROM docs WHERE id = ? AND e2ee_key IS NULL'

// 빈 Doc 의 encodeStateAsUpdate 길이
const EMPTY_UPDATE_BYTES = 2

// 서버가 D1 값을 얹는 트랜잭션의 origin — 클라이언트와 공유하지 않는다
const ABSORB_ORIGIN = { absorb: true }
// /v1 PUT 이 얹는 트랜잭션의 origin — 클라이언트와 공유하지 않는다
const WRITE_ORIGIN = { v1Write: true }
// 사후 검사가 고치는 트랜잭션의 origin (F-502 3.1)
export const COMMENT_FIX_ORIGIN = { commentFix: true }
// 댓글 명령·이관이 검사를 끝내고 쓰는 트랜잭션의 origin (F-503 4.2) — 클라이언트와 공유하지 않는다
export const COMMENT_SERVER_ORIGIN = { commentServer: true }
// 사후 검사를 건너뛰는 서버 origin (F-502 11.1)
export const SERVER_ORIGINS: ReadonlySet<unknown> = new Set<unknown>([ABSORB_ORIGIN, WRITE_ORIGIN, COMMENT_FIX_ORIGIN, COMMENT_SERVER_ORIGIN])

function applyEdit(text: Y.Text, edit: TextEdit | null | 'conflict') {
  if (!edit || edit === 'conflict') return
  if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from)
  if (edit.insert) text.insert(edit.from, edit.insert)
}

function rowState(row: DocRow): RoomDocState {
  return { title: row.title, content: row.content, version: row.version, updatedAt: row.updated_at }
}

export function readConnState(state: unknown): RoomConnState | null {
  if (typeof state !== 'object' || state === null) return null
  const s = state as Record<string, unknown>
  if (typeof s.userId !== 'string' || typeof s.email !== 'string') return null
  if (s.role !== 'owner' && s.role !== 'edit' && s.role !== 'view') return null
  return { userId: s.userId, email: s.email, role: s.role }
}

// 닫힌 쪽으로 — 상태를 읽을 수 없는 연결도 읽기 전용이다 (F-503 2.3)
export function isReadOnlyState(state: unknown): boolean {
  const role = readConnState(state)?.role
  return role !== 'owner' && role !== 'edit'
}

// view 연결의 awareness 는 중계하지 않는다 (F-503 2.4)
export function mayRelayAwareness(state: unknown): boolean {
  return !isReadOnlyState(state)
}

function readCommentRate(state: unknown): CommentRateState | null {
  if (typeof state !== 'object' || state === null) return null
  const rate = (state as Record<string, unknown>)[COMMENT_RATE_KEY] as Record<string, unknown> | null | undefined
  if (typeof rate !== 'object' || rate === null) return null
  if (!Number.isFinite(rate.start) || !Number.isFinite(rate.count)) return null
  return { start: rate.start as number, count: rate.count as number }
}

function validEntry(value: unknown): CommentEntry | null {
  const result = validateCommentEntry(value)
  return result.ok ? result.entry : null
}

function parentOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>).parent : undefined
}

// 이미 닫힌 소켓의 close 는 던질 수 있다
function safeClose(conn: RoomConnection, code: number, reason: string) {
  try {
    conn.close(code, reason)
  } catch {
    return
  }
}

export class DocRoomCore<C extends RoomConnection = RoomConnection> {
  private host: DocRoomHost<C>
  private storeInstance: YStore | null = null
  private base: Base | null = null
  private loaded = false
  private loadAttempted = false
  private gone = false
  private pending: Uint8Array[] = []
  private storedD1Version: number | null = null
  private tooLarge = false
  private lastBytes = 0
  private lastRevalidate: number | null = null
  private flushing: Promise<void> | null = null
  private flushAgain = false
  // 다음 한 번의 flush 가 느린 문을 건너뛴다 — writeText·알람 (F-2027 5.4·5.5)
  private bypassNext = false
  private ownerId: string | null = null
  private slowDay: string | null = null
  private blocked = false
  private lastBatchAt: number | null = null
  private alarmAt: number | null = null
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private loadFlushTimer: ReturnType<typeof setTimeout> | null = null
  private writeQueue: Promise<unknown> = Promise.resolve()
  // F-502 4.1 — D1 에 있는 댓글, D1 과 대조할 키, 마지막 전체 다시 적기 뒤 바뀌었나, 접근 집합 보관
  private known = new Map<string, KnownComment>()
  private dirty = new Set<string>()
  private anchorsDirty = false
  private fullAnchorsNext = false
  private people: { at: number; emails: Set<string> | null } | null = null

  constructor(host: DocRoomHost<C>) {
    this.host = host
  }

  private get store(): YStore {
    if (!this.storeInstance) this.storeInstance = new YStore(this.host.storage)
    return this.storeInstance
  }

  private get content(): Y.Text {
    return this.host.doc.getText(Y_CONTENT_NAME)
  }

  private get title(): Y.Text {
    return this.host.doc.getText(Y_TITLE_NAME)
  }

  private get comments(): Y.Map<unknown> {
    return this.host.doc.getMap(Y_COMMENTS_NAME)
  }

  private async readRow(): Promise<D1DocRow | null> {
    return this.host.env.DB.prepare(READ_ROW_SQL).bind(this.host.docId).first<D1DocRow>()
  }

  // 7.1 — 깨어날 때마다. 끝나기 전에는 연결을 받지 않는다(blockConcurrencyWhile)
  async load(): Promise<void> {
    const doc = this.host.doc
    // 앞선 시도가 실패했으면 document 에 저장소에 없는 구조가 남았을 수 있다 — 통째로 한 행 더 쓴다
    const leftover = this.loadAttempted ? Y.encodeStateAsUpdate(doc) : null
    this.loadAttempted = true
    const rows = this.store.load()
    doc.transact(() => {
      for (const row of rows) Y.applyUpdate(doc, row)
    })
    if (leftover && leftover.length > EMPTY_UPDATE_BYTES) {
      this.store.append(leftover)
      rows.push(leftover)
    }

    const row = await this.readRow()
    if (!row) {
      this.roomGone()
      return
    }
    const external = { content: toEditorText(row.content), title: row.title }
    // D1 댓글 복사본 — 씨앗 가지는 되살릴 전체 행, 그 밖은 대조할 표지만. document 를 건드리기 전에 읽는다 (F-502 4.1·5장)
    const seeding = rows.length === 0
    const known = seeding
      ? (await this.host.env.DB.prepare(ALL_COMMENTS_SQL).bind(this.host.docId).all<DocCommentDbRow>()).results
      : (await this.host.env.DB.prepare(KNOWN_COMMENTS_SQL).bind(this.host.docId).all<{ id: string; sig: string; anchor_sig: string }>()).results

    if (seeding) {
      doc.transact(() => {
        this.content.insert(0, external.content)
        this.title.insert(0, external.title)
      }, ABSORB_ORIGIN)
      if (known.length > 0) this.restoreComments(known as DocCommentDbRow[])
      this.store.writeBase(Y.encodeStateAsUpdate(doc), { schema: '1', d1_version: String(row.version) })
    } else if (this.store.getMeta('d1_version') !== String(row.version)) {
      // 기준점을 모른다 — 지금 document 를 기준으로 본다 (7.2 알려진 손실)
      let change: Uint8Array | null = null
      const capture = (update: Uint8Array) => (change = update)
      doc.on('update', capture)
      this.applyExternal({ content: this.content.toString(), title: this.title.toString() }, external)
      doc.off('update', capture)
      if (change) this.store.append(change, { d1_version: String(row.version) })
      else this.store.setMeta('d1_version', String(row.version))
    }

    this.storedD1Version = row.version
    this.ownerId = row.owner_id
    this.base = { ...external, version: row.version, lineEnding: row.line_ending, updatedAt: null, rowBytes: utf8ByteLength(row.content) }
    this.loaded = true
    this.known = new Map(known.map((r) => [r.id, { sig: r.sig, anchorSig: r.anchor_sig }]))
    this.dirty = new Set([...this.comments.keys(), ...this.known.keys()])
    // 깨어나기 전 인스턴스가 전체 다시 적기를 못 했을 수 있다 — 댓글이 있으면 다음 한 번은 돈다
    this.anchorsDirty = this.comments.size > 0
    doc.on('update', (update: Uint8Array) => {
      if (this.gone) return
      this.pending.push(update)
      this.anchorsDirty = true
    })
    this.comments.observe((event, tr) => this.onComments(event, tr))

    const commentsToCheck = this.comments.size > 0 || this.known.size > 0
    if (this.content.toString() !== this.base.content || this.clippedTitle() !== this.base.title || commentsToCheck) {
      this.loadFlushTimer = setTimeout(() => {
        this.loadFlushTimer = null
        void this.flush()
      }, LOAD_FLUSH_DELAY_MS)
    }
  }

  private clippedTitle(): string {
    return this.title.toString().slice(0, MAX_TITLE_CHARS)
  }

  // F-502 5장 — 씨앗 가지에서만. F-301 3.3 이 허락한 최초 씨앗 심기와 같은 자리다
  private restoreComments(rows: DocCommentDbRow[]) {
    const { entries } = restoreCommentEntries(this.content, rows.map(rowToCommentRecord))
    this.host.doc.transact(() => {
      for (const [id, entry] of entries) this.comments.set(id, entry)
    }, ABSORB_ORIGIN)
  }

  // F-502 3.1 — 모든 origin 에서 바뀐 키를 적고, 연결에서 온 트랜잭션만 검사·고친다
  private onComments(event: Y.YMapEvent<unknown>, tr: Y.Transaction) {
    if (this.gone) return
    for (const key of event.keysChanged) this.dirty.add(key)
    if (SERVER_ORIGINS.has(tr.origin)) return
    // y-partyserver 는 받은 갱신을 그 Connection 을 origin 으로 적용한다
    const origin = tr.origin as { state?: unknown } | null
    const state = readConnState(typeof origin === 'object' && origin !== null ? origin.state : null)
    const changes: CommentChange[] = []
    event.changes.keys.forEach((change, key) => changes.push({ key, action: change.action, oldValue: change.oldValue }))
    const fixes = planCommentFixes(new Map(this.comments.entries()), changes, state)
    if (fixes.length === 0) return
    this.host.doc.transact(() => {
      for (const fix of fixes) {
        if (fix.op === 'set') this.comments.set(fix.key, fix.value)
        else this.comments.delete(fix.key)
      }
    }, COMMENT_FIX_ORIGIN)
  }

  // base → external 변화를 지금 document 에 얹는다. 겹치면 DO 가 이긴다 (7.3)
  private applyExternal(base: { content: string; title: string }, external: { content: string; title: string }) {
    const contentEdit = rebaseExternal(base.content, external.content, this.content.toString())
    const titleEdit = rebaseExternal(base.title, external.title, this.title.toString())
    if (contentEdit === 'conflict' || titleEdit === 'conflict') {
      console.warn(`docRoom: external write overlaps room edits, room wins (${this.host.docId})`)
    }
    this.host.doc.transact(() => {
      applyEdit(this.content, contentEdit)
      applyEdit(this.title, titleEdit)
    }, ABSORB_ORIGIN)
  }

  private absorb(row: D1DocRow) {
    const base = this.base!
    const external = { content: toEditorText(row.content), title: row.title }
    this.applyExternal(base, external)
    this.base = { ...external, version: row.version, lineEnding: row.line_ending, updatedAt: null, rowBytes: utf8ByteLength(row.content) }
  }

  // Worker 가 본 D1 version 이 방과 다르면 D1 한 줄로 따라잡는다. false 면 방이 사라졌다 (7.2)
  private async catchUp(docVersion: number): Promise<boolean> {
    if (docVersion === this.base!.version) return true
    const row = await this.readRow()
    if (!row) {
      this.roomGone()
      return false
    }
    if (row.version !== this.base!.version) this.absorb(row)
    return true
  }

  // 새 연결 (5.3·7.2). false 면 이미 닫았다
  async connect(conn: C, docVersion: number, sendSyncStep1: () => void | Promise<void>): Promise<boolean> {
    if (this.gone || !this.loaded || !(await this.catchUp(docVersion))) {
      safeClose(conn, SOCKET_CLOSE.notFound, 'deleted')
      return false
    }
    await sendSyncStep1()
    if (this.tooLarge) this.host.sendCustom(conn, this.tooLargeMessage())
    return true
  }

  private tooLargeMessage(): string {
    return encodeDocRoomMessage({ type: 'too-large', limit: MAX_CONTENT_BYTES, bytes: this.lastBytes })
  }

  private setTooLarge(bytes: number) {
    if (this.tooLarge) return
    this.lastBytes = bytes
    this.tooLarge = true
    this.host.broadcastCustom(this.tooLargeMessage())
  }

  private setSizeOk() {
    if (!this.tooLarge) return
    this.tooLarge = false
    this.host.broadcastCustom(encodeDocRoomMessage({ type: 'size-ok' }))
  }

  // 6.2 — 겹쳐 돌지 않는다. 도는 중에 불리면 끝난 뒤 한 번 더
  flush(): Promise<void> {
    return this.runFlush(false)
  }

  // 합쳐지면 강제 표시는 뒤이은 한 번에 실린다 (F-2027 5.4)
  private runFlush(fromRetry: boolean, bypassSlow = false, fullAnchors = false): Promise<void> {
    if (bypassSlow) this.bypassNext = true
    if (fullAnchors) this.fullAnchorsNext = true
    if (this.flushing) {
      this.flushAgain = true
      return this.flushing
    }
    this.flushing = (async () => {
      try {
        let retry = fromRetry
        do {
          this.flushAgain = false
          const bypass = this.bypassNext
          this.bypassNext = false
          const full = this.fullAnchorsNext
          this.fullAnchorsNext = false
          await this.flushOnce(retry, bypass, full)
          retry = false
        } while (this.flushAgain)
      } finally {
        this.flushing = null
      }
    })()
    return this.flushing
  }

  // 마지막 연결이 닫혔다 — 타이머를 기다리지 않고 곧바로 (6.2, 10.2 R4). 댓글 앵커 전체 다시 적기 한 번 (F-502 4.5)
  roomEmptied(): Promise<void> {
    return this.runFlush(false, false, true)
  }

  // DO 알람 (F-2027 5.5) — 60초 검사만 건너뛴 flush 하나. 댓글 앵커 전체 다시 적기 한 번 (F-502 4.5)
  async alarm(): Promise<void> {
    this.alarmAt = null
    if (this.gone || !this.loaded) return
    await this.runFlush(false, true, true)
  }

  private persistPending() {
    if (this.pending.length > 0) {
      const merged = this.pending.length === 1 ? this.pending[0] : Y.mergeUpdates(this.pending)
      this.store.append(merged)
      this.pending = []
      if (this.store.shouldCompact()) this.store.writeBase(Y.encodeStateAsUpdate(this.host.doc))
    }
    if (this.base && this.storedD1Version !== this.base.version) {
      this.store.setMeta('d1_version', String(this.base.version))
      this.storedD1Version = this.base.version
    }
  }

  private async flushOnce(fromRetry: boolean, bypassSlow: boolean, fullAnchors: boolean) {
    if (!this.loaded || this.gone) return
    if (this.loadFlushTimer) {
      clearTimeout(this.loadFlushTimer)
      this.loadFlushTimer = null
    }
    if (!fromRetry) {
      this.retryCount = 0
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
    }

    this.persistPending()

    let result: SnapshotResult
    try {
      result = await this.snapshot(bypassSlow, fullAnchors)
    } catch (err) {
      console.warn(`docRoom: snapshot failed (${this.host.docId})`, err)
      // 전체 다시 적기 요청은 다시 시도에 실린다
      if (fullAnchors) this.fullAnchorsNext = true
      result = 'retry'
    }
    if (result === 'gone') return
    if (result === 'retry') this.scheduleRetry()

    if (this.lastRevalidate === null || Date.now() - this.lastRevalidate >= REVALIDATE_INTERVAL_MS) {
      await this.revalidateConnections()
    }
  }

  private scheduleRetry() {
    if (this.retryCount >= SNAPSHOT_RETRY_MAX) {
      console.error(`docRoom: snapshot gave up after ${SNAPSHOT_RETRY_MAX} retries (${this.host.docId})`)
      return
    }
    this.retryCount++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.runFlush(true)
    }, SNAPSHOT_RETRY_MS)
  }

  // F-2027 5.2 3·4번 — false 면 이번 스냅숏은 D1 에 쓰지 않는다
  private async mayWrite(bypassSlow: boolean): Promise<boolean> {
    if (this.blocked) {
      const row = await this.host.env.DB.prepare(BLOCKED_SQL).bind(this.ownerId).first<{ blocked_at: number | null }>()
      if (row && row.blocked_at !== null) return false
      this.blocked = false
    }
    const now = Date.now()
    const slow = this.slowDay === utcDay(now) && this.lastBatchAt !== null && now - this.lastBatchAt < SLOW_SNAPSHOT_MS
    if (bypassSlow || !slow) return true
    await this.scheduleAlarm(this.lastBatchAt! + SLOW_SNAPSHOT_MS)
    return false
  }

  // 같은 창 안에서 setAlarm 을 되풀이하지 않는다
  private async scheduleAlarm(at: number) {
    if (this.alarmAt !== null && this.alarmAt > Date.now()) return
    this.alarmAt = at
    try {
      await this.host.setAlarm(at)
    } catch (err) {
      console.warn(`docRoom: setAlarm failed (${this.host.docId})`, err)
      this.alarmAt = null
    }
  }

  // F-2027 5.2 5번 — 사용량 행이 없으면 판정하지 않는다
  private judgeUsage(row: UsageRow | undefined, now: number) {
    if (!row) {
      this.slowDay = null
      return
    }
    const usage = rowToUsage(row)
    if (usage.blockedAt !== null && !this.blocked) {
      this.blocked = true
      console.warn(`docRoom: owner blocked, snapshots paused (${this.host.docId})`)
    }
    const today = utcDay(now)
    if (!isDailyLimitReached(usage, now)) {
      this.slowDay = null
      return
    }
    if (this.slowDay !== today) console.warn(`docRoom: owner over daily write limit, slow snapshots (${this.host.docId})`)
    this.slowDay = today
  }

  // 8.2 — 조건부 UPDATE, 0행이면 흡수 후 한 번만 다시. 소유자 사용량 줄과 한 batch (F-2027 4.2)
  // 본문 쪽과 댓글 쪽을 따로 판정한다. 댓글 변화가 없으면 batch 는 전과 글자까지 같다 (F-502 4.2·4.3)
  private async snapshot(bypassSlow: boolean, fullAnchors: boolean): Promise<SnapshotResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = this.base!
      const content = this.content.toString()
      const title = this.clippedTitle()
      const bodySame = content === base.content && title === base.title
      let out = ''
      let bytes = 0
      let writeBody = false
      if (!bodySame) {
        out = fromEditorText(content, base.lineEnding)
        bytes = utf8ByteLength(out)
        if (bytes > MAX_CONTENT_BYTES) this.setTooLarge(bytes)
        else writeBody = true
      }
      const full = attempt === 0 && fullAnchors && this.anchorsDirty
      if (!writeBody && this.dirty.size === 0 && !full) {
        if (bodySame) this.setSizeOk()
        return 'ok'
      }
      if (attempt === 0 && !(await this.mayWrite(bypassSlow))) return 'ok'
      const now = Date.now()
      const plan = await this.takeCommentPlan(full, now)
      if (!writeBody && !plan) {
        if (bodySame) this.setSizeOk()
        return 'ok'
      }
      const version = base.version + 1
      const db = this.host.env.DB
      const head = writeBody
        ? [
            db.prepare(UPDATE_SQL).bind(title, out, version, now, this.host.docId, base.version),
            snapshotUsageStatement(db, this.ownerId!, now, bytes - base.rowBytes),
          ]
        : [snapshotUsageStatement(db, this.ownerId!, now, 0)]
      const bundle = plan
        ? commentBundleStatements(db, { docId: this.host.docId, ownerId: this.ownerId!, ...plan, docTitle: title, now })
        : []
      let results: D1Result<UsageRow>[]
      try {
        results = await db.batch<UsageRow>([...head, ...bundle])
      } catch (err) {
        if (plan) this.returnCommentPlan(plan)
        throw err
      }
      this.lastBatchAt = Date.now()
      // 던지지 않고 돌아왔으면 댓글 묶음은 커밋됐다 — UPDATE 가 0행이어도
      if (plan) this.commitCommentPlan(plan)
      this.judgeUsage(results[writeBody ? 1 : 0].results?.[0], now)
      if (!writeBody) {
        if (bodySame) this.setSizeOk()
        return 'ok'
      }
      const written = results[0]
      if (written.meta.changes === 1) {
        this.base = { content, title, version, lineEnding: base.lineEnding, updatedAt: now, rowBytes: bytes }
        this.store.setMeta('d1_version', String(version))
        this.storedD1Version = version
        this.setSizeOk()
        return 'ok'
      }
      if (attempt === 1) return 'retry'
      if (this.blocked) return 'ok'
      const row = await this.readRow()
      if (!row) {
        this.roomGone()
        return 'gone'
      }
      this.absorb(row)
      // 흡수한 바꾸기를 D1 보다 먼저 SQLite 에 — 다음 깨어남이 그것을 잃지 않게
      this.persistPending()
    }
    return 'retry'
  }

  // F-502 4.2 — 이번에 다룰 키를 dirty 에서 떼어 온다. 실패하면 returnCommentPlan 이 되돌린다
  private async takeCommentPlan(full: boolean, now: number): Promise<CommentPlan | null> {
    const keys = [...this.dirty]
    this.dirty.clear()
    if (full) this.anchorsDirty = false
    try {
      return await this.buildCommentPlan(keys, full, now)
    } catch (err) {
      this.returnCommentPlan({ keys, full })
      throw err
    }
  }

  private returnCommentPlan(plan: { keys: string[]; full: boolean }) {
    for (const key of plan.keys) this.dirty.add(key)
    if (plan.full) this.anchorsDirty = true
  }

  private commitCommentPlan(plan: CommentPlan) {
    for (const row of plan.upserts) this.known.set(row.id, { sig: row.sig, anchorSig: row.anchorSig })
    for (const id of plan.deletes) this.known.delete(id)
  }

  private async buildCommentPlan(keys: string[], full: boolean, now: number): Promise<CommentPlan | null> {
    const text = this.content.toString()
    const grouped = groupCommentThreads(this.comments.entries())
    const live = new Map<string, { entry: CommentEntry; thread: CommentThread }>()
    for (const thread of grouped.threads) {
      live.set(thread.id, { entry: thread.root, thread })
      for (const r of thread.replies) live.set(r.id, { entry: r.entry, thread })
    }
    const ranges = full ? resolveCommentAnchors(this.content, grouped.threads.map((t) => [t.id, t.root] as const)) : null
    const rowOf = (id: string, entry: CommentEntry) => {
      const range = entry.parent !== null ? null : ranges ? (ranges.get(id) ?? null) : resolveCommentAnchor(this.content, entry.anchor)
      return commentRowOf(id, entry, text, range)
    }

    const upserts = new Map<string, CommentRow>()
    const deletes: string[] = []
    for (const key of keys) {
      const item = live.get(key)
      if (item) {
        if (this.known.get(key)?.sig !== commentSig(item.entry)) upserts.set(key, rowOf(key, item.entry))
      } else if (this.known.has(key)) {
        deletes.push(key)
      }
    }
    if (full) {
      for (const thread of grouped.threads) {
        if (upserts.has(thread.id)) continue
        const row = rowOf(thread.id, thread.root)
        if (this.known.get(thread.id)?.anchorSig !== row.anchorSig) upserts.set(thread.id, row)
      }
    }
    if (upserts.size === 0 && deletes.length === 0) return null
    const rows = [...upserts.values()]
    return { keys, full, upserts: rows, deletes, drafts: await this.notificationDrafts(rows, live, now) }
  }

  // F-502 6장 — D1 에 없던 새 항목만. 접근 집합은 멘션이나 답글이 있을 때만 읽는다
  private async notificationDrafts(
    rows: CommentRow[],
    live: Map<string, { entry: CommentEntry; thread: CommentThread }>,
    now: number,
  ): Promise<NotificationDraft[]> {
    const fresh = rows
      .filter((r) => !this.known.has(r.id))
      .map((r) => ({ id: r.id, ...live.get(r.id)! }))
      .sort((a, b) => a.entry.createdAt - b.entry.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    if (!fresh.some((f) => f.entry.mentions.length > 0 || f.entry.parent !== null)) return []
    const people = await this.docPeople(now)
    if (!people) return []
    const drafts = fresh.flatMap((f) => notificationTargets({ id: f.id, entry: f.entry }, f.entry.parent !== null ? f.thread : null, people))
    if (drafts.length <= NOTIFICATIONS_PER_BATCH_MAX) return drafts
    console.warn(`docRoom: notifications capped (${this.host.docId})`)
    return drafts.slice(0, NOTIFICATIONS_PER_BATCH_MAX)
  }

  // 60초(REVALIDATE_INTERVAL_MS) 안에 읽은 것이 있으면 그것을 쓴다 (F-502 6.3)
  private async docPeople(now: number): Promise<Set<string> | null> {
    if (this.people && now - this.people.at < REVALIDATE_INTERVAL_MS) return this.people.emails
    const list = await loadDocPeople(this.host.env, this.host.docId)
    const emails = list ? new Set(list.map((p) => p.email)) : null
    this.people = { at: now, emails }
    return emails
  }

  // 9.3 — 불러오기 없이 연결 상태와 D1 한 줄만으로
  async revalidateConnections(email?: string): Promise<void> {
    if (this.gone) return
    const targets = [...this.host.connections()].filter((c) => !email || readConnState(c.state)?.email === email)
    if (targets.length === 0) return
    const row = await this.host.env.DB.prepare(ACCESS_ROW_SQL)
      .bind(this.host.docId)
      .first<{ id: string; owner_id: string; folder_id: string | null }>()
    if (!row) {
      this.roomGone()
      return
    }
    for (const conn of targets) {
      if (!(await this.stillAllowed(conn, row))) safeClose(conn, SOCKET_CLOSE.forbidden, 'revoked')
    }
    this.lastRevalidate = Date.now()
  }

  // F-503 3장 — 연결 상태의 역할로 가른다. 승격된 view 연결은 view 그대로 둔다
  private async stillAllowed(conn: C, row: { id: string; owner_id: string; folder_id: string | null }): Promise<boolean> {
    const state = readConnState(conn.state)
    if (!state) return false
    const user = { id: state.userId, email: state.email }
    const access = await resolveDocAccess(this.host.env, row, user)
    if (!access) return false
    if (state.role !== 'view') return roleAtLeast(access.role, 'edit')
    if (access.blocked) return false
    if (access.role === 'view') return !(await isWriteBlocked(this.host.env, row, user))
    return true
  }

  // F-503 4장 — 동기. await 가 없어 한 연결의 응답은 보낸 순서대로 간다
  handleCommentOp(conn: C & StatefulConnection, text: string): void {
    if (this.gone || !this.loaded) return
    const parsed = parseCommentOp(text)
    const id = parsed.ok ? parsed.op.id : parsed.id
    if (id === null) return
    const reply = (reason: CommentOpRejectReason | null) =>
      this.host.sendCustom(conn, encodeCommentOpReply(reason === null ? { type: 'comment-ack', id } : { type: 'comment-reject', id, reason }))
    const state = readConnState(conn.state)
    if (!state) return reply('forbidden')
    if (!this.takeCommentRate(conn)) return reply('rate_limited')
    if (!parsed.ok) return reply('invalid')
    reply(this.applyCommentOp(parsed.op, state))
  }

  // 고정 창 — 거절된 메시지도 센다 (F-503 4.3)
  private takeCommentRate(conn: StatefulConnection): boolean {
    const now = Date.now()
    const prev = readCommentRate(conn.state)
    const fresh = !prev || now - prev.start >= COMMENT_RATE_WINDOW_MS || now < prev.start
    const next: CommentRateState = fresh ? { start: now, count: 1 } : { start: prev.start, count: prev.count + 1 }
    conn.setState((old: unknown) => ({ ...((old as object | null) ?? {}), [COMMENT_RATE_KEY]: next }))
    return next.count <= COMMENT_OPS_PER_MINUTE
  }

  // 4.4 표 순서 그대로. null 이면 ack
  private applyCommentOp(op: CommentOp, state: RoomConnState): CommentOpRejectReason | null {
    const actor: CommentActor = { kind: 'server', userId: state.userId, role: state.role, blocked: false }
    const author = { id: state.userId, email: state.email }
    const comments = this.comments
    if (op.type === 'comment-delete') {
      if (!comments.has(op.id)) return null
      const target = validEntry(comments.get(op.id))
      if (!target) return 'invalid'
      if (!commentAllowed(actor, 'delete', target)) return 'forbidden'
      this.host.doc.transact(() => {
        if (target.parent === null) {
          for (const [key, value] of [...comments.entries()]) if (parentOf(value) === op.id) comments.delete(key)
        }
        comments.delete(op.id)
      }, COMMENT_SERVER_ORIGIN)
      return null
    }
    const action = op.type === 'comment-add' ? 'add' : op.type === 'comment-reply' ? 'reply' : 'resolve'
    if (!commentAllowed(actor, action)) return 'forbidden'

    if (op.type !== 'comment-resolve' && comments.has(op.id)) {
      const existing = validEntry(comments.get(op.id))
      return existing && existing.author.id === state.userId ? null : 'invalid'
    }
    const { threads } = groupCommentThreads(comments.entries())
    // 첫 댓글이 아니면 — 올바른 답글이면 invalid, 없거나 깨졌으면 not_found
    const rootOf = (key: string): CommentThread | CommentOpRejectReason => {
      const thread = threads.find((t) => t.id === key)
      if (thread) return thread
      return validEntry(comments.get(key))?.parent != null ? 'invalid' : 'not_found'
    }

    if (op.type === 'comment-resolve') {
      const thread = rootOf(op.id)
      if (typeof thread === 'string') return thread
      if (op.resolved === (thread.root.resolved !== null)) return null
      const next = validEntry({ ...thread.root, resolved: op.resolved ? { by: author, at: Date.now() } : null })
      if (!next) return 'invalid'
      this.host.doc.transact(() => comments.set(op.id, next), COMMENT_SERVER_ORIGIN)
      return null
    }

    let draft: unknown
    let reopen: CommentEntry | null = null
    if (op.type === 'comment-add') {
      if (checkCommentCapacity(threads, null)) return 'too_many'
      const anchor = { start: op.start, end: op.end }
      const range = resolveCommentAnchor(this.content, anchor)
      if (!range) return 'invalid'
      const quote = commentQuote(this.content.toString().slice(range.from, range.to))
      draft = { v: 1, parent: null, anchor, quote, body: op.body, mentions: op.mentions, author, createdAt: Date.now(), resolved: null }
    } else {
      const thread = rootOf(op.parent)
      if (typeof thread === 'string') return thread
      if (checkCommentCapacity(threads, op.parent)) return 'too_many'
      draft = { v: 1, parent: op.parent, anchor: null, quote: '', body: op.body, mentions: op.mentions, author, createdAt: Date.now(), resolved: null }
      if (thread.root.resolved !== null) reopen = { ...thread.root, resolved: null }
    }
    const checked = validateCommentEntry(draft)
    if (!checked.ok) return commentRejectReason(checked.error)
    this.host.doc.transact(() => {
      comments.set(op.id, checked.entry)
      if (reopen && op.type === 'comment-reply') comments.set(op.parent, reopen)
    }, COMMENT_SERVER_ORIGIN)
    return null
  }

  // F-503 5장 — writeLive 와 같은 틀. 4번(비었나)과 5번(쓰기) 사이에 await 가 없다
  async importComments(input: RoomCommentImport): Promise<RoomCommentImportResult> {
    await this.host.ensureLoaded()
    if (this.gone) return { type: 'not_found' }
    if (!this.loaded) return { type: 'unavailable' }
    if (!(await this.catchUp(input.docVersion))) return { type: 'not_found' }
    if (this.comments.size !== 0) return { type: 'exists' }
    const { entries, orphaned } = restoreCommentEntries(this.content, input.records, { id: input.user.id, email: input.user.email })
    this.host.doc.transact(() => {
      for (const [id, entry] of entries) this.comments.set(id, entry)
    }, COMMENT_SERVER_ORIGIN)
    // 스냅숏이 실패해도 갱신은 DO 저장소에 남았다 — 다시 시도·다음 스냅숏이 D1 을 맞춘다
    await this.runFlush(false, true)
    return { type: 'ok', imported: entries.length, orphaned }
  }

  // /v1 PUT (F-308 5·6장) — 한 번에 하나씩 (6.8)
  writeText(input: RoomTextWrite): Promise<RoomTextWriteResult> {
    const run = this.writeQueue.then(() => this.writeTextNow(input))
    this.writeQueue = run.catch(() => undefined)
    return run
  }

  private hasConnections(): boolean {
    return !this.host.connections()[Symbol.iterator]().next().done
  }

  // 고르는 판단과 exclusive 호출 사이에 await 가 없어야 한다 (5.2)
  private writeTextNow(input: RoomTextWrite): Promise<RoomTextWriteResult> {
    if (!this.loaded && !this.hasConnections()) return this.host.exclusive(() => this.writeIdle(input))
    return this.writeLive(input)
  }

  // 5.5 — Yjs·SQLite·타이머를 건드리지 않는다
  private async writeIdle(input: RoomTextWrite): Promise<RoomTextWriteResult> {
    const readFull = () => this.host.env.DB.prepare(FULL_ROW_SQL).bind(this.host.docId).first<DocRow>()
    const row = await readFull()
    if (!row) return { type: 'not_found' }
    const same = (input.content === undefined || input.content === row.content) && (input.title === undefined || input.title === row.title)
    if (same) return { type: 'ok', doc: rowState(row) }
    if (input.baseVersion !== row.version) return { type: 'conflict', doc: rowState(row) }
    const written = await updateDocRow(this.host.env, row, { title: input.title, content: input.content })
    if (written.ok) return { type: 'ok', doc: rowState(written.row) }
    const latest = await readFull()
    return latest ? { type: 'conflict', doc: rowState(latest) } : { type: 'not_found' }
  }

  private baseState(): RoomDocState {
    const base = this.base!
    return { title: base.title, content: fromEditorText(base.content, base.lineEnding), version: base.version, updatedAt: base.updatedAt }
  }

  // 6장 — 순서가 계약이다. 4~8 번 사이에 await 가 없다
  private async writeLive(input: RoomTextWrite): Promise<RoomTextWriteResult> {
    await this.host.ensureLoaded()
    if (this.gone) return { type: 'not_found' }
    if (!this.loaded) return { type: 'unavailable' }
    if (!(await this.catchUp(input.docVersion))) return { type: 'not_found' }
    await this.runFlush(false, true)
    if (this.gone) return { type: 'not_found' }

    const nextContent = input.content === undefined ? undefined : toEditorText(input.content)
    const currentContent = this.content.toString()
    const currentTitle = this.title.toString()
    const same = (nextContent === undefined || nextContent === currentContent) && (input.title === undefined || input.title === currentTitle)
    if (same) {
      // D1 이 아직 지금 값을 못 받았으면(flush 실패·크기 초과) 200 으로 옛 값을 주지 않는다
      const synced = this.base!.content === currentContent && this.base!.title === this.clippedTitle()
      return synced ? { type: 'ok', doc: this.baseState() } : { type: 'unavailable' }
    }
    if (input.baseVersion !== this.base!.version) return { type: 'conflict', doc: this.baseState() }

    const base = this.base!
    const contentEdit = nextContent === undefined ? null : rebaseExternal(base.content, nextContent, currentContent)
    const titleEdit = input.title === undefined ? null : rebaseExternal(base.title, input.title, currentTitle)
    if (contentEdit === 'conflict' || titleEdit === 'conflict') return { type: 'conflict', doc: this.baseState() }

    if (contentEdit) {
      const next = currentContent.slice(0, contentEdit.from) + contentEdit.insert + currentContent.slice(contentEdit.to)
      const bytes = utf8ByteLength(fromEditorText(next, base.lineEnding))
      if (bytes > MAX_CONTENT_BYTES) return { type: 'too_large', bytes }
    }
    if (!contentEdit && !titleEdit) return { type: 'ok', doc: this.baseState() }

    this.host.doc.transact(() => {
      applyEdit(this.content, contentEdit)
      applyEdit(this.title, titleEdit)
    }, WRITE_ORIGIN)

    const before = base.version
    await this.runFlush(false, true)
    if (this.gone) return { type: 'not_found' }
    return this.base!.version > before ? { type: 'ok', doc: this.baseState() } : { type: 'unavailable' }
  }

  private closeAll(code: number, reason: string) {
    for (const conn of [...this.host.connections()]) safeClose(conn, code, reason)
  }

  private markGone() {
    this.gone = true
    this.pending = []
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.loadFlushTimer) clearTimeout(this.loadFlushTimer)
    this.retryTimer = null
    this.loadFlushTimer = null
    this.known = new Map()
    this.dirty = new Set()
    this.anchorsDirty = false
    this.fullAnchorsNext = false
    this.people = null
  }

  // 사라진 방 (9.4) — 연결 4404 deleted, 저장소 비우기, 이후 flush 는 아무것도 안 한다
  private roomGone() {
    this.closeAll(SOCKET_CLOSE.notFound, 'deleted')
    this.markGone()
    this.store.clear()
  }

  // 문서 삭제 알림 (9.4). 저장소 비우기는 껍데기가 deleteAll 로 한다
  purge() {
    this.closeAll(SOCKET_CLOSE.notFound, 'deleted')
    this.markGone()
  }
}
