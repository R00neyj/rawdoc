// F-222 A1 API 토큰 발급·목록·폐기 (specs/features/F-222.md 2.1·2.2)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import { handleCreateToken, handleDeleteToken, handleListTokens, MAX_TOKENS } from './apiTokens'

type ApiTokenRow = {
  id: string
  user_id: string
  name: string
  token_hash: string
  prefix: string
  created_at: number
  last_used_at: number | null
  revoked_at: number | null
}

function makeEnv(rows: ApiTokenRow[] = []) {
  const tokens = new Map(rows.map((r) => [r.id, r]))
  const insertCalls: unknown[][] = []

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT COUNT(*) as count FROM api_tokens')) {
                const [userId] = args as [string]
                const count = [...tokens.values()].filter((t) => t.user_id === userId && !t.revoked_at).length
                return { count } as T
              }
              if (sql.startsWith('SELECT id FROM api_tokens WHERE id = ? AND user_id = ?')) {
                const [id, userId] = args as [string, string]
                const row = tokens.get(id)
                if (!row || row.user_id !== userId || row.revoked_at) return null
                return { id: row.id } as T
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
            async all<T>() {
              if (sql.startsWith('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens')) {
                const [userId] = args as [string]
                const results = [...tokens.values()]
                  .filter((t) => t.user_id === userId && !t.revoked_at)
                  .sort((a, b) => b.created_at - a.created_at)
                return { results: results as T[] }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('INSERT INTO api_tokens')) {
                insertCalls.push(args)
                const [id, userId, name, tokenHash, prefix, createdAt] = args as [
                  string, string, string, string, string, number,
                ]
                tokens.set(id, {
                  id, user_id: userId, name, token_hash: tokenHash, prefix,
                  created_at: createdAt, last_used_at: null, revoked_at: null,
                })
                return { meta: { changes: 1 } }
              }
              if (sql.startsWith('UPDATE api_tokens SET revoked_at')) {
                const [revokedAt, id] = args as [number, string]
                const row = tokens.get(id)
                if (row) row.revoked_at = revokedAt
                return { meta: { changes: row ? 1 : 0 } }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { env: { DB } as unknown as Env, tokens, insertCalls }
}

function req(body: unknown, userId = 'u1'): Request {
  return new Request('http://local.test/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': userId },
    body: JSON.stringify(body),
  })
}

describe('F-222 A1 handleCreateToken', () => {
  it('성공하면 원문 토큰은 응답에만, D1 에는 해시·prefix 만 저장한다', async () => {
    const { env, tokens, insertCalls } = makeEnv()
    const res = await handleCreateToken(req({ name: '교안 자동 업로드' }), env)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string; prefix: string; token: string; lastUsedAt: null }
    expect(body.token).toMatch(/^rd_/)
    expect(body.lastUsedAt).toBeNull()
    expect(insertCalls.length).toBe(1)
    const saved = tokens.get(body.id)
    expect(saved?.token_hash).not.toBe(body.token)
    expect(saved?.prefix).toBe(body.prefix)
    expect(JSON.stringify(saved)).not.toContain(body.token)
  })

  it('이름이 빈 문자열이면 400', async () => {
    const { env } = makeEnv()
    const res = await handleCreateToken(req({ name: '  ' }), env)
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string; field: string }).toEqual({ error: 'invalid', field: 'name' })
  })

  it('이름이 41자면 400', async () => {
    const { env } = makeEnv()
    const res = await handleCreateToken(req({ name: 'a'.repeat(41) }), env)
    expect(res.status).toBe(400)
  })

  it('이름이 40자면 통과', async () => {
    const { env } = makeEnv()
    const res = await handleCreateToken(req({ name: 'a'.repeat(40) }), env)
    expect(res.status).toBe(201)
  })

  it('폐기 안 된 토큰이 10개면 11번째는 409', async () => {
    const now = Date.now()
    const rows: ApiTokenRow[] = Array.from({ length: MAX_TOKENS }, (_, i) => ({
      id: `t${i}`, user_id: 'u1', name: `t${i}`, token_hash: `h${i}`, prefix: `rd_aaaaaaaa`,
      created_at: now, last_used_at: null, revoked_at: null,
    }))
    const { env } = makeEnv(rows)
    const res = await handleCreateToken(req({ name: '새 토큰' }), env)
    expect(res.status).toBe(409)
    expect((await res.json()) as { error: string; limit: number }).toEqual({ error: 'too_many', limit: MAX_TOKENS })
  })
})

describe('F-222 A1 handleListTokens', () => {
  it('폐기 안 된 내 토큰만 최근 만든 순으로 돌려준다', async () => {
    const now = Date.now()
    const rows: ApiTokenRow[] = [
      { id: 't1', user_id: 'u1', name: '오래된', token_hash: 'h1', prefix: 'rd_aaaaaaaa', created_at: now - 1000, last_used_at: null, revoked_at: null },
      { id: 't2', user_id: 'u1', name: '최근', token_hash: 'h2', prefix: 'rd_bbbbbbbb', created_at: now, last_used_at: null, revoked_at: null },
      { id: 't3', user_id: 'u1', name: '폐기됨', token_hash: 'h3', prefix: 'rd_cccccccc', created_at: now, last_used_at: null, revoked_at: now },
      { id: 't4', user_id: 'u2', name: '남의 것', token_hash: 'h4', prefix: 'rd_dddddddd', created_at: now, last_used_at: null, revoked_at: null },
    ]
    const { env } = makeEnv(rows)
    const res = await handleListTokens(new Request('http://local.test/api/tokens', { headers: { 'x-test-user': 'u1' } }), env)
    const body = (await res.json()) as { id: string }[]
    expect(body.map((t) => t.id)).toEqual(['t2', 't1'])
  })
})

describe('F-222 A1 handleDeleteToken', () => {
  it('내 토큰이면 폐기하고 204', async () => {
    const now = Date.now()
    const rows: ApiTokenRow[] = [
      { id: 't1', user_id: 'u1', name: 'a', token_hash: 'h1', prefix: 'rd_aaaaaaaa', created_at: now, last_used_at: null, revoked_at: null },
    ]
    const { env, tokens } = makeEnv(rows)
    const res = await handleDeleteToken(new Request('http://local.test/api/tokens/t1', { method: 'DELETE', headers: { 'x-test-user': 'u1' } }), env, {} as ExecutionContext, { id: 't1' })
    expect(res.status).toBe(204)
    expect(tokens.get('t1')?.revoked_at).not.toBeNull()
  })

  it('남의 토큰이면 404', async () => {
    const now = Date.now()
    const rows: ApiTokenRow[] = [
      { id: 't1', user_id: 'u2', name: 'a', token_hash: 'h1', prefix: 'rd_aaaaaaaa', created_at: now, last_used_at: null, revoked_at: null },
    ]
    const { env } = makeEnv(rows)
    const res = await handleDeleteToken(new Request('http://local.test/api/tokens/t1', { method: 'DELETE', headers: { 'x-test-user': 'u1' } }), env, {} as ExecutionContext, { id: 't1' })
    expect(res.status).toBe(404)
  })
})
