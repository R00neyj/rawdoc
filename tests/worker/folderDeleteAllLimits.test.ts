// 폴더 전부 삭제·금고 검사의 D1 바인딩 한도와 방 비우기 호출 상한 (버그 수정, 명세 없음. F-2038 5.4 규칙)
import { describe, expect, it, vi } from 'vitest'
import { asD1, openTestDb } from '../../worker/testD1'
import { folderSubtreeHasE2ee, deleteFolderContents, type FolderRow } from '../../worker/folders'
import { PURGE_CALLS_ON_DELETE } from '../../worker/purgeJobs'
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
  const getByName = vi.fn(() => ({ purgeRoom }))
  const env = { DB, ...(withRooms ? { DOC_ROOM: { getByName } } : {}) } as unknown as Env
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(user.id, user.email, 1)
  return { sqlDb, env, bindCounts, getByName }
}

function insertFolder(sqlDb: DatabaseSync, id: string, parentId: string | null) {
  sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,0)').run(id, user.id, id, parentId, 1, 1)
}
function insertDoc(sqlDb: DatabaseSync, id: string, folderId: string | null) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, user.id, 't', 'c', 'lf', folderId, 1, 1, 1)
}
function folderRow(id: string): FolderRow {
  return { id, owner_id: user.id, name: id, parent_id: null, created_at: 1, updated_at: 1 }
}

describe('폴더 전부 삭제의 D1 바인딩 한도', () => {
  function seedWide(sqlDb: DatabaseSync) {
    insertFolder(sqlDb, 'top', null)
    for (let i = 0; i < 250; i++) insertFolder(sqlDb, `s${i}`, 'top')
    for (let i = 0; i < 300; i++) insertDoc(sqlDb, `d${i}`, `s${i % 250}`)
  }

  it('T1 하위 폴더 250개·문서 300개 delete-all — 모든 질의의 바인딩이 100 이하이고 전부 지워진다', async () => {
    const { sqlDb, env, bindCounts } = setup()
    seedWide(sqlDb)
    const outcome = await deleteFolderContents(env, ctx, user, folderRow('top'), 'delete-all')
    expect(outcome).toEqual({ ok: true, docs: 300, folders: 251 })
    expect(Math.max(...bindCounts.map((b) => b.n))).toBeLessThanOrEqual(D1_MAX_BINDINGS)
    expect(sqlDb.prepare('SELECT COUNT(*) AS c FROM docs').get()).toEqual({ c: 0 })
    expect(sqlDb.prepare('SELECT COUNT(*) AS c FROM folders').get()).toEqual({ c: 0 })
  })

  it('T1 금고 검사도 바인딩 100 이하', async () => {
    const { sqlDb, env, bindCounts } = setup()
    seedWide(sqlDb)
    expect(await folderSubtreeHasE2ee(env, user, 'top')).toBe(false)
    expect(Math.max(...bindCounts.map((b) => b.n))).toBeLessThanOrEqual(D1_MAX_BINDINGS)
  })
})

describe('폴더 전부 삭제의 방 비우기 호출 상한', () => {
  it('T2 문서 60개 — 한 요청의 방 RPC 는 PURGE_CALLS_ON_DELETE 이하, 나머지는 purge_jobs room 행으로 남는다', async () => {
    const { sqlDb, env, getByName } = setup(true)
    insertFolder(sqlDb, 'f1', null)
    for (let i = 0; i < 60; i++) insertDoc(sqlDb, `d${i}`, 'f1')
    const outcome = await deleteFolderContents(env, ctx, user, folderRow('f1'), 'delete-all')
    expect(outcome).toEqual({ ok: true, docs: 60, folders: 1 })
    expect(getByName.mock.calls.length).toBeLessThanOrEqual(PURGE_CALLS_ON_DELETE)
    expect(getByName.mock.calls.length).toBeGreaterThan(0)
    const left = sqlDb.prepare("SELECT COUNT(*) AS c FROM purge_jobs WHERE kind = 'room'").get() as { c: number }
    expect(left.c).toBe(60 - getByName.mock.calls.length)
  })
})
