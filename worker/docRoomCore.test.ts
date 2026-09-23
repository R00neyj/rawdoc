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

type D1Doc = {
  id: string
  owner_id: string
  folder_id: string | null
  title: string
  content: string
  line_ending: 'crlf' | 'lf'
  version: number
  updated_at: number
}

type SqlCall = { sql: string; args: unknown[] }

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
          updated_at: 0,
          ...initial,
        } as D1Doc)
      : null,
    calls: [] as SqlCall[],
    failUpdate: false,
  }
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              state.calls.push({ sql, args })
              if (sql.startsWith('SELECT title, content, line_ending, version FROM docs WHERE id = ?')) {
                if (!state.row || args[0] !== state.row.id) return null
                const { title, content, line_ending, version } = state.row
                return { title, content, line_ending, version } as T
              }
              if (sql.startsWith('SELECT id, owner_id, folder_id FROM docs WHERE id = ?')) {
                if (!state.row || args[0] !== state.row.id) return null
                const { id, owner_id, folder_id } = state.row
                return { id, owner_id, folder_id } as T
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async run() {
              state.calls.push({ sql, args })
              if (sql.startsWith('UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?')) {
                if (state.failUpdate) throw new Error('D1 down')
                const [title, content, version, updatedAt, id, cond] = args as [string, string, number, number, string, number]
                if (!state.row || state.row.id !== id || state.row.version !== cond) return { meta: { changes: 0 } }
                state.row = { ...state.row, title, content, version, updated_at: updatedAt }
                return { meta: { changes: 1 } }
              }
              throw new Error(`unhandled run sql: ${sql}`)
            },
          }
        },
      }
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

function makeRoom(d1: ReturnType<typeof makeD1>, store = makeStorage()) {
  const doc = new Y.Doc()
  const conns: FakeConn[] = []
  const host: DocRoomHost<FakeConn> = {
    docId: DOC_ID,
    env: { DB: d1.DB } as unknown as Env,
    storage: store.storage,
    doc,
    connections: () => conns.filter((c) => c.open),
    sendCustom: (c, message) => c.sent.push(message),
    broadcastCustom: (message) => conns.filter((c) => c.open).forEach((c) => c.sent.push(message)),
  }
  const core = new DocRoomCore(host)
  const add = async (c: FakeConn, version: number, onSync?: () => void) => {
    conns.push(c)
    return core.connect(c, version, () => onSync?.())
  }
  return { core, doc, conns, add, store }
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

describe('F-305 U25 activeEditor', () => {
  it('연결이 없으면 null, 있으면 첫 연결 상태의 email, 못 읽는 연결은 건너뛴다, D1 호출 0', () => {
    const d1 = makeD1({ content: 'x' })
    const room = makeRoom(d1)
    expect(room.core.activeEditor()).toBeNull()

    const broken: FakeConn = { ...conn('u0', 'broken@example.com'), state: { userId: 'u0' } }
    broken.close = () => {
      broken.open = false
    }
    room.conns.push(broken)
    expect(room.core.activeEditor()).toBeNull()

    room.conns.push(conn('u1', 'first@example.com'), conn('u2', 'second@example.com', 'owner'))
    expect(room.core.activeEditor()).toBe('first@example.com')

    room.conns[1].open = false
    expect(room.core.activeEditor()).toBe('second@example.com')
    expect(d1.state.calls).toHaveLength(0)
  })
})
