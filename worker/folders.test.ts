// 폴더 깊이 해제 — 만들기·옮기기 규칙이 서버에서도 같다 (specs/features/F-2017.md 4.1, S4)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', email: 'u1@example.com' })),
}))

import { handleCreateFolder, handleDeleteFolder, handleUpdateFolder } from './folders'
import { asD1, openTestDb } from './testD1'
import type { DatabaseSync } from 'node:sqlite'

type FolderRow = {
  id: string
  owner_id: string
  name: string
  parent_id: string | null
  created_at: number
  updated_at: number
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const A = uuid(1)
const A1 = uuid(2)
const A2 = uuid(3)
const B = uuid(4)

function makeEnv(folders: FolderRow[]) {
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT * FROM folders WHERE id = ?')) {
                const [id] = args as [string]
                return (folders.find((f) => f.id === id) ?? null) as T | null
              }
              throw new Error(`unhandled first sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT id, name, parent_id FROM folders WHERE owner_id = ?')) {
                const [ownerId] = args as [string]
                return { results: folders.filter((f) => f.owner_id === ownerId) as T[] }
              }
              throw new Error(`unhandled all sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('INSERT INTO folders')) {
                const [id, ownerId, name, parentId, createdAt, updatedAt] = args as [string, string, string, string | null, number, number]
                folders.push({ id, owner_id: ownerId, name, parent_id: parentId, created_at: createdAt, updated_at: updatedAt })
                return {}
              }
              if (sql.startsWith('UPDATE folders SET name = ?, parent_id = ?')) {
                const [name, parentId, updatedAt, id] = args as [string, string | null, number, string]
                const row = folders.find((f) => f.id === id)
                if (row) Object.assign(row, { name, parent_id: parentId, updated_at: updatedAt })
                return {}
              }
              if (sql.startsWith('UPDATE users SET')) return { meta: { changes: 1 } }
              throw new Error(`unhandled run sql: ${sql}`)
            },
          }
        },
      }
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      const results = []
      for (const statement of statements) results.push(await statement.run())
      return results
    },
  }
  return { DB } as unknown as Env
}

function row(id: string, name: string, parentId: string | null): FolderRow {
  return { id, owner_id: 'u1', name, parent_id: parentId, created_at: 1, updated_at: 1 }
}

// A › A1 › A2, 그리고 최상위 B
function seed() {
  return [row(A, 'A', null), row(A1, 'A1', A), row(A2, 'A2', A1), row(B, 'B', null)]
}

function jsonRequest(method: string, body: unknown) {
  return new Request('http://local.test/api/folders', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = {} as ExecutionContext

describe('F-2017 S4 폴더 API 깊이 규칙', () => {
  it('POST /api/folders 는 3단계 부모 아래에도 201', async () => {
    const env = makeEnv(seed())
    const res = await handleCreateFolder(jsonRequest('POST', { name: '넷째', parentId: A2 }), env)
    expect(res.status).toBe(201)
    expect(((await res.json()) as { parentId: string }).parentId).toBe(A2)
  })

  it('PATCH 로 자식 있는 폴더를 다른 폴더 안으로 200', async () => {
    const env = makeEnv(seed())
    const res = await handleUpdateFolder(jsonRequest('PATCH', { parentId: B }), env, ctx, { id: A })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { parentId: string }).parentId).toBe(B)
  })

  it('PATCH 로 자기 손자 안으로는 400', async () => {
    const env = makeEnv(seed())
    const res = await handleUpdateFolder(jsonRequest('PATCH', { parentId: A2 }), env, ctx, { id: A })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', field: 'parentId' })
  })

  it('PATCH 로 자기 자신 안으로는 400', async () => {
    const env = makeEnv(seed())
    const res = await handleUpdateFolder(jsonRequest('PATCH', { parentId: A }), env, ctx, { id: A })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', field: 'parentId' })
  })
})

// 버그 수정(명세 없음) — 폴더 `전부 삭제` 도 share_link_docs.doc_id REFERENCES docs(id) 때문에 같은 FK 오류가 날 것으로 보임
// (F-2038.md 12장 X1·X2). node:sqlite 도 기본 foreign_keys = 1 이라 실제 D1 과 같은 오류가 재현된다
describe('버그 수정 — 폴더 전부 삭제와 공유 링크 묶음', () => {
  function setup() {
    const sqlDb = openTestDb()
    const env = { DB: asD1(sqlDb) } as unknown as Env
    return { sqlDb, env }
  }
  function insertUser(sqlDb: DatabaseSync, id: string, email: string) {
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
  }
  function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, parentId: string | null) {
    sqlDb
      .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,0)')
      .run(id, ownerId, id, parentId, 1, 1)
  }
  function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, folderId: string | null) {
    sqlDb
      .prepare(
        'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(id, ownerId, 't', 'c', 'lf', folderId, 1, 1, 1)
  }
  function insertShareLink(sqlDb: DatabaseSync, token: string, ownerId: string, targetId: string) {
    sqlDb
      .prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)')
      .run(token, ownerId, 'doc', targetId, 1)
  }
  function insertShareLinkDoc(sqlDb: DatabaseSync, token: string, docId: string) {
    sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run(token, docId)
  }
  function deleteAllReq(folderId: string) {
    return new Request(`https://x/api/folders/${folderId}?contents=delete-all`, { method: 'DELETE' })
  }

  it('공유 묶음에 든 문서가 있는 폴더를 전부 삭제해도 FK 오류 없이 204, share_link_docs 행도 사라진다', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertFolder(sqlDb, 'f1', 'u1', null)
    insertDoc(sqlDb, 'd1', 'u1', null) // 링크의 시작 문서 — 폴더 밖
    insertDoc(sqlDb, 'd2', 'u1', 'f1') // 묶음에 든 문서 — f1 안, 전부 삭제 대상
    insertShareLink(sqlDb, 'tok1', 'u1', 'd1')
    insertShareLinkDoc(sqlDb, 'tok1', 'd2')

    const res = await handleDeleteFolder(deleteAllReq('f1'), env, ctx, { id: 'f1' })
    expect(res.status).toBe(204)
    const doc = sqlDb.prepare('SELECT * FROM docs WHERE id = ?').get('d2')
    expect(doc).toBeUndefined()
    const bundleRow = sqlDb.prepare('SELECT * FROM share_link_docs WHERE doc_id = ?').get('d2')
    expect(bundleRow).toBeUndefined()
    // 링크 자체(시작 문서 d1)는 폴더 밖이라 남아 있어야 한다
    const link = sqlDb.prepare('SELECT * FROM share_links WHERE token = ?').get('tok1')
    expect(link).toBeTruthy()
  })
})
