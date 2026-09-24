// 문서 행 조건부 쓰기 한 벌 (specs/features/F-308.md 6.1, A9 / specs/features/F-2025.md 6.1, 8.1 W1~W4)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { rowToDoc, updateDocRow } from './docWrite'
import type { DocRow } from './docWrite'
import { V1_EXAMPLES } from './v1Contract'
import { asD1, openTestDb } from './testD1'

const UPDATE_SQL = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND version = ?'

function row(overrides: Partial<DocRow> = {}): DocRow {
  return {
    id: 'd1', owner_id: 'u1', title: 't', content: 'c', line_ending: 'lf',
    folder_id: null, pinned_at: null, version: 3, created_at: 1, updated_at: 2,
    ...overrides,
  }
}

// batch 를 기록하는 가짜 D1 — 1번 문장의 meta.changes 만 판정에 쓰인다
function makeDb(changes: number) {
  type Stmt = { sql: string; args: unknown[] }
  const batches: Stmt[][] = []
  const DB = {
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => ({ sql, args }) }
    },
    async batch(statements: Stmt[]) {
      batches.push(statements)
      return statements.map((_, i) => ({ meta: { changes: i === 0 ? changes : 1 } }))
    },
  }
  return { env: { DB } as unknown as Env, batches }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(5_000_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('F-308 A9·F-2025 W1 updateDocRow·rowToDoc', () => {
  it('batch 1번, 첫 문장이 글자까지 같고, 둘째가 하루·누계 문장', async () => {
    const { env, batches } = makeDb(1)
    const result = await updateDocRow(env, row(), { content: 'new' })
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(2)
    expect(batches[0][0].sql).toBe(UPDATE_SQL)
    expect(batches[0][0].args).toEqual(['t', 'new', 4, 5_000_000, 'd1', 'u1', 3])
    expect(batches[0][1].sql).toContain('content_bytes = content_bytes')
    expect(batches[0][1].args).toEqual(['1970-01-01', 2, 0, 'u1'])
    expect(result).toEqual({ ok: true, row: row({ content: 'new', version: 4, updated_at: 5_000_000 }) })

    const titled = makeDb(1)
    await updateDocRow(titled.env, row(), { title: '새 제목' })
    expect(titled.batches[0][0].args).toEqual(['새 제목', 'c', 4, 5_000_000, 'd1', 'u1', 3])
    expect(titled.batches[0][1].args).toEqual(['1970-01-01', 0, 0, 'u1'])
  })

  it('0행이면 { ok: false }', async () => {
    const { env } = makeDb(0)
    await expect(updateDocRow(env, row(), { title: 'x', content: 'y' })).resolves.toEqual({ ok: false })
  })

  it('rowToDoc 키 집합이 V1_EXAMPLES.doc 과 같다', () => {
    expect(Object.keys(rowToDoc(row())).sort()).toEqual(Object.keys(V1_EXAMPLES.doc).sort())
    expect(rowToDoc(row())).toEqual({
      id: 'd1', title: 't', content: 'c', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 3, createdAt: 1, updatedAt: 2,
    })
  })
})

describe('F-2025 W2 actorId 가 소유자와 다름', () => {
  it('문장 3개 [문서 UPDATE, 누계만(u1), 하루만(actor)]', async () => {
    const { env, batches } = makeDb(1)
    await updateDocRow(env, row(), { content: 'new' }, 'actor')
    expect(batches[0]).toHaveLength(3)
    expect(batches[0][0].sql).toBe(UPDATE_SQL)
    expect(batches[0][1].sql).toContain('content_bytes = content_bytes')
    expect(batches[0][1].sql).not.toContain('write_count')
    expect(batches[0][1].args).toEqual([2, 0, 'u1'])
    expect(batches[0][2].sql).not.toContain('content_bytes')
    expect(batches[0][2].args).toEqual(['1970-01-01', 'actor'])
  })
})

describe('F-2025 W3 (F-2024 A8) 어댑터: 버전 맞음·틀림', () => {
  it('맞음 → 소유자 content_bytes 가 증감만큼, write_count +1', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    sqlDb.exec("UPDATE users SET content_bytes = 10 WHERE id = 'u1'")
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1','u1','t','abc','lf',3,1,1)",
    )
    const env = { DB: asD1(sqlDb) } as unknown as Env
    const existing = row({ content: 'abc', version: 3 })
    const written = await updateDocRow(env, existing, { content: 'abcdef' })
    expect(written.ok).toBe(true)
    const u1 = sqlDb.prepare('SELECT content_bytes, write_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      write_count: number
    }
    expect(u1.content_bytes).toBe(10 + 3)
    expect(u1.write_count).toBe(1)
  })

  it('틀림 → { ok: false }, 문서·누계 그대로, write_count +1', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    sqlDb.exec("UPDATE users SET content_bytes = 10 WHERE id = 'u1'")
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1','u1','t','abc','lf',3,1,1)",
    )
    const env = { DB: asD1(sqlDb) } as unknown as Env
    const existing = row({ content: 'abc', version: 2 }) // 낮춘 버전
    const written = await updateDocRow(env, existing, { content: 'abcdef' })
    expect(written).toEqual({ ok: false })
    const doc = sqlDb.prepare('SELECT content FROM docs WHERE id = ?').get('d1') as { content: string }
    expect(doc.content).toBe('abc')
    const u1 = sqlDb.prepare('SELECT content_bytes, write_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      write_count: number
    }
    expect(u1.content_bytes).toBe(10)
    expect(u1.write_count).toBe(1)
  })
})

describe('F-2025 W4 어댑터: 제목만 바꿈', () => {
  it('누계 그대로, write_count +1', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    sqlDb.exec("UPDATE users SET content_bytes = 10, doc_count = 1 WHERE id = 'u1'")
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1','u1','t','abc','lf',3,1,1)",
    )
    const env = { DB: asD1(sqlDb) } as unknown as Env
    const existing = row({ content: 'abc', version: 3 })
    await updateDocRow(env, existing, { title: 'new title' })
    const u1 = sqlDb.prepare('SELECT content_bytes, doc_count, write_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      doc_count: number
      write_count: number
    }
    expect(u1.content_bytes).toBe(10)
    expect(u1.doc_count).toBe(1)
    expect(u1.write_count).toBe(1)
  })
})
