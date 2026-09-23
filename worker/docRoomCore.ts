// DocRoom 규칙 (specs/features/F-304.md 6~9장). partyserver·cloudflare:workers 를 import 하지 않는다 — node 테스트가 통째로 부른다
import * as Y from 'yjs'

import { SOCKET_CLOSE, Y_CONTENT_NAME, Y_TITLE_NAME, encodeDocRoomMessage } from '../src/lib/docRoomProtocol'
import { fromEditorText, toEditorText } from '../src/lib/lineEnding'
import type { LineEnding } from '../src/lib/lineEnding'
import { resolveDocAccess, roleAtLeast } from './access'
import { rebaseExternal } from './textRebase'
import type { TextEdit } from './textRebase'
import { MAX_CONTENT_BYTES, MAX_TITLE_CHARS, utf8ByteLength } from './validate'
import { YStore } from './yStore'
import type { DoStorageLike } from './yStore'

export const FLUSH_DEBOUNCE_MS = 5_000
export const FLUSH_MAX_WAIT_MS = 30_000
export const LOAD_FLUSH_DELAY_MS = 5_000
export const SNAPSHOT_RETRY_MS = 5_000
export const SNAPSHOT_RETRY_MAX = 3
export const REVALIDATE_INTERVAL_MS = 60_000

export type RoomRole = 'owner' | 'edit'
export type RoomConnState = { userId: string; email: string; role: RoomRole }

export interface RoomConnection {
  readonly state: unknown
  close(code: number, reason: string): void
}

export interface DocRoomHost<C extends RoomConnection = RoomConnection> {
  docId: string
  env: Env
  storage: DoStorageLike
  doc: Y.Doc
  connections(): Iterable<C>
  sendCustom(conn: C, message: string): void
  broadcastCustom(message: string): void
}

type D1DocRow = { title: string; content: string; line_ending: LineEnding; version: number }
type Base = { content: string; title: string; version: number; lineEnding: LineEnding }
type SnapshotResult = 'ok' | 'retry' | 'gone'

const READ_ROW_SQL = 'SELECT title, content, line_ending, version FROM docs WHERE id = ?'
const ACCESS_ROW_SQL = 'SELECT id, owner_id, folder_id FROM docs WHERE id = ?'
const UPDATE_SQL = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?'

// 빈 Doc 의 encodeStateAsUpdate 길이
const EMPTY_UPDATE_BYTES = 2

// 서버가 D1 값을 얹는 트랜잭션의 origin — 클라이언트와 공유하지 않는다
const ABSORB_ORIGIN = { absorb: true }

export function readConnState(state: unknown): RoomConnState | null {
  if (typeof state !== 'object' || state === null) return null
  const s = state as Record<string, unknown>
  if (typeof s.userId !== 'string' || typeof s.email !== 'string') return null
  if (s.role !== 'owner' && s.role !== 'edit') return null
  return { userId: s.userId, email: s.email, role: s.role }
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
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private loadFlushTimer: ReturnType<typeof setTimeout> | null = null

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

    if (rows.length === 0) {
      doc.transact(() => {
        this.content.insert(0, external.content)
        this.title.insert(0, external.title)
      }, ABSORB_ORIGIN)
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
    this.base = { ...external, version: row.version, lineEnding: row.line_ending }
    this.loaded = true
    doc.on('update', (update: Uint8Array) => {
      if (!this.gone) this.pending.push(update)
    })

    if (this.content.toString() !== this.base.content || this.clippedTitle() !== this.base.title) {
      this.loadFlushTimer = setTimeout(() => {
        this.loadFlushTimer = null
        void this.flush()
      }, LOAD_FLUSH_DELAY_MS)
    }
  }

  private clippedTitle(): string {
    return this.title.toString().slice(0, MAX_TITLE_CHARS)
  }

  // base → external 변화를 지금 document 에 얹는다. 겹치면 DO 가 이긴다 (7.3)
  private applyExternal(base: { content: string; title: string }, external: { content: string; title: string }) {
    const contentEdit = rebaseExternal(base.content, external.content, this.content.toString())
    const titleEdit = rebaseExternal(base.title, external.title, this.title.toString())
    if (contentEdit === 'conflict' || titleEdit === 'conflict') {
      console.warn(`docRoom: external write overlaps room edits, room wins (${this.host.docId})`)
    }
    const apply = (text: Y.Text, edit: TextEdit | null | 'conflict') => {
      if (!edit || edit === 'conflict') return
      if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from)
      if (edit.insert) text.insert(edit.from, edit.insert)
    }
    this.host.doc.transact(() => {
      apply(this.content, contentEdit)
      apply(this.title, titleEdit)
    }, ABSORB_ORIGIN)
  }

  private absorb(row: D1DocRow) {
    const base = this.base!
    const external = { content: toEditorText(row.content), title: row.title }
    this.applyExternal(base, external)
    this.base = { ...external, version: row.version, lineEnding: row.line_ending }
  }

  // 새 연결 (5.3·7.2). false 면 이미 닫았다
  async connect(conn: C, docVersion: number, sendSyncStep1: () => void | Promise<void>): Promise<boolean> {
    if (this.gone || !this.loaded) {
      safeClose(conn, SOCKET_CLOSE.notFound, 'deleted')
      return false
    }
    if (docVersion !== this.base!.version) {
      const row = await this.readRow()
      if (!row) {
        this.roomGone()
        safeClose(conn, SOCKET_CLOSE.notFound, 'deleted')
        return false
      }
      if (row.version !== this.base!.version) this.absorb(row)
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

  private runFlush(fromRetry: boolean): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true
      return this.flushing
    }
    this.flushing = (async () => {
      try {
        let retry = fromRetry
        do {
          this.flushAgain = false
          await this.flushOnce(retry)
          retry = false
        } while (this.flushAgain)
      } finally {
        this.flushing = null
      }
    })()
    return this.flushing
  }

  // 마지막 연결이 닫혔다 — 타이머를 기다리지 않고 곧바로 (6.2, 10.2 R4)
  roomEmptied(): Promise<void> {
    return this.flush()
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

  private async flushOnce(fromRetry: boolean) {
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
      result = await this.snapshot()
    } catch (err) {
      console.warn(`docRoom: snapshot failed (${this.host.docId})`, err)
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

  // 8.2 — 조건부 UPDATE, 0행이면 흡수 후 한 번만 다시
  private async snapshot(): Promise<SnapshotResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = this.base!
      const content = this.content.toString()
      const title = this.clippedTitle()
      if (content === base.content && title === base.title) {
        this.setSizeOk()
        return 'ok'
      }
      const out = fromEditorText(content, base.lineEnding)
      const bytes = utf8ByteLength(out)
      if (bytes > MAX_CONTENT_BYTES) {
        this.setTooLarge(bytes)
        return 'ok'
      }
      const version = base.version + 1
      const result = await this.host.env.DB.prepare(UPDATE_SQL)
        .bind(title, out, version, Date.now(), this.host.docId, base.version)
        .run()
      if (result.meta.changes === 1) {
        this.base = { content, title, version, lineEnding: base.lineEnding }
        this.store.setMeta('d1_version', String(version))
        this.storedD1Version = version
        this.setSizeOk()
        return 'ok'
      }
      if (attempt === 1) return 'retry'
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
      const state = readConnState(conn.state)
      const access = state ? await resolveDocAccess(this.host.env, row, { id: state.userId, email: state.email }) : null
      if (!access || !roleAtLeast(access.role, 'edit')) safeClose(conn, SOCKET_CLOSE.forbidden, 'revoked')
    }
    this.lastRevalidate = Date.now()
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
