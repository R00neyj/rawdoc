// DO SQLite 에 쌓는 Yjs 업데이트 로그 (specs/features/F-304.md 6장). 표 이름에 제품명을 넣지 않는다

export const YSTORE_PART_BYTES = 1_500_000
export const COMPACT_ROWS = 100
export const COMPACT_BYTES = 524_288

export interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] }
}

export interface DoStorageLike {
  sql: SqlStorageLike
  transactionSync<T>(fn: () => T): T
}

const CREATE_UPDATES = `CREATE TABLE IF NOT EXISTS ydoc_updates (
  seq  INTEGER NOT NULL,
  part INTEGER NOT NULL,
  data BLOB    NOT NULL,
  PRIMARY KEY (seq, part)
)`

const CREATE_META = `CREATE TABLE IF NOT EXISTS ydoc_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`

const PUT_META = 'INSERT INTO ydoc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  throw new Error('ydoc_updates.data is not a blob')
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

export class YStore {
  private storage: DoStorageLike
  private maxSeq = 0
  private rowsSinceBase = 0
  private bytesSinceBase = 0

  constructor(storage: DoStorageLike) {
    this.storage = storage
    storage.sql.exec(CREATE_UPDATES)
    storage.sql.exec(CREATE_META)
  }

  // seq 순서로 이어 붙인 업데이트 목록. 압축 조건 계산도 여기서 다시 맞춘다
  load(): Uint8Array[] {
    const rows = this.storage.sql.exec('SELECT seq, part, data FROM ydoc_updates ORDER BY seq, part').toArray()
    const baseSeq = Number(this.getMeta('base_seq') ?? 0)
    const out: Uint8Array[] = []
    let currentSeq: number | null = null
    let parts: Uint8Array[] = []
    const finish = () => {
      if (currentSeq === null) return
      const joined = concat(parts)
      out.push(joined)
      if (currentSeq > baseSeq) {
        this.rowsSinceBase++
        this.bytesSinceBase += joined.length
      }
    }
    this.maxSeq = 0
    this.rowsSinceBase = 0
    this.bytesSinceBase = 0
    for (const row of rows) {
      const seq = Number(row.seq)
      if (seq !== currentSeq) {
        finish()
        currentSeq = seq
        parts = []
      }
      parts.push(toBytes(row.data))
      this.maxSeq = Math.max(this.maxSeq, seq)
    }
    finish()
    return out
  }

  private insert(update: Uint8Array): number {
    const seq = ++this.maxSeq
    for (let part = 0, offset = 0; offset < update.length || part === 0; part++, offset += YSTORE_PART_BYTES) {
      const chunk = update.slice(offset, offset + YSTORE_PART_BYTES)
      this.storage.sql.exec('INSERT INTO ydoc_updates (seq, part, data) VALUES (?, ?, ?)', seq, part, chunk.buffer)
    }
    return seq
  }

  private putMeta(meta: Record<string, string>) {
    for (const [key, value] of Object.entries(meta)) this.storage.sql.exec(PUT_META, key, value)
  }

  append(update: Uint8Array, meta: Record<string, string> = {}): number {
    const seq = this.storage.transactionSync(() => {
      const s = this.insert(update)
      this.putMeta(meta)
      return s
    })
    this.rowsSinceBase++
    this.bytesSinceBase += update.length
    return seq
  }

  // 압축·씨앗 — 기존 행을 모두 지우고 state 하나를 새 base 로 남긴다
  writeBase(state: Uint8Array, meta: Record<string, string> = {}): number {
    const seq = this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM ydoc_updates')
      const s = this.insert(state)
      this.putMeta({ ...meta, base_seq: String(s) })
      return s
    })
    this.rowsSinceBase = 0
    this.bytesSinceBase = 0
    return seq
  }

  shouldCompact(): boolean {
    return this.rowsSinceBase >= COMPACT_ROWS || this.bytesSinceBase >= COMPACT_BYTES
  }

  getMeta(key: string): string | null {
    const rows = this.storage.sql.exec('SELECT key, value FROM ydoc_meta').toArray()
    const row = rows.find((r) => r.key === key)
    return row ? String(row.value) : null
  }

  setMeta(key: string, value: string) {
    this.storage.sql.exec(PUT_META, key, value)
  }

  clear() {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM ydoc_updates')
      this.storage.sql.exec('DELETE FROM ydoc_meta')
    })
    this.maxSeq = 0
    this.rowsSinceBase = 0
    this.bytesSinceBase = 0
  }
}
