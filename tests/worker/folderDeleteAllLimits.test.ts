// 폴더 전부 삭제(휴지통으로)·금고 검사의 D1 바인딩 한도와 방 닫기 호출 상한 (F-2038 5.4 규칙, specs/features/F-3023.md A4)
import { describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'
import { folderSubtreeHasE2ee } from '../../worker/folders'
import { trashFolder } from '../../worker/trash'
import { REVALIDATE_FANOUT_MAX } from '../../worker/docRoomRpc'
import type { DatabaseSync } from 'node:sqlite'

const D1_MAX_BINDINGS = 100
const user = { id: 'u1', email: 'u1@example.com' }
const ctx = { waitUntil: () => {} } as unknown as ExecutionContext

function setup(withRooms = false) {
  const sqlDb = openTestDb()
  const inner = asD1(sqlDb)
  const bindCounts: { sql: string; n: number }[] = []
  const DB = {
    prepare(sql: string) {
      const stmt = inner.prepare(sql)
      return {
        ...stmt,
        bind(...args: unknown[]) {
          bindCounts.push({ sql, n: args.length })
          return stmt.bind(...args)
        },
        first: stmt.first.bind(stmt),
        all: stmt.all.bind(stmt),
        run: stmt.run.bind(stmt),
      }
    },
    batch: inner.batch.bind(inner),
  }
  const purgeRoom = vi.fn(async () => {})
  const closeTrashed = vi.fn(async () => {})
  const getByName = vi.fn<(name: string) => unknown>(() => ({ purgeRoom, closeTrashed }))
  const env = { DB, ...(withRooms ? { DOC_ROOM: { getByName } } : {}) } as unknown as Env
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(user.id, user.email, 1)
  return { sqlDb, env, bindCounts, getByName, purgeRoom, closeTrashed }
}

function insertFolder(sqlDb: DatabaseSync, id: string, parentId: string | null) {
  sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,0)').run(id, user.id, id, parentId, 1, 1)
}
function insertDoc(sqlDb: DatabaseSync, id: string, folderId: string | null, updatedAt = 1) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, user.id, 't', 'c', 'lf', folderId, 1, 1, updatedAt)
}

function seedWide(sqlDb: DatabaseSync) {
  insertFolder(sqlDb, 'top', null)
  for (let i = 0; i < 250; i++) insertFolder(sqlDb, `s${i}`, 'top')
  for (let i = 0; i < 300; i++) insertDoc(sqlDb, `d${i}`, `s${i % 250}`, 1000 + i)
}

describe('F-3023 A4 폴더 전부 삭제의 D1 바인딩 한도·방 호출 상한', () => {
  it('폴더 250개·문서 300개 — 바인딩 최대 < 100, 문서는 전부 휴지통, 폴더는 0', async () => {
    const { sqlDb, env, bindCounts } = setup()
    seedWide(sqlDb)
    const outcome = await trashFolder(env, ctx, user, 'top', { by: 'app', allowE2ee: true })
    expect(outcome).toEqual({ ok: true, id: 'top', parentId: null, docs: 300, folders: 251 })
    expect(Math.max(...bindCounts.map((b) => b.n))).toBeLessThan(D1_MAX_BINDINGS)
    expect(sqlDb.prepare('SELECT COUNT(*) AS c FROM docs WHERE deleted_at IS NOT NULL').get()).toEqual({ c: 300 })
    expect(sqlDb.prepare('SELECT COUNT(*) AS c FROM folders').get()).toEqual({ c: 0 })
  })

  it('getByName 20번(updated_at 최근 20), purgeRoom 0번', async () => {
    const { sqlDb, env, getByName, purgeRoom, closeTrashed } = setup(true)
    seedWide(sqlDb)
    await trashFolder(env, ctx, user, 'top', { by: 'app', allowE2ee: true })
    expect(getByName.mock.calls.map(([id]) => id)).toEqual(Array.from({ length: REVALIDATE_FANOUT_MAX }, (_, i) => `d${299 - i}`))
    expect(closeTrashed).toHaveBeenCalledTimes(REVALIDATE_FANOUT_MAX)
    expect(purgeRoom).not.toHaveBeenCalled()
  })

  it('금고 검사도 바인딩 100 이하', async () => {
    const { sqlDb, env, bindCounts } = setup()
    seedWide(sqlDb)
    expect(await folderSubtreeHasE2ee(env, user, 'top')).toBe(false)
    expect(Math.max(...bindCounts.map((b) => b.n))).toBeLessThanOrEqual(D1_MAX_BINDINGS)
  })
})
