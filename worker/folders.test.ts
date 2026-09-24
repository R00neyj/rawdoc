// 폴더 깊이 해제 — 만들기·옮기기 규칙이 서버에서도 같다 (specs/features/F-2017.md 4.1, S4)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1', email: 'u1@example.com' })),
}))

import { handleCreateFolder, handleUpdateFolder } from './folders'

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
