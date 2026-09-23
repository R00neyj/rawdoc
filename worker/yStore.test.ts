// DO SQLite 업데이트 로그 — 쪼개 쓰기·다시 잇기·압축·메타 (specs/features/F-304.md 6장, A3·A4)
import { describe, expect, it } from 'vitest'

import { COMPACT_BYTES, COMPACT_ROWS, YSTORE_PART_BYTES, YStore } from './yStore'
import type { DoStorageLike } from './yStore'

type UpdateRow = { seq: number; part: number; data: ArrayBuffer }

// 문장 앞머리로 가르는 가짜 DO SQL. transactionSync 는 실패하면 되돌린다
function makeStorage() {
  let updates: UpdateRow[] = []
  let meta = new Map<string, string>()
  const log: { sql: string; inTx: boolean }[] = []
  let inTx = false

  const storage: DoStorageLike = {
    sql: {
      exec(query: string, ...args: unknown[]) {
        const sql = query.trim().replace(/\s+/g, ' ')
        log.push({ sql, inTx })
        let rows: Record<string, unknown>[] = []
        if (sql.startsWith('CREATE TABLE IF NOT EXISTS')) {
          rows = []
        } else if (sql.startsWith('SELECT seq, part, data FROM ydoc_updates')) {
          rows = [...updates].sort((a, b) => a.seq - b.seq || a.part - b.part).map((r) => ({ ...r }))
        } else if (sql.startsWith('SELECT key, value FROM ydoc_meta')) {
          rows = [...meta].map(([key, value]) => ({ key, value }))
        } else if (sql.startsWith('INSERT INTO ydoc_updates')) {
          const [seq, part, data] = args as [number, number, ArrayBuffer]
          if (!(data instanceof ArrayBuffer)) throw new Error('data must be ArrayBuffer')
          if (updates.some((r) => r.seq === seq && r.part === part)) throw new Error('UNIQUE constraint failed')
          updates.push({ seq, part, data })
        } else if (sql.startsWith('INSERT INTO ydoc_meta')) {
          const [key, value] = args as [string, string]
          meta.set(key, value)
        } else if (sql.startsWith('DELETE FROM ydoc_updates')) {
          updates = []
        } else if (sql.startsWith('DELETE FROM ydoc_meta')) {
          meta = new Map()
        } else {
          throw new Error(`unhandled sql: ${sql}`)
        }
        return { toArray: () => rows }
      },
    },
    transactionSync<T>(fn: () => T): T {
      const savedUpdates = [...updates]
      const savedMeta = new Map(meta)
      inTx = true
      try {
        return fn()
      } catch (err) {
        updates = savedUpdates
        meta = savedMeta
        throw err
      } finally {
        inTx = false
      }
    },
  }
  return {
    storage,
    log,
    rows: () => updates,
    meta: () => meta,
  }
}

function bytes(length: number, seed = 1): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i++) out[i] = (i * 31 + seed) & 0xff
  return out
}

describe('F-304 A3 YStore 표·쪼개 쓰기·다시 잇기', () => {
  it('만들 때 두 표를 CREATE TABLE IF NOT EXISTS 로 만든다', () => {
    const s = makeStorage()
    new YStore(s.storage)
    const creates = s.log.map((l) => l.sql).filter((q) => q.startsWith('CREATE TABLE IF NOT EXISTS'))
    expect(creates.some((q) => q.includes('ydoc_updates') && q.includes('PRIMARY KEY (seq, part)'))).toBe(true)
    expect(creates.some((q) => q.includes('ydoc_meta') && q.includes('key TEXT PRIMARY KEY'))).toBe(true)
  })

  it('3,200,000 B 업데이트 하나는 같은 seq 에 part 0·1·2 로 쪼개진다', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    const big = bytes(3_200_000)
    store.append(big)
    const rows = s.rows()
    expect(rows.map((r) => r.part)).toEqual([0, 1, 2])
    expect(new Set(rows.map((r) => r.seq)).size).toBe(1)
    expect(rows.map((r) => r.data.byteLength)).toEqual([YSTORE_PART_BYTES, YSTORE_PART_BYTES, 200_000])
  })

  it('불러오면 seq 순서대로, 쪼갠 것은 바이트까지 같게 이어 붙인다', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    const small1 = bytes(10, 1)
    const big = bytes(3_200_000, 2)
    const small2 = bytes(20, 3)
    store.append(small1)
    store.append(big)
    store.append(small2)

    const loaded = new YStore(s.storage).load()
    expect(loaded).toHaveLength(3)
    expect(loaded[0]).toEqual(small1)
    expect(loaded[1].length).toBe(big.length)
    expect(loaded[1].every((b, i) => b === big[i])).toBe(true)
    expect(loaded[2]).toEqual(small2)
  })

  it('다시 불러온 뒤 추가하면 seq 가 이어진다', () => {
    const s = makeStorage()
    const first = new YStore(s.storage)
    first.load()
    first.append(bytes(5))
    const second = new YStore(s.storage)
    second.load()
    second.append(bytes(6))
    expect(new Set(s.rows().map((r) => r.seq)).size).toBe(2)
  })
})

describe('F-304 A4 YStore 압축·메타·비우기', () => {
  it('99행·524,287 B 이하면 거짓, 100행이면 참', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    for (let i = 0; i < COMPACT_ROWS - 1; i++) store.append(bytes(10))
    expect(store.shouldCompact()).toBe(false)
    store.append(bytes(10))
    expect(store.shouldCompact()).toBe(true)
  })

  it('바이트 합이 524,287 B 면 거짓, 한 행이 524,288 B 이상이면 참', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    store.append(bytes(COMPACT_BYTES - 1))
    expect(store.shouldCompact()).toBe(false)

    const s2 = makeStorage()
    const store2 = new YStore(s2.storage)
    store2.load()
    store2.append(bytes(COMPACT_BYTES))
    expect(store2.shouldCompact()).toBe(true)
  })

  it('압축은 기존 행을 다 지우고 새 seq 하나만 남기며 base_seq 를 바꾼다 — 한 트랜잭션 안에서', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    for (let i = 0; i < COMPACT_ROWS; i++) store.append(bytes(10, i))
    const before = s.log.length
    const state = bytes(40, 9)
    store.writeBase(state)

    const rows = s.rows()
    expect(new Set(rows.map((r) => r.seq)).size).toBe(1)
    expect(s.meta().get('base_seq')).toBe(String(rows[0].seq))
    expect(rows[0].seq).toBeGreaterThan(COMPACT_ROWS)
    expect(store.shouldCompact()).toBe(false)

    const writes = s.log.slice(before).filter((l) => !l.sql.startsWith('SELECT'))
    expect(writes.length).toBeGreaterThan(0)
    expect(writes.every((l) => l.inTx)).toBe(true)

    const loaded = new YStore(s.storage).load()
    expect(loaded).toEqual([state])
  })

  it('압축 뒤 다시 불러오면 조건 계산이 압축본 뒤 행만 센다', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    for (let i = 0; i < COMPACT_ROWS; i++) store.append(bytes(10))
    store.writeBase(bytes(10))
    for (let i = 0; i < COMPACT_ROWS - 1; i++) store.append(bytes(10))
    const reloaded = new YStore(s.storage)
    reloaded.load()
    expect(reloaded.shouldCompact()).toBe(false)
    reloaded.append(bytes(10))
    expect(reloaded.shouldCompact()).toBe(true)
  })

  it('메타 읽기·쓰기, 추가와 함께 쓰는 메타', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    expect(store.getMeta('d1_version')).toBeNull()
    store.setMeta('d1_version', '3')
    expect(store.getMeta('d1_version')).toBe('3')
    store.append(bytes(4), { d1_version: '4' })
    expect(s.meta().get('d1_version')).toBe('4')
    expect(new YStore(s.storage).getMeta('d1_version')).toBe('4')
  })

  it('비우기는 두 표를 비운다', () => {
    const s = makeStorage()
    const store = new YStore(s.storage)
    store.load()
    store.writeBase(bytes(10), { schema: '1', d1_version: '1' })
    store.append(bytes(10))
    store.clear()
    expect(s.rows()).toHaveLength(0)
    expect(s.meta().size).toBe(0)
    expect(store.load()).toEqual([])
  })
})
