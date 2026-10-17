// POST /mcp 쓰기 도구 — worker/index.ts 를 통째로, 실제 SQLite, authenticateMcp 는 정한 사용자를 준다 (F-3031 6장)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'

type Worker = { fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> }
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
type Caller = { user: { id: string; email: string }; clientId: string; clientName: string }

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'
const CREATE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
const UPDATE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

const authenticateMcp = vi.fn<(request: Request, env: Env, ctx: ExecutionContext) => Promise<Caller | Response>>()
let worker: Worker
let VAULT_DOC_MESSAGE: string

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.doMock('../../worker/mcpAuth', () => ({ authenticateMcp }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
  VAULT_DOC_MESSAGE = (await import('../../worker/mcpCall')).VAULT_DOC_MESSAGE
})

function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
}

async function setup(limiter?: { limit: () => Promise<{ success: boolean }> }) {
  const sqlDb = openTestDb()
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: EMAIL,
    BUCKET: { async put() {}, async delete() {} },
    DOC_ROOM: { getByName: () => ({ async purgeRoom() {} }) },
    ...(limiter ? { WRITE_LIMITER: limiter } : {}),
  } as unknown as Env
  await worker.fetch(
    new Request(`${ORIGIN}/api/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ title: 'seed', content: 'seed', lineEnding: 'lf' }),
    }),
    env,
    ctx(),
  )
  const owner = (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }).id
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('other', 'other@example.com', 1)
  sqlDb.prepare('DELETE FROM docs').run()
  authenticateMcp.mockReset()
  authenticateMcp.mockResolvedValue({ user: { id: owner, email: EMAIL }, clientId: 'client-1', clientName: 'Claude' })
  return { sqlDb, env, owner }
}

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: { content?: string; version?: number; e2ee_key?: string | null } = {}) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, ownerId, 't', over.content ?? 'c', 'lf', null, null, over.version ?? 1, 1, 1, over.e2ee_key ?? null)
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, e2ee = 0) {
  sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)').run(id, ownerId, 'f', null, 1, 1, e2ee)
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const count = (sqlDb: DatabaseSync, table: string) => (sqlDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

let rpcId = 0

async function rpc(env: Env, method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: 'Bearer mcp-access-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    }),
    env,
    ctx(),
  )
  expect(res.status).toBe(200)
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))
  if (!line) throw new Error('data 줄 없음')
  return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
}

async function tool(env: Env, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  return (await rpc(env, 'tools/call', { name, arguments: args })).result as ToolResult
}

function message(result: ToolResult): unknown {
  expect(result.isError).toBe(true)
  return result.structuredContent?.message
}

describe('F-3031 POST /mcp 쓰기 도구', () => {
  it('A1 tools/list 에 쓰기 도구 넷이 이름·title·주석으로 나온다', async () => {
    const { env } = await setup()
    const tools = ((await rpc(env, 'tools/list')).result as { tools: { name: string; title: string; annotations: unknown }[] }).tools
    const expected: [string, string, object][] = [
      ['create_document', 'Create document', CREATE],
      ['create_folder', 'Create folder', CREATE],
      ['move_document', 'Move document', CREATE],
      ['update_document', 'Update document', UPDATE],
    ]
    for (const [name, title, annotations] of expected) {
      const found = tools.find((t) => t.name === name)
      expect(found?.title, name).toBe(title)
      expect(found?.annotations, name).toEqual({ title, ...annotations })
    }
  })

  it('A2 네 도구가 D1 에 쓰고 성공 결과(+url)를 준다, update 뒤 version +1', async () => {
    const { sqlDb, env } = await setup()
    const folder = await tool(env, 'create_folder', { name: '폴더' })
    expect(folder.isError).toBeFalsy()
    const folderId = folder.structuredContent?.id as string
    expect(count(sqlDb, 'folders')).toBe(1)

    const created = await tool(env, 'create_document', { title: '제목', content: '본문', folderId })
    expect(created.isError).toBeFalsy()
    const id = created.structuredContent?.id as string
    expect(created.structuredContent).toEqual({ id, title: '제목', version: 1, folderId, updatedAt: expect.any(Number), url: `${ORIGIN}/?app=1#/d/${id}` })
    expect(created.structuredContent).not.toHaveProperty('content')

    const moved = await tool(env, 'move_document', { id, folderId: null })
    expect(moved.isError).toBeFalsy()
    expect(moved.structuredContent?.folderId ?? null).toBeNull()

    const updated = await tool(env, 'update_document', { id, baseVersion: 1, content: '새 본문' })
    expect(updated.isError).toBeFalsy()
    expect(updated.structuredContent).toEqual({ id, title: '제목', version: 2, updatedAt: expect.any(Number), url: `${ORIGIN}/?app=1#/d/${id}` })
    const row = sqlDb.prepare('SELECT content, version FROM docs WHERE id = ?').get(id) as { content: string; version: number }
    expect(row).toEqual({ content: '새 본문', version: 2 })
  })

  it('A3 낡은 baseVersion 은 현재 문서를 돌려주고 쓰지 않는다, 같은 본문이면 오류 아님', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { content: 'server', version: 3 })
    const conflict = await tool(env, 'update_document', { id: uuid(1), baseVersion: 2, content: 'mine' })
    expect(message(conflict)).toBe(
      'The document changed since version 2 (now 3). Nothing was written. The current document is in doc; apply your edit to it and retry with baseVersion 3.',
    )
    expect((conflict.structuredContent?.doc as { version: number; content: string }).version).toBe(3)
    expect(conflict.structuredContent?.error).toBe('conflict')
    expect((sqlDb.prepare('SELECT content FROM docs WHERE id = ?').get(uuid(1)) as { content: string }).content).toBe('server')

    const room = { async writeText() { return { type: 'ok', doc: { title: 't', content: 'server', version: 3, updatedAt: 1 } } } }
    const same = await tool({ ...env, DOC_ROOM: { getByName: () => room } } as unknown as Env, 'update_document', { id: uuid(1), baseVersion: 2, content: 'server' })
    expect(same.isError).toBeFalsy()
  })

  it('A4 금고 문서·폴더는 막힌다', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { e2ee_key: 'K' })
    insertDoc(sqlDb, uuid(2), owner)
    insertFolder(sqlDb, uuid(3), owner, 1)
    const vaultFolder = 'Vault (end-to-end encrypted) folders cannot be used through this connection.'

    expect(message(await tool(env, 'update_document', { id: uuid(1), baseVersion: 1, content: 'x' }))).toBe(VAULT_DOC_MESSAGE)
    expect(message(await tool(env, 'move_document', { id: uuid(1), folderId: null }))).toBe(VAULT_DOC_MESSAGE)
    expect(message(await tool(env, 'move_document', { id: uuid(2), folderId: uuid(3) }))).toBe(vaultFolder)
    expect(message(await tool(env, 'create_document', { title: 't', content: 'c', folderId: uuid(3) }))).toBe(vaultFolder)
    expect(message(await tool(env, 'create_folder', { name: 'n', parentId: uuid(3) }))).toBe(vaultFolder)
    expect(count(sqlDb, 'docs')).toBe(2)
  })

  it('A5 하루 한도에 닿은 계정은 쓰기 넷 모두 막히고 D1 은 그대로', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner)
    sqlDb.prepare('UPDATE users SET write_day = ?, write_count = ? WHERE id = ?').run(new Date().toISOString().slice(0, 10), 5000, owner)
    const calls: [string, Record<string, unknown>][] = [
      ['create_document', { title: 't', content: 'c' }],
      ['create_folder', { name: 'n' }],
      ['move_document', { id: uuid(1), folderId: null }],
      ['update_document', { id: uuid(1), baseVersion: 1, content: 'x' }],
    ]
    for (const [name, args] of calls) {
      const result = await tool(env, name, args)
      expect(result.isError, name).toBe(true)
      expect(result.structuredContent).toMatchObject({ error: 'rate_limited', scope: 'day', limit: 5000 })
      expect(result.structuredContent?.retryAfter).toEqual(expect.any(Number))
      expect(result.structuredContent?.limitsUrl).toMatch(new RegExp(`^${ORIGIN}/limits\\?scope=day&retry=\\d+$`))
    }
    expect(count(sqlDb, 'docs')).toBe(1)
    expect(count(sqlDb, 'folders')).toBe(0)
  })

  it('A6 분 한도·막힌 계정, 읽기 도구는 리미터를 부르지 않는다', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const { sqlDb, env, owner } = await setup({ limit })
    const minute = await tool(env, 'create_folder', { name: 'n' })
    expect(minute.structuredContent).toMatchObject({ error: 'rate_limited', scope: 'minute', retryAfter: 60, limitsUrl: `${ORIGIN}/limits?scope=minute&retry=60` })
    expect(message(minute)).toContain('Write limit reached (120 writes per minute). Writes resume in 60 seconds.')

    limit.mockClear()
    await tool(env, 'list_folders')
    await tool(env, 'search', { query: 'x' })
    expect(limit).not.toHaveBeenCalled()

    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(Date.now(), owner)
    const blocked = await tool(env, 'create_folder', { name: 'n' })
    expect(blocked.structuredContent).toEqual({ message: 'This account is blocked from writing. Reading still works.', error: 'account_blocked' })
  })

  it('A7 없는·남의 폴더로 create_document 는 folder_not_found', async () => {
    const { sqlDb, env } = await setup()
    insertFolder(sqlDb, uuid(5), 'other')
    for (const folderId of [uuid(4), uuid(5)]) {
      const result = await tool(env, 'create_document', { title: 't', content: 'c', folderId })
      expect(message(result)).toBe('Folder not found, or you do not have access. Use list_folders to find one.')
      expect(result.structuredContent?.error).toBe('folder_not_found')
    }
    expect(count(sqlDb, 'docs')).toBe(0)
  })

  it('A8 update_document 에 content·title 이 없으면 missing_change', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner)
    const result = await tool(env, 'update_document', { id: uuid(1), baseVersion: 1 })
    expect(message(result)).toBe('Provide content, title, or both.')
    expect(result.structuredContent?.error).toBe('missing_change')
    expect((sqlDb.prepare('SELECT version FROM docs WHERE id = ?').get(uuid(1)) as { version: number }).version).toBe(1)
  })

  it('A2 핸들러가 던지면 내부 오류 문구로 바뀐다', async () => {
    const { env } = await setup()
    const broken = new Proxy(env.DB, { get: () => () => { throw new Error('SQL secret') } })
    const result = await tool({ ...env, DB: broken } as Env, 'create_folder', { name: 'n' })
    expect(message(result)).not.toContain('SQL secret')
  })
})
