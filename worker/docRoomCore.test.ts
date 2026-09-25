// DocRoom 규칙 — 불러오기·씨앗·흡수·flush·스냅샷·크기·권한·비우기 (specs/features/F-304.md 6~9장, A5~A20)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

vi.mock('./access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./access')>()
  return { ...actual, resolveDocAccess: vi.fn() }
})

import { resolveDocAccess } from './access'
import { DocRoomCore, REVALIDATE_INTERVAL_MS, SNAPSHOT_RETRY_MS } from './docRoomCore'
import type { DocRoomHost, RoomConnection } from './docRoomCore'
import type { DoStorageLike } from './yStore'
import { encodeDocRoomMessage } from '../src/lib/docRoomProtocol'

const DOC_ID = '11111111-1111-4111-8111-111111111111'
const CLIENT = { client: true }
const ROW_UPDATE_SQL = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?'
const ROOM_UPDATE_SQL = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?'
// F-2025 5.1 — 하루·누계 문장 (보낸 사람 = 소유자)
const DAY_AND_TOTAL_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, content_bytes = content_bytes + CASE WHEN changes() = 1 THEN ?2 ELSE 0 END, doc_count = doc_count + CASE WHEN changes() = 1 THEN ?3 ELSE 0 END WHERE id = ?4'

type D1Doc = {
  id: string
  owner_id: string
  folder_id: string | null
  title: string
  content: string
  line_ending: 'crlf' | 'lf'
  version: number
  pinned_at: number | null
  created_at: number
  updated_at: number
  e2ee_key?: string | null
}

type SqlCall = { sql: string; args: unknown[] }
type UsageRow = {
  write_day: string | null
  write_count: number
  content_bytes: number
  doc_count: number
  blocked_at: number | null
  warned_at: number | null
}

function makeD1(initial: Partial<D1Doc> | null) {
  const state = {
    row: initial
      ? ({
          id: DOC_ID,
          owner_id: 'owner',
          folder_id: null,
          title: '',
          content: '',
          line_ending: 'lf',
          version: 1,
          pinned_at: null,
          created_at: 0,
          updated_at: 0,
          ...initial,
        } as D1Doc)
      : null,
    calls: [] as SqlCall[],
    batches: [] as SqlCall[][],
    usage: { write_day: '1970-01-01', write_count: 1, content_bytes: 0, doc_count: 0, blocked_at: null, warned_at: null } as UsageRow | null,
    failUpdate: false,
    beforeUpdate: null as (() => unknown) | null,
  }
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            sql,
            args,
            async first<T>() {
              state.calls.push({ sql, args })
              // F-401 X16 — 금고 행은 AND e2ee_key IS NULL 에 걸려 없는 행이 된다
              const hidden = !!state.row?.e2ee_key && sql.endsWith(' AND e2ee_key IS NULL')
              if (sql.startsWith('SELECT title, content, line_ending, version, owner_id FROM docs WHERE id = ?')) {
                if (!state.row || args[0] !== state.row.id || hidden) return null
                const { title, content, line_ending, version, owner_id } = state.row
                return { title, content, line_ending, version, owner_id } as T
              }
              if (sql === 'SELECT blocked_at FROM users WHERE id = ?') {
                return (state.usage ? { blocked_at: state.usage.blocked_at } : null) as T
              }
              if (sql.startsWith('SELECT id, owner_id, folder_id FROM docs WHERE id = ?')) {
                if (!state.row || args[0] !== state.row.id || hidden) return null
                const { id, owner_id, folder_id } = state.row
                return { id, owner_id, folder_id } as T
              }
              if (sql.startsWith('SELECT * FROM docs WHERE id = ?')) {
                if (!state.row || args[0] !== state.row.id || hidden) return null
                return { ...state.row } as T
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async run() {
              state.calls.push({ sql, args })
              if (sql.startsWith('UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')) {
                if (state.beforeUpdate) await state.beforeUpdate()
                if (state.failUpdate) throw new Error('D1 down')
                const [title, content, version, updatedAt, id, cond] = args as [string, string, number, number, string, number]
                if (!state.row || state.row.id !== id || state.row.version !== cond) return { meta: { changes: 0 } }
                state.row = { ...state.row, title, content, version, updated_at: updatedAt }
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith(ROW_UPDATE_SQL)) {
                if (state.beforeUpdate) await state.beforeUpdate()
                const [title, content, version, updatedAt, id, ownerId, cond] = args as [string, string, number, number, string, string, number]
                if (!state.row || state.row.id !== id || state.row.owner_id !== ownerId || state.row.version !== cond) {
                  return { meta: { changes: 0 } }
                }
                state.row = { ...state.row, title, content, version, updated_at: updatedAt }
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE users SET') && sql.includes(' RETURNING ')) {
                return { results: state.usage ? [{ ...state.usage }] : [], meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE users SET')) return { meta: { changes: 1 } }
              throw new Error(`unhandled run sql: ${sql}`)
            },
          }
        },
      }
    },
    async batch(statements: { sql: string; args: unknown[]; run(): Promise<unknown> }[]) {
      state.batches.push(statements.map((s) => ({ sql: s.sql, args: s.args })))
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }
  const updates = () => state.calls.filter((c) => c.sql.startsWith('UPDATE docs'))
  const reads = () => state.calls.filter((c) => c.sql.startsWith('SELECT title, content'))
  return { state, DB, updates, reads }
}

type UpdateRow = { seq: number; part: number; data: ArrayBuffer }

function makeStorage() {
  let updates: UpdateRow[] = []
  let meta = new Map<string, string>()
  const log: string[] = []
  const flags = { failInsert: false }
  const storage: DoStorageLike = {
    sql: {
      exec(query: string, ...args: unknown[]) {
        const sql = query.trim().replace(/\s+/g, ' ')
        log.push(sql)
        let rows: Record<string, unknown>[] = []
        if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) rows = []
        else if (sql.startsWith('SELECT seq, part, data FROM ydoc_updates'))
          rows = [...updates].sort((a, b) => a.seq - b.seq || a.part - b.part).map((r) => ({ ...r }))
        else if (sql.startsWith('SELECT key, value FROM ydoc_meta')) rows = [...meta].map(([key, value]) => ({ key, value }))
        else if (sql.startsWith('INSERT INTO ydoc_updates')) {
          if (flags.failInsert) throw new Error('SQLITE_FULL')
          const [seq, part, data] = args as [number, number, ArrayBuffer]
          updates.push({ seq, part, data })
        } else if (sql.startsWith('INSERT INTO ydoc_meta')) meta.set(args[0] as string, args[1] as string)
        else if (sql.startsWith('DELETE FROM ydoc_updates')) updates = []
        else if (sql.startsWith('DELETE FROM ydoc_meta')) meta = new Map()
        else throw new Error(`unhandled sql: ${sql}`)
        return { toArray: () => rows }
      },
    },
    transactionSync<T>(fn: () => T): T {
      const u = [...updates]
      const m = new Map(meta)
      try {
        return fn()
      } catch (err) {
        updates = u
        meta = m
        throw err
      }
    },
  }
  return {
    storage,
    log,
    flags,
    seqCount: () => new Set(updates.map((r) => r.seq)).size,
    rowBytes: () => [...updates].sort((a, b) => a.seq - b.seq || a.part - b.part).map((r) => new Uint8Array(r.data)),
    meta: () => meta,
  }
}

type FakeConn = RoomConnection & {
  open: boolean
  closed: { code: number; reason: string } | null
  sent: string[]
}

function conn(userId: string, email: string, role: 'owner' | 'edit' = 'edit'): FakeConn {
  const c: FakeConn = {
    state: { userId, email, role },
    open: true,
    closed: null,
    sent: [],
    close(code: number, reason: string) {
      c.open = false
      c.closed = { code, reason }
    },
  }
  return c
}

function makeRoom(d1: ReturnType<typeof makeD1>, store = makeStorage(), opts: { ensureLoaded?: () => Promise<void> } = {}) {
  const doc = new Y.Doc()
  const conns: FakeConn[] = []
  const counts = { ensureLoaded: 0, exclusive: 0, load: 0 }
  const alarms: number[] = []
  const host: DocRoomHost<FakeConn> = {
    docId: DOC_ID,
    env: { DB: d1.DB } as unknown as Env,
    storage: store.storage,
    doc,
    connections: () => conns.filter((c) => c.open),
    sendCustom: (c, message) => c.sent.push(message),
    broadcastCustom: (message) => conns.filter((c) => c.open).forEach((c) => c.sent.push(message)),
    // 5.3 — 아직 안 불렀으면 core.load(), exclusive 는 fn 을 그대로 부르고 횟수를 센다
    ensureLoaded: async () => {
      counts.ensureLoaded++
      if (opts.ensureLoaded) return opts.ensureLoaded()
      if (counts.load === 0) await core.load()
    },
    exclusive: async <T,>(fn: () => Promise<T>) => {
      counts.exclusive++
      return fn()
    },
    setAlarm: async (at: number) => {
      alarms.push(at)
    },
  }
  const core = new DocRoomCore(host)
  const load = core.load.bind(core)
  core.load = () => {
    counts.load++
    return load()
  }
  const add = async (c: FakeConn, version: number, onSync?: () => void) => {
    conns.push(c)
    return core.connect(c, version, () => onSync?.())
  }
  return { core, doc, conns, add, store, counts, alarms }
}

const text = (doc: Y.Doc, name = 'content') => doc.getText(name).toString()

function edit(doc: Y.Doc, fn: (content: Y.Text, title: Y.Text) => void) {
  doc.transact(() => fn(doc.getText('content'), doc.getText('title')), CLIENT)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  vi.mocked(resolveDocAccess).mockReset()
  vi.mocked(resolveDocAccess).mockImplementation(async (_env, doc) => ({ role: 'edit', doc }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('F-304 A5·A6·A7·A8 불러오기', () => {
  it('A5 씨앗 — CRLF 를 LF 로, 제목, 저장소 1행, d1_version, UPDATE 없음, 두 벌이 아님', async () => {
    const d1 = makeD1({ content: 'a\r\nb\r\n', title: 't', line_ending: 'crlf', version: 3 })
    const { core, doc, store } = makeRoom(d1)
    await core.load()
    expect(text(doc)).toBe('a\nb\n')
    expect(text(doc, 'title')).toBe('t')
    expect(store.seqCount()).toBe(1)
    expect(store.meta().get('d1_version')).toBe('3')
    expect(d1.updates()).toHaveLength(0)

    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(doc))
    expect(client.getText('content').toString()).toBe('a\nb\n')
    expect(client.getText('content').length).toBe(4)
  })

  it('A6 같은 version 으로 다시 불러오면 씨앗을 다시 심지 않는다', async () => {
    const d1 = makeD1({ content: 'a\r\nb\r\n', title: 't', line_ending: 'crlf', version: 3 })
    const first = makeRoom(d1)
    await first.core.load()
    const again = makeRoom(d1, first.store)
    await again.core.load()
    expect(first.store.seqCount()).toBe(1)
    expect(text(again.doc)).toBe('a\nb\n')
    expect(text(again.doc, 'title')).toBe('t')
    expect(d1.updates()).toHaveLength(0)
  })

  it('A7 외부 쓰기 뒤 불러오기 — 흡수 행 1개, d1_version, UPDATE 없음, 클라이언트에 이어진다', async () => {
    const d1 = makeD1({ content: 'a\r\nb\r\n', title: 't', line_ending: 'crlf', version: 3 })
    const first = makeRoom(d1)
    await first.core.load()
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(first.doc))

    d1.state.row = { ...d1.state.row!, content: 'a\r\nB\r\n', version: 4 }
    const again = makeRoom(d1, first.store)
    await again.core.load()
    expect(text(again.doc)).toBe('a\nB\n')
    expect(first.store.seqCount()).toBe(2)
    expect(first.store.meta().get('d1_version')).toBe('4')
    expect(d1.updates()).toHaveLength(0)

    const rows = first.store.rowBytes()
    Y.applyUpdate(client, rows[rows.length - 1])
    expect(client.getText('content').toString()).toBe('a\nB\n')
  })

  it('불러오기가 씨앗을 넣은 뒤 실패하면 같은 document 로 다시 불러와도 두 벌이 되지 않는다', async () => {
    const d1 = makeD1({ content: 'a\nb\n', title: 't', version: 2 })
    const store = makeStorage()
    const { core, doc } = makeRoom(d1, store)
    store.flags.failInsert = true
    await expect(core.load()).rejects.toThrow('SQLITE_FULL')
    store.flags.failInsert = false
    await core.load()
    expect(text(doc)).toBe('a\nb\n')
    expect(text(doc, 'title')).toBe('t')
    const again = makeRoom(d1, store)
    await again.core.load()
    expect(text(again.doc)).toBe('a\nb\n')
  })

  it('A8 D1 줄이 없으면 저장소가 비고 씨앗이 없으며 새 연결은 4404 deleted', async () => {
    const d1 = makeD1(null)
    const { core, doc, store, add } = makeRoom(d1)
    await core.load()
    expect(store.seqCount()).toBe(0)
    expect(text(doc)).toBe('')
    const c = conn('u1', 'u1@example.com')
    const synced = vi.fn()
    expect(await add(c, 1, synced)).toBe(false)
    expect(c.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(synced).not.toHaveBeenCalled()
  })
})

describe('F-304 A9·A10 flush', () => {
  it('A9 여러 업데이트 → flush 한 번 = 1행 + 조건부 UPDATE, CRLF 로 되돌림, 가짜 시계, 제목', async () => {
    const d1 = makeD1({ content: 'a\r\n', title: 't', line_ending: 'crlf', version: 3 })
    const { core, doc, store } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(2, 'b\n'))
    edit(doc, (c) => c.insert(4, 'c\n'))
    edit(doc, (_c, t) => t.insert(1, '2'))
    vi.setSystemTime(2_000_000)
    await core.flush()

    expect(store.seqCount()).toBe(2)
    const updates = d1.updates()
    expect(updates).toHaveLength(1)
    expect(updates[0].args).toEqual(['t2', 'a\r\nb\r\nc\r\n', 4, 2_000_000, DOC_ID, 3])
    expect(store.meta().get('d1_version')).toBe('4')
  })

  it('A9 바뀐 것이 없는 flush 는 행도 UPDATE 도 없다', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, store } = makeRoom(d1)
    await core.load()
    await core.flush()
    expect(store.seqCount()).toBe(1)
    expect(d1.updates()).toHaveLength(0)
  })

  it('A10 마지막 연결이 닫힐 때의 flush 는 타이머 없이 끝나고 남는 타이머가 없다', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(1, 'b'))
    await core.roomEmptied()
    expect(d1.updates()).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('A10 불러온 뒤 한 번 flush 타이머도 방이 비면 치워진다', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const first = makeRoom(d1)
    await first.core.load()
    d1.state.failUpdate = true
    edit(first.doc, (c) => c.insert(1, 'b'))
    await first.core.flush()
    vi.clearAllTimers()
    d1.state.failUpdate = false

    const again = makeRoom(d1, first.store)
    await again.core.load()
    expect(vi.getTimerCount()).toBe(1)
    await again.core.roomEmptied()
    expect(d1.state.row!.content).toBe('ab')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('F-304 A11 크기 초과', () => {
  it('CRLF 로 1,000,001 B → UPDATE 없음, too-large 1번, 새 연결도 받음, 줄이면 size-ok', async () => {
    const d1 = makeD1({ content: 'a\r\n', title: 't', line_ending: 'crlf', version: 1 })
    const { core, doc, add } = makeRoom(d1)
    await core.load()
    const c1 = conn('u1', 'u1@example.com')
    await add(c1, 1)
    edit(doc, (c) => {
      c.delete(0, c.length)
      c.insert(0, 'x'.repeat(999_999) + '\n')
    })
    await core.flush()
    const tooLarge = encodeDocRoomMessage({ type: 'too-large', limit: 1_000_000, bytes: 1_000_001 })
    expect(d1.updates()).toHaveLength(0)
    expect(c1.sent).toEqual([tooLarge])

    edit(doc, (c) => c.insert(0, 'y'))
    await core.flush()
    expect(c1.sent).toEqual([tooLarge])
    expect(d1.updates()).toHaveLength(0)

    const c2 = conn('u2', 'u2@example.com')
    await add(c2, 1)
    expect(c2.sent).toEqual([tooLarge])

    edit(doc, (c) => c.delete(0, 10))
    await core.flush()
    expect(d1.updates()).toHaveLength(1)
    const sizeOk = encodeDocRoomMessage({ type: 'size-ok' })
    expect(c1.sent).toEqual([tooLarge, sizeOk])
    expect(c2.sent).toEqual([tooLarge, sizeOk])
  })

  it('lf 이고 LF 본문이 정확히 1,000,000 B 면 쓴다', async () => {
    const d1 = makeD1({ content: 'a', line_ending: 'lf', version: 1 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => {
      c.delete(0, c.length)
      c.insert(0, 'x'.repeat(999_999) + '\n')
    })
    await core.flush()
    expect(d1.updates()).toHaveLength(1)
    expect(d1.state.row!.content.length).toBe(1_000_000)
  })
})

describe('F-304 A12·A13 조건부 쓰기 0행', () => {
  it('A12 안 겹침 — 외부 편집을 얹고 새 version 으로 한 번 더 쓴다', async () => {
    const d1 = makeD1({ content: 'L1\nL2\nL3\n', line_ending: 'lf', version: 5 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(2, 'x'))
    d1.state.row = { ...d1.state.row!, content: 'L1\nL2\nL3y\n', version: 6 }
    await core.flush()
    expect(text(doc)).toBe('L1x\nL2\nL3y\n')
    const updates = d1.updates()
    const last = updates[updates.length - 1]
    expect(last.args[2]).toBe(7)
    expect(last.args[5]).toBe(6)
    expect(d1.state.row!.content).toBe('L1x\nL2\nL3y\n')
    expect(d1.state.row!.version).toBe(7)
  })

  it('A12 흡수한 바꾸기도 같은 flush 에서 저장소에 남는다', async () => {
    const d1 = makeD1({ content: 'L1\nL2\nL3\n', line_ending: 'lf', version: 5 })
    const first = makeRoom(d1)
    await first.core.load()
    edit(first.doc, (c) => c.insert(2, 'x'))
    d1.state.row = { ...d1.state.row!, content: 'L1\nL2\nL3y\n', version: 6 }
    await first.core.flush()

    const again = makeRoom(d1, first.store)
    await again.core.load()
    expect(text(again.doc)).toBe('L1x\nL2\nL3y\n')
  })

  it('A13 겹침 — DO 본문 그대로, UPDATE 는 D1 version + 1, console.warn 1번', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d1 = makeD1({ content: 'L1\nL2\nL3\n', line_ending: 'lf', version: 5 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => {
      c.delete(3, 1)
      c.insert(3, 'M')
    })
    d1.state.row = { ...d1.state.row!, content: 'L1\nN2\nL3\n', version: 6 }
    await core.flush()
    expect(text(doc)).toBe('L1\nM2\nL3\n')
    const updates = d1.updates()
    const last = updates[updates.length - 1]
    expect(last.args[2]).toBe(7)
    expect(last.args[5]).toBe(6)
    expect(d1.state.row!.content).toBe('L1\nM2\nL3\n')
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('F-304 A14·A15 flush 실패', () => {
  it('A14 flush 중 D1 줄이 없으면 전원 4404 deleted, 저장소 비움, 그 뒤 flush 는 아무것도 안 한다', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc, store, add } = makeRoom(d1)
    await core.load()
    const c1 = conn('u1', 'u1@example.com')
    const c2 = conn('u2', 'u2@example.com')
    await add(c1, 1)
    await add(c2, 1)
    edit(doc, (c) => c.insert(1, 'b'))
    d1.state.row = null
    await core.flush()
    expect(c1.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(c2.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(store.seqCount()).toBe(0)
    expect(store.meta().size).toBe(0)

    const calls = d1.state.calls.length
    const logs = store.log.length
    edit(doc, (c) => c.insert(0, 'z'))
    await core.flush()
    expect(d1.state.calls.length).toBe(calls)
    expect(store.log.length).toBe(logs)
  })

  it('A15 UPDATE 가 던지면 5초 뒤 다시, 첫 시도 포함 4번에서 멈추고, 다음 편집의 flush 는 다시 쓴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    d1.state.failUpdate = true
    edit(doc, (c) => c.insert(1, 'b'))
    await core.flush()
    expect(d1.updates()).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS - 1)
    expect(d1.updates()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(d1.updates()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS * 10)
    expect(d1.updates()).toHaveLength(4)
    expect(vi.getTimerCount()).toBe(0)
    expect(error).toHaveBeenCalled()

    d1.state.failUpdate = false
    edit(doc, (c) => c.insert(2, 'c'))
    await core.flush()
    expect(d1.updates()).toHaveLength(5)
    expect(d1.state.row!.content).toBe('abc')
    expect(d1.state.row!.version).toBe(2)
  })
})

describe('F-304 A16 압축', () => {
  it('flush 100번 뒤 저장소가 1행으로 압축되고 다시 불러온 본문이 같다', async () => {
    const d1 = makeD1({ content: 'start', version: 1 })
    const { core, doc, store } = makeRoom(d1)
    await core.load()
    for (let i = 0; i < 100; i++) {
      edit(doc, (c) => c.insert(c.length, String(i % 10)))
      await core.flush()
    }
    expect(store.seqCount()).toBe(1)
    const again = makeRoom(d1, store)
    await again.core.load()
    expect(text(again.doc)).toBe(text(doc))
  })
})

describe('F-304 A17 새 연결의 version', () => {
  it('같으면 D1 을 읽지 않는다', async () => {
    const d1 = makeD1({ content: 'a', version: 2 })
    const { core, add } = makeRoom(d1)
    await core.load()
    const reads = d1.reads().length
    const synced = vi.fn()
    expect(await add(conn('u1', 'u1@example.com'), 2, synced)).toBe(true)
    expect(d1.reads().length).toBe(reads)
    expect(synced).toHaveBeenCalledTimes(1)
  })

  it('다르면 D1 을 한 번 읽어 흡수한 뒤 sync step 1 을 보낸다', async () => {
    const d1 = makeD1({ content: 'L1\nL2\n', version: 2 })
    const { core, doc, add } = makeRoom(d1)
    await core.load()
    d1.state.row = { ...d1.state.row!, content: 'L1\nL2 외부\n', version: 3 }
    const reads = d1.reads().length
    const order: string[] = []
    const origRead = d1.DB.prepare.bind(d1.DB)
    d1.DB.prepare = (sql: string) => {
      if (sql.startsWith('SELECT title, content')) order.push('d1-read')
      return origRead(sql)
    }
    await add(conn('u1', 'u1@example.com'), 3, () => order.push(`sync:${text(doc)}`))
    expect(d1.reads().length).toBe(reads + 1)
    expect(order).toEqual(['d1-read', 'sync:L1\nL2 외부\n'])
  })
})

describe('F-304 A18 revalidateConnections', () => {
  function setupAccess() {
    vi.mocked(resolveDocAccess).mockImplementation(async (_env, doc, user) => {
      if (user.email === 'owner@example.com') return { role: 'owner', doc }
      if (user.email === 'editor@example.com') return { role: 'edit', doc }
      if (user.email === 'viewer@example.com') return { role: 'view', doc }
      return null
    })
  }

  it('보기·권한 없음 연결만 4403 revoked, 불러오기를 부르지 않는다', async () => {
    setupAccess()
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, conns, store } = makeRoom(d1)
    const owner = conn('owner', 'owner@example.com', 'owner')
    const editor = conn('e', 'editor@example.com')
    const viewer = conn('v', 'viewer@example.com')
    const none = conn('n', 'none@example.com')
    conns.push(owner, editor, viewer, none)
    await core.revalidateConnections()
    expect(owner.closed).toBeNull()
    expect(editor.closed).toBeNull()
    expect(viewer.closed).toEqual({ code: 4403, reason: 'revoked' })
    expect(none.closed).toEqual({ code: 4403, reason: 'revoked' })
    expect(d1.reads()).toHaveLength(0)
    expect(store.log.some((l) => l.startsWith('SELECT seq'))).toBe(false)
  })

  it('이메일을 주면 그 이메일 연결만 판정한다', async () => {
    setupAccess()
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, conns } = makeRoom(d1)
    const viewer = conn('v', 'viewer@example.com')
    const none = conn('n', 'none@example.com')
    conns.push(viewer, none)
    await core.revalidateConnections('viewer@example.com')
    expect(viewer.closed).toEqual({ code: 4403, reason: 'revoked' })
    expect(none.closed).toBeNull()
    expect(resolveDocAccess).toHaveBeenCalledTimes(1)
  })

  it('D1 줄이 없으면 전원 4404 deleted + 저장소 비움', async () => {
    setupAccess()
    const d1 = makeD1({ content: 'a', version: 1 })
    const first = makeRoom(d1)
    await first.core.load()
    d1.state.row = null
    const { core, conns } = makeRoom(d1, first.store)
    const a = conn('owner', 'owner@example.com', 'owner')
    const b = conn('e', 'editor@example.com')
    conns.push(a, b)
    await core.revalidateConnections()
    expect(a.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(b.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(first.store.seqCount()).toBe(0)
    expect(first.store.meta().size).toBe(0)
  })
})

describe('F-304 A19 주기 점검', () => {
  it('불러온 뒤 첫 flush 는 점검, 60초 안은 건너뛰고, 지나면 연결마다 한 번', async () => {
    vi.mocked(resolveDocAccess).mockImplementation(async (_env, doc) => ({ role: 'edit', doc }))
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc, add } = makeRoom(d1)
    await core.load()
    await add(conn('a', 'a@example.com'), 1)
    await add(conn('b', 'b@example.com'), 1)

    edit(doc, (c) => c.insert(1, '1'))
    await core.flush()
    expect(resolveDocAccess).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + REVALIDATE_INTERVAL_MS - 1)
    edit(doc, (c) => c.insert(1, '2'))
    await core.flush()
    expect(resolveDocAccess).toHaveBeenCalledTimes(2)

    vi.setSystemTime(Date.now() + 1)
    edit(doc, (c) => c.insert(1, '3'))
    await core.flush()
    expect(resolveDocAccess).toHaveBeenCalledTimes(4)
  })
})

describe('F-304 A20 비우기 뒤', () => {
  it('purge 뒤 flush·새 연결은 행·D1 호출이 없고 새 연결은 4404 deleted', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc, store, add } = makeRoom(d1)
    await core.load()
    const c1 = conn('u1', 'u1@example.com')
    await add(c1, 1)
    core.purge()
    expect(c1.closed).toEqual({ code: 4404, reason: 'deleted' })

    const calls = d1.state.calls.length
    const logs = store.log.length
    edit(doc, (c) => c.insert(0, 'z'))
    await core.flush()
    const c2 = conn('u2', 'u2@example.com')
    const synced = vi.fn()
    expect(await add(c2, 1, synced)).toBe(false)
    expect(c2.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(synced).not.toHaveBeenCalled()
    expect(d1.state.calls.length).toBe(calls)
    expect(store.log.length).toBe(logs)
  })
})

// F-308 /v1 PUT 을 DO 경유로 — writeText (specs/features/F-308.md 5·6장, A10~A22)
const L = 'L1\nL2\nL3\n'

function liveD1(overrides: Partial<D1Doc> = {}) {
  return makeD1({ content: L, title: 't', line_ending: 'lf', version: 5, ...overrides })
}

function watchUpdates(doc: Y.Doc) {
  const seen: Uint8Array[] = []
  doc.on('update', (u: Uint8Array) => seen.push(u))
  return seen
}

async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve()
}

describe('F-308 A10·A11 idle 경로', () => {
  it('A10 불러오지 않은 방·연결 0 → exclusive 안에서 D1 만, Yjs·SQLite·타이머 없음', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    const updates = watchUpdates(room.doc)
    const result = await room.core.writeText({ content: 'L1\nX\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(result).toEqual({ type: 'ok', doc: { title: 't', content: 'L1\nX\nL3\n', version: 6, updatedAt: 1_000_000 } })
    expect(room.counts.exclusive).toBe(1)
    expect(room.counts.ensureLoaded).toBe(0)
    expect(room.store.log.filter((l) => l.startsWith('INSERT INTO ydoc_'))).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(d1.state.calls.map((c) => c.sql)).toEqual(['SELECT * FROM docs WHERE id = ? AND e2ee_key IS NULL', ROW_UPDATE_SQL, DAY_AND_TOTAL_SQL])
    expect(d1.state.calls[1].args).toEqual(['t', 'L1\nX\nL3\n', 6, 1_000_000, DOC_ID, 'owner', 5])
    expect(d1.state.row!.content).toBe('L1\nX\nL3\n')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('A11 낡은 baseVersion → conflict(행), UPDATE 0', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    const result = await room.core.writeText({ content: 'L1\nX\nL3\n', baseVersion: 4, docVersion: 5 })
    expect(result).toEqual({ type: 'conflict', doc: { title: 't', content: L, version: 5, updatedAt: 0 } })
    expect(d1.updates()).toHaveLength(0)
  })

  it('A11 행이 없으면 not_found', async () => {
    const d1 = makeD1(null)
    const room = makeRoom(d1)
    await expect(room.core.writeText({ content: 'x', baseVersion: 1, docVersion: 1 })).resolves.toEqual({ type: 'not_found' })
    expect(d1.updates()).toHaveLength(0)
  })

  it('A11 요청 값이 행과 같으면 낡은 baseVersion 이어도 ok, version 그대로, UPDATE 0', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    const result = await room.core.writeText({ content: L, title: 't', baseVersion: 4, docVersion: 5 })
    expect(result).toEqual({ type: 'ok', doc: { title: 't', content: L, version: 5, updatedAt: 0 } })
    expect(d1.updates()).toHaveLength(0)
  })

  it('A11 UPDATE 가 0행이면 다시 읽은 행으로 conflict', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    d1.state.beforeUpdate = () => {
      d1.state.row = { ...d1.state.row!, content: 'other\n', version: 6, updated_at: 7 }
    }
    const result = await room.core.writeText({ content: 'L1\nX\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(result).toEqual({ type: 'conflict', doc: { title: 't', content: 'other\n', version: 6, updatedAt: 7 } })
  })
})

describe('F-308 A12 경로 고르기', () => {
  it('연결이 있고 불러오지 않은 방 → ensureLoaded 1번 뒤 실시간 경로', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    room.conns.push(conn('u1', 'u1@example.com'))
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(result).toMatchObject({ type: 'ok', doc: { version: 6 } })
    expect(room.counts.ensureLoaded).toBe(1)
    expect(room.counts.load).toBe(1)
    expect(room.counts.exclusive).toBe(0)
    expect(text(room.doc)).toBe('L1\nL2x\nL3\n')
    expect(d1.updates().map((c) => c.sql)).toEqual([ROOM_UPDATE_SQL])
  })

  it('불러온 방·연결 0 → 실시간 경로, 불러오기를 다시 하지 않는다', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(result).toMatchObject({ type: 'ok', doc: { version: 6 } })
    expect(room.counts.ensureLoaded).toBe(1)
    expect(room.counts.load).toBe(1)
    expect(room.counts.exclusive).toBe(0)
    expect(d1.updates().map((c) => c.sql)).toEqual([ROOM_UPDATE_SQL])
  })

  it('ensureLoaded 가 아무것도 안 하면 unavailable, doc 업데이트 0', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1, makeStorage(), { ensureLoaded: async () => {} })
    room.conns.push(conn('u1', 'u1@example.com'))
    const updates = watchUpdates(room.doc)
    await expect(room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })).resolves.toEqual({ type: 'unavailable' })
    expect(updates).toHaveLength(0)
    expect(d1.updates()).toHaveLength(0)
  })
})

describe('F-308 A13·A14 실시간 경로 — 차이만 적용', () => {
  it('A13 못 나간 편집 없음 → ok v6, DO 스냅숏 문장 1번, 클라이언트에 같은 본문', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const client = new Y.Doc()
    Y.applyUpdate(client, Y.encodeStateAsUpdate(room.doc))
    const updates = watchUpdates(room.doc)
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(result).toEqual({ type: 'ok', doc: { title: 't', content: 'L1\nL2x\nL3\n', version: 6, updatedAt: 1_000_000 } })
    expect(text(room.doc)).toBe('L1\nL2x\nL3\n')
    const writes = d1.updates()
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toBe(ROOM_UPDATE_SQL)
    expect(writes[0].args).toEqual(['t', 'L1\nL2x\nL3\n', 6, 1_000_000, DOC_ID, 5])
    for (const u of updates) Y.applyUpdate(client, u)
    expect(client.getText('content').toString()).toBe('L1\nL2x\nL3\n')
  })

  it('A14 편집 밖의 상대 위치가 제자리, 업데이트 500 B 미만', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const content = room.doc.getText('content')
    const atL1End = Y.createRelativePositionFromTypeIndex(content, 2)
    const atL3 = Y.createRelativePositionFromTypeIndex(content, 6)
    const updates = watchUpdates(room.doc)
    await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(Y.createAbsolutePositionFromRelativePosition(atL1End, room.doc)!.index).toBe(2)
    expect(Y.createAbsolutePositionFromRelativePosition(atL3, room.doc)!.index).toBe(7)
    expect(updates).toHaveLength(1)
    expect(updates[0].length).toBeLessThan(500)
  })
})

describe('F-308 A15·A16 못 나간 편집과 끼어든 편집', () => {
  it('A15 못 나간 편집이 있으면 먼저 D1 에 쓰고 conflict, 그 version 으로 다시 → ok', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    edit(room.doc, (c) => c.insert(2, 'a'))
    const first = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(first).toEqual({ type: 'conflict', doc: { title: 't', content: 'L1a\nL2\nL3\n', version: 6, updatedAt: 1_000_000 } })
    expect(text(room.doc)).toBe('L1a\nL2\nL3\n')

    const again = await room.core.writeText({ content: 'L1a\nL2x\nL3\n', baseVersion: 6, docVersion: 6 })
    expect(again).toMatchObject({ type: 'ok', doc: { content: 'L1a\nL2x\nL3\n', version: 7 } })
    expect(d1.state.row!.content).toBe('L1a\nL2x\nL3\n')
  })

  it('A16 flush(선) 동안 끼어든 편집이 안 겹치면 둘 다 산다', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    edit(room.doc, (_c, t) => t.insert(1, '2'))
    d1.state.beforeUpdate = () => {
      d1.state.beforeUpdate = null
      edit(room.doc, (c) => c.insert(8, 'y'))
    }
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 6, docVersion: 5 })
    expect(result).toMatchObject({ type: 'ok', doc: { content: 'L1\nL2x\nL3y\n', version: 7 } })
    expect(text(room.doc)).toBe('L1\nL2x\nL3y\n')
    expect(d1.state.row!.content).toBe('L1\nL2x\nL3y\n')
  })

  it('A16 겹치면 conflict, 요청 편집이 안 들어간다', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    edit(room.doc, (_c, t) => t.insert(1, '2'))
    d1.state.beforeUpdate = () => {
      d1.state.beforeUpdate = null
      edit(room.doc, (c) => {
        c.delete(3, 1)
        c.insert(3, 'N')
      })
    }
    const result = await room.core.writeText({ content: 'L1\nM2\nL3\n', baseVersion: 6, docVersion: 5 })
    expect(result).toEqual({ type: 'conflict', doc: { title: 't2', content: L, version: 6, updatedAt: 1_000_000 } })
    expect(text(room.doc)).toBe('L1\nN2\nL3\n')
  })
})

describe('F-308 A17·A18·A19 같은 값·줄바꿈·크기·제목', () => {
  it('A17 지금 본문과 같으면 낡은 baseVersion 이어도 ok, version 그대로, 쓰기·업데이트 0', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const updates = watchUpdates(room.doc)
    const result = await room.core.writeText({ content: L, baseVersion: 3, docVersion: 5 })
    expect(result).toEqual({ type: 'ok', doc: { title: 't', content: L, version: 5, updatedAt: null } })
    expect(d1.updates()).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('A18 crlf 방 — doc 은 LF, D1·결과는 CRLF', async () => {
    const d1 = makeD1({ content: 'a\r\nb\r\n', title: 't', line_ending: 'crlf', version: 1 })
    const room = makeRoom(d1)
    await room.core.load()
    const result = await room.core.writeText({ content: 'a\r\nB\r\n', baseVersion: 1, docVersion: 1 })
    expect(result).toMatchObject({ type: 'ok', doc: { content: 'a\r\nB\r\n', version: 2 } })
    expect(text(room.doc)).toBe('a\nB\n')
    expect(d1.state.row!.content).toBe('a\r\nB\r\n')
  })

  it('A18 CRLF 로 바꾸면 1,000,001 B → too_large, 적용하지 않는다', async () => {
    const d1 = makeD1({ content: 'a\r\nb\r\n', title: 't', line_ending: 'crlf', version: 1 })
    const room = makeRoom(d1)
    await room.core.load()
    const updates = watchUpdates(room.doc)
    const result = await room.core.writeText({ content: 'x'.repeat(999_999) + '\r\n', baseVersion: 1, docVersion: 1 })
    expect(result).toEqual({ type: 'too_large', bytes: 1_000_001 })
    expect(text(room.doc)).toBe('a\nb\n')
    expect(updates).toHaveLength(0)
    expect(d1.updates()).toHaveLength(0)
  })

  it('A19 제목만 — 본문 그대로, D1 제목 값', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const result = await room.core.writeText({ title: '새 제목', baseVersion: 5, docVersion: 5 })
    expect(result).toMatchObject({ type: 'ok', doc: { title: '새 제목', content: L, version: 6 } })
    expect(text(room.doc, 'title')).toBe('새 제목')
    expect(text(room.doc)).toBe(L)
    expect(d1.updates()[0].args[0]).toBe('새 제목')
  })
})

describe('F-308 A20 D1 실패', () => {
  it('flush(후)가 던지면 unavailable, 편집은 doc·SQLite 에, 재시도 1개. 재시도 뒤 같은 요청은 ok', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const rows = room.store.seqCount()
    d1.state.failUpdate = true
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 5 })
    expect(result).toEqual({ type: 'unavailable' })
    expect(text(room.doc)).toBe('L1\nL2x\nL3\n')
    expect(room.store.seqCount()).toBe(rows + 1)
    expect(vi.getTimerCount()).toBe(1)

    d1.state.failUpdate = false
    await vi.advanceTimersByTimeAsync(SNAPSHOT_RETRY_MS)
    expect(d1.state.row!.version).toBe(6)
    const written = d1.updates().length
    const again = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 6 })
    expect(again).toMatchObject({ type: 'ok', doc: { content: 'L1\nL2x\nL3\n', version: 6 } })
    expect(d1.updates()).toHaveLength(written)
  })
})

describe('F-308 A21 한 번에 하나', () => {
  it('같은 baseVersion 두 개를 동시에 → ok(6)·conflict(6), 두 번째는 첫 번째가 끝난 뒤 시작', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    d1.state.beforeUpdate = () => gate
    const p1 = room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 5, docVersion: 4 })
    const p2 = room.core.writeText({ content: 'L1\nL2y\nL3\n', baseVersion: 5, docVersion: 4 })
    await settle()
    expect(d1.reads()).toHaveLength(2)
    expect(d1.updates()).toHaveLength(1)
    d1.state.beforeUpdate = null
    release()
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toMatchObject({ type: 'ok', doc: { content: 'L1\nL2x\nL3\n', version: 6 } })
    expect(r2).toMatchObject({ type: 'conflict', doc: { content: 'L1\nL2x\nL3\n', version: 6 } })
    expect(d1.reads()).toHaveLength(3)
    expect(text(room.doc)).toBe('L1\nL2x\nL3\n')
  })
})

describe('F-308 A22 따라잡기·사라진 방', () => {
  it('docVersion 이 방보다 새로우면 쓰기 전에 흡수한다', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    d1.state.row = { ...d1.state.row!, content: 'L1\nL2\nL3y\n', version: 7 }
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3y\n', baseVersion: 7, docVersion: 7 })
    expect(result).toMatchObject({ type: 'ok', doc: { content: 'L1\nL2x\nL3y\n', version: 8 } })
    expect(text(room.doc)).toBe('L1\nL2x\nL3y\n')
  })

  it('D1 줄이 없으면 not_found, 연결은 4404 deleted', async () => {
    const d1 = liveD1()
    const room = makeRoom(d1)
    await room.core.load()
    const c = conn('u1', 'u1@example.com')
    await room.add(c, 5)
    d1.state.row = null
    await expect(room.core.writeText({ content: 'x', baseVersion: 5, docVersion: 6 })).resolves.toEqual({ type: 'not_found' })
    expect(c.closed).toEqual({ code: 4404, reason: 'deleted' })
  })
})

// F-2027 실시간 방 사용량 합산과 느린 저장 (specs/features/F-2027.md 8.1 C1~C16)
const SNAPSHOT_USAGE_SQL = `${DAY_AND_TOTAL_SQL} RETURNING write_day, write_count, content_bytes, doc_count, blocked_at, warned_at`
const BLOCKED_SQL = 'SELECT blocked_at FROM users WHERE id = ?'
const SLOW_WARN = `docRoom: owner over daily write limit, slow snapshots (${DOC_ID})`
const BLOCK_WARN = `docRoom: owner blocked, snapshots paused (${DOC_ID})`

function warnCount(warn: { mock: { calls: unknown[][] } }, message: string) {
  return warn.mock.calls.filter((c) => c[0] === message).length
}

// 시각 1,000,000 의 스냅숏 한 번으로 느린 저장에 든 방 (본문 'ab', v2)
async function slowRoom(usage: Partial<UsageRow> = {}) {
  const d1 = makeD1({ content: 'a', version: 1 })
  d1.state.usage = { ...d1.state.usage!, write_count: 5000, ...usage }
  const room = makeRoom(d1)
  await room.core.load()
  edit(room.doc, (c) => c.insert(c.length, 'b'))
  await room.core.flush()
  return { d1, ...room }
}

describe('F-2027 C1~C5 스냅숏 사용량 줄', () => {
  it('C1 batch 1번, 스냅숏 문장 + 사용량 문장, 단독 run 없음', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(1, 'b'))
    await core.flush()
    expect(d1.state.batches).toEqual([
      [
        { sql: ROOM_UPDATE_SQL, args: ['', 'ab', 2, 1_000_000, DOC_ID, 1] },
        { sql: SNAPSHOT_USAGE_SQL, args: ['1970-01-01', 1, 0, 'owner'] },
      ],
    ])
    expect(d1.updates()).toHaveLength(1)
  })

  it('C2 증감 — 같은 줄바꿈', async () => {
    const d1 = makeD1({ content: 'a\r\n', line_ending: 'crlf', version: 3 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(2, 'b\n'))
    await core.flush()
    expect(d1.state.batches[0][1].args[1]).toBe(3)
  })

  it('C3 증감 — 섞인 줄바꿈 D1 행의 실제 바이트 기준', async () => {
    const d1 = makeD1({ content: 'a\r\nb\nc', line_ending: 'crlf', version: 1 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(c.length, 'd'))
    await core.flush()
    expect(d1.state.row!.content).toBe('a\r\nb\r\ncd')
    expect(d1.state.batches[0][1].args[1]).toBe(2)
  })

  it('C4 증감 — 흡수 뒤 두 번째 시도는 흡수한 행 바이트 기준', async () => {
    const d1 = makeD1({ content: 'L1\nL2\nL3\n', line_ending: 'lf', version: 5 })
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(2, 'x'))
    d1.state.row = { ...d1.state.row!, content: 'L1\nL2\nL3yyy\n', version: 6 }
    await core.flush()
    expect(d1.state.batches).toHaveLength(2)
    expect(d1.state.batches[0][1].args[1]).toBe(1)
    expect(d1.state.row!.content).toBe('L1x\nL2\nL3yyy\n')
    expect(d1.state.batches[1][1].args[1]).toBe(1)
  })

  it('C5 소유자는 D1 owner_id — 편집자 연결만 있어도', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const { core, doc, add } = makeRoom(d1)
    await core.load()
    await add(conn('u1', 'u1@example.com'), 1)
    edit(doc, (c) => c.insert(1, 'b'))
    await core.flush()
    expect(d1.state.batches[0][1].args[3]).toBe('owner')
  })
})

describe('F-2027 C6~C10 느린 저장', () => {
  it('C6 진입 — 60초 안의 flush 는 D1 없이 SQLite 에만, 알람은 한 번', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc, store, alarms } = await slowRoom()
    expect(d1.state.batches).toHaveLength(1)

    vi.setSystemTime(1_030_000)
    const rows = store.seqCount()
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(1)
    expect(store.seqCount()).toBe(rows + 1)
    expect(alarms).toEqual([1_060_000])

    vi.setSystemTime(1_050_000)
    edit(doc, (c) => c.insert(c.length, 'd'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(1)
    expect(alarms).toEqual([1_060_000])
    expect(warnCount(warn, SLOW_WARN)).toBe(1)
  })

  it('C7 알람 — 미룬 편집을 한 번에 쓴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc } = await slowRoom()
    vi.setSystemTime(1_030_000)
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.flush()
    vi.setSystemTime(1_050_000)
    edit(doc, (c) => c.insert(c.length, 'd'))
    await core.flush()

    vi.setSystemTime(1_060_000)
    await core.alarm()
    expect(d1.state.batches).toHaveLength(2)
    expect(d1.state.row!.content).toBe('abcd')
  })

  it('C8 방이 비어도 60초 안이면 쓰지 않고 알람, 타이머 없음', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc, store, alarms } = await slowRoom()
    vi.setSystemTime(1_030_000)
    const rows = store.seqCount()
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.roomEmptied()
    expect(d1.state.batches).toHaveLength(1)
    expect(store.seqCount()).toBe(rows + 1)
    expect(alarms).toEqual([1_060_000])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('C9 자정이 지나면 60초 전이어도 쓴다, 날짜는 새 날', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.setSystemTime(86_390_000)
    const { d1, core, doc } = await slowRoom()
    vi.setSystemTime(86_405_000)
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(2)
    expect(d1.state.batches[1][1].args[0]).toBe('1970-01-02')
  })

  it('C10 결과 행이 한도 밑이면 풀린다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc } = await slowRoom()
    vi.setSystemTime(1_030_000)
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.flush()
    d1.state.usage!.write_count = 10
    vi.setSystemTime(1_060_000)
    await core.alarm()
    expect(d1.state.batches).toHaveLength(2)

    vi.setSystemTime(1_070_000)
    edit(doc, (c) => c.insert(c.length, 'd'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(3)
  })
})

describe('F-2027 C11·C12 writeText 는 느린 저장을 건너뛴다', () => {
  async function slowLiveRoom() {
    const d1 = liveD1()
    d1.state.usage = { ...d1.state.usage!, write_count: 5000 }
    const room = makeRoom(d1)
    await room.core.load()
    edit(room.doc, (c) => c.insert(c.length, 'z'))
    await room.core.flush()
    return { d1, ...room }
  }

  it('C11 flush(후) 가 곧바로 쓴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core } = await slowLiveRoom()
    expect(d1.state.batches).toHaveLength(1)
    vi.setSystemTime(1_010_000)
    const result = await core.writeText({ content: 'L1\nL2x\nL3\nz', baseVersion: 6, docVersion: 6 })
    expect(result).toMatchObject({ type: 'ok', doc: { content: 'L1\nL2x\nL3\nz', version: 7 } })
    expect(d1.state.batches).toHaveLength(2)
  })

  it('C11 못 나간 편집이 있으면 flush(선)·flush(후) 가 각각 쓴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc } = await slowLiveRoom()
    vi.setSystemTime(1_010_000)
    edit(doc, (c) => c.insert(2, 'a'))
    const first = await core.writeText({ content: 'L1a\nL2x\nL3\nz', baseVersion: 6, docVersion: 6 })
    expect(first).toMatchObject({ type: 'conflict', doc: { content: 'L1a\nL2\nL3\nz', version: 7 } })
    expect(d1.state.batches).toHaveLength(2)
    const again = await core.writeText({ content: 'L1a\nL2x\nL3\nz', baseVersion: 7, docVersion: 7 })
    expect(again).toMatchObject({ type: 'ok', doc: { content: 'L1a\nL2x\nL3\nz', version: 8 } })
    expect(d1.state.batches).toHaveLength(3)
  })

  it('C12 도는 일반 flush 에 합쳐진 강제 flush — 뒤이은 한 번이 강제로 돈다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc } = await slowLiveRoom()
    vi.setSystemTime(1_070_000)
    edit(doc, (c) => c.insert(2, 'a'))
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    d1.state.beforeUpdate = () => {
      d1.state.beforeUpdate = null
      return gate
    }
    const normal = core.flush()
    await settle()
    expect(d1.state.batches).toHaveLength(2)
    edit(doc, (c) => c.insert(0, 'y'))
    const write = core.writeText({ content: 'yL1a\nL2x\nL3\nz', baseVersion: 8, docVersion: 6 })
    await settle()
    release()
    await normal
    expect(await write).toMatchObject({ type: 'ok', doc: { content: 'yL1a\nL2x\nL3\nz', version: 9 } })
    expect(d1.state.row!.content).toBe('yL1a\nL2x\nL3\nz')
  })
})

describe('F-2027 C13·C14 막힌 소유자', () => {
  it('C13 막힘을 안 뒤로는 쓰지 않고 풀리면 쓴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d1 = makeD1({ content: 'a', version: 1 })
    d1.state.usage = { ...d1.state.usage!, blocked_at: 123 }
    const { core, doc, store, alarms } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(1, 'b'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(1)
    expect(warnCount(warn, BLOCK_WARN)).toBe(1)

    const rows = store.seqCount()
    edit(doc, (c) => c.insert(2, 'c'))
    await core.flush()
    const blockedReads = d1.state.calls.filter((c) => c.sql === BLOCKED_SQL)
    expect(blockedReads).toEqual([{ sql: BLOCKED_SQL, args: ['owner'] }])
    expect(d1.state.batches).toHaveLength(1)
    expect(alarms).toHaveLength(0)
    expect(store.seqCount()).toBe(rows + 1)
    expect(vi.getTimerCount()).toBe(0)

    d1.state.usage!.blocked_at = null
    await core.flush()
    expect(d1.state.batches).toHaveLength(2)
    expect(d1.state.row!.content).toBe('abc')
    expect(warnCount(warn, BLOCK_WARN)).toBe(1)
  })

  it('C14 막힘 + writeText → unavailable, 본문은 요청 값, batch 0', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d1 = liveD1()
    d1.state.usage = { ...d1.state.usage!, blocked_at: 123 }
    const room = makeRoom(d1)
    await room.core.load()
    edit(room.doc, (_c, t) => t.insert(1, '2'))
    await room.core.flush()
    const before = d1.state.batches.length
    const result = await room.core.writeText({ content: 'L1\nL2x\nL3\n', baseVersion: 6, docVersion: 6 })
    expect(result).toEqual({ type: 'unavailable' })
    expect(text(room.doc)).toBe('L1\nL2x\nL3\n')
    expect(d1.state.batches).toHaveLength(before)
  })
})

describe('F-2027 C15·C16', () => {
  it('C15 사용량 행이 없으면 판정하지 않는다 — 던지지 않고 다음 flush 도 쓴다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d1 = makeD1({ content: 'a', version: 1 })
    d1.state.usage = null
    const { core, doc } = makeRoom(d1)
    await core.load()
    edit(doc, (c) => c.insert(1, 'b'))
    await core.flush()
    edit(doc, (c) => c.insert(2, 'c'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(2)
    expect(d1.state.row!.content).toBe('abc')
    expect(warn).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('C16 purge 뒤 alarm 은 D1·SQLite 호출이 없다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc, store } = await slowRoom()
    vi.setSystemTime(1_030_000)
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.flush()
    core.purge()
    const calls = d1.state.calls.length
    const logs = store.log.length
    vi.setSystemTime(1_060_000)
    await core.alarm()
    expect(d1.state.calls.length).toBe(calls)
    expect(store.log.length).toBe(logs)
  })

  it('C16 쫓겨난 뒤 새 인스턴스는 느린 저장을 잊고 첫 flush 에 쓴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { d1, core, doc, store } = await slowRoom()
    vi.setSystemTime(1_010_000)
    edit(doc, (c) => c.insert(c.length, 'c'))
    await core.flush()
    expect(d1.state.batches).toHaveLength(1)

    const again = makeRoom(d1, store)
    await again.core.load()
    await again.core.flush()
    expect(d1.state.batches).toHaveLength(2)
    expect(d1.state.row!.content).toBe('abc')
  })
})

describe('F-401 E11 DO 는 금고 문서를 없는 문서로 본다 (X16)', () => {
  const E2EE_ROW = { e2ee_key: 'A'.repeat(55) + '=', content: 'Ym9keQ==', title: 'dGl0bGU=' }

  it('① 금고 행으로 불러오면 저장소를 비우고 연결은 4404 deleted', async () => {
    const d1 = makeD1({ content: 'a', version: 1 })
    const first = makeRoom(d1)
    await first.core.load()
    expect(first.store.seqCount()).toBe(1)
    d1.state.row = { ...d1.state.row!, ...E2EE_ROW, version: 2 }
    const again = makeRoom(d1, first.store)
    await again.core.load()
    expect(first.store.seqCount()).toBe(0)
    expect(first.store.meta().size).toBe(0)
    const c = conn('owner', 'owner@example.com', 'owner')
    expect(await again.add(c, 2)).toBe(false)
    expect(c.closed).toEqual({ code: 4404, reason: 'deleted' })
  })

  it('② 옮기기 순간 살아 있던 방의 flush 는 금고 행에 쓰지 않는다', async () => {
    const d1 = makeD1({ content: L, version: 5 })
    const { core, doc, add } = makeRoom(d1)
    await core.load()
    const c = conn('owner', 'owner@example.com', 'owner')
    await add(c, 5)
    edit(doc, (t) => t.insert(0, '평문 '))
    d1.state.row = { ...d1.state.row!, ...E2EE_ROW, version: 6 }
    await core.flush()
    expect(d1.state.row!.content).toBe(E2EE_ROW.content)
    expect(d1.state.row!.version).toBe(6)
    expect(c.closed).toEqual({ code: 4404, reason: 'deleted' })
  })

  it('③ 금고 행에 idle writeText 는 not_found, UPDATE 없음', async () => {
    const d1 = makeD1({ ...E2EE_ROW, version: 3 })
    const room = makeRoom(d1)
    await expect(room.core.writeText({ content: '평문', baseVersion: 3, docVersion: 3 })).resolves.toEqual({ type: 'not_found' })
    expect(d1.updates()).toHaveLength(0)
  })

  it('④ revalidateConnections 는 금고 행에서 4404', async () => {
    const d1 = makeD1({ ...E2EE_ROW, version: 3 })
    const { core, conns } = makeRoom(d1)
    const c = conn('owner', 'owner@example.com', 'owner')
    conns.push(c)
    await core.revalidateConnections()
    expect(c.closed).toEqual({ code: 4404, reason: 'deleted' })
    expect(resolveDocAccess).not.toHaveBeenCalled()
  })
})
