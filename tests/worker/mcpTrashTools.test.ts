// POST /mcp 지우기 도구 — worker/index.ts 를 통째로, 실제 SQLite, authenticateMcp 는 정한 사용자를 준다 (F-3032 5장)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { DAILY_WRITE_LIMIT, utcDay } from '../../worker/usage'
import { TRASH_RETENTION_DAYS } from '../../src/lib/trash'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
type Caller = { user: { id: string; email: string }; clientId: string; clientName: string }
type DocState = { deleted_at: number | null; deleted_by: string | null; deleted_path: string | null }

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'
const OTHER_EMAIL = 'other@example.com'
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, openWorldHint: false }

const authenticateMcp = vi.fn<(request: Request, env: Env, ctx: ExecutionContext) => Promise<Caller | Response>>()
let worker: Worker
let MCP_INSTRUCTIONS: string
let VAULT_DOC_MESSAGE: string

beforeAll(async () => {
  vi.doMock('../../worker/docRoom', () => ({ DocRoom: class {} }))
  vi.doMock('../../worker/mcpAuth', () => ({ authenticateMcp }))
  vi.resetModules()
  worker = (await import('../../worker/index')).default as unknown as Worker
  MCP_INSTRUCTIONS = (await import('../../worker/mcp')).MCP_INSTRUCTIONS
  VAULT_DOC_MESSAGE = (await import('../../worker/mcpCall')).VAULT_DOC_MESSAGE
})

function ctx(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
}

function call(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('Origin')) headers.set('Origin', ORIGIN)
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, ctx())
}

async function setup() {
  const sqlDb = openTestDb()
  const env = {
    DB: asD1(sqlDb),
    BETTER_AUTH_URL: ORIGIN,
    DEV_AUTH_EMAIL: EMAIL,
    BUCKET: { async put() {}, async delete() {} },
    DOC_ROOM: { getByName: () => ({ async purgeRoom() {}, async closeTrashed() {} }) },
  } as unknown as Env
  await call(env, '/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'seed', content: 'seed', lineEnding: 'lf' }),
  })
  const owner = (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }).id
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('other', OTHER_EMAIL, 1)
  authenticateMcp.mockReset()
  authenticateMcp.mockResolvedValue({ user: { id: owner, email: EMAIL }, clientId: 'client-1', clientName: 'Claude' })
  return { sqlDb, env, owner }
}

type DocOverrides = Partial<{ title: string; folder_id: string | null; e2ee_key: string | null }>

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOverrides = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, ownerId, over.title ?? 't', 'c', 'lf', over.folder_id ?? null, null, 1, 1, 1, over.e2ee_key ?? null)
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, opts: { parentId?: string | null; name?: string } = {}) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, opts.name ?? 'f', opts.parentId ?? null, 1, 1, 0)
}

function grant(sqlDb: DatabaseSync, targetId: string) {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run('doc', targetId, 'other', EMAIL, 'edit', 1)
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const docState = (sqlDb: DatabaseSync, id: string) => sqlDb.prepare('SELECT deleted_at, deleted_by, deleted_path FROM docs WHERE id = ?').get(id) as DocState
const folderCount = (sqlDb: DatabaseSync, id: string) => (sqlDb.prepare('SELECT COUNT(*) AS n FROM folders WHERE id = ?').get(id) as { n: number }).n
const writeCount = (sqlDb: DatabaseSync, id: string) => (sqlDb.prepare('SELECT write_count AS n FROM users WHERE id = ?').get(id) as { n: number }).n

let rpcId = 0

function mcpRequest(env: Env, body: unknown): Promise<Response> {
  return worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: 'Bearer mcp-access-token',
      },
      body: JSON.stringify(body),
    }),
    env,
    ctx(),
  )
}

async function rpc(env: Env, method: string, params?: unknown): Promise<Record<string, unknown>> {
  const res = await mcpRequest(env, { jsonrpc: '2.0', id: ++rpcId, method, params })
  expect(res.status).toBe(200)
  const line = (await res.text()).split('\n').find((l) => l.startsWith('data: '))
  if (!line) throw new Error('data 줄 없음')
  return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
}

async function tool(env: Env, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await rpc(env, 'tools/call', { name, arguments: args })).result as ToolResult
}

function payload(result: ToolResult): Record<string, unknown> {
  expect(result.isError).toBe(true)
  return JSON.parse(result.content[0].text) as Record<string, unknown>
}

describe('F-3032 POST /mcp 지우기 도구', () => {
  it('M1 delete_document 는 내 문서를 휴지통으로, 다시 부르면 not_found 이고 쓰기 수는 그대로', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { title: '지울 문서' })
    const before = writeCount(sqlDb, owner)

    const result = await tool(env, 'delete_document', { id: uuid(1) })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ id: uuid(1), title: '지울 문서', trashed: true, retentionDays: TRASH_RETENTION_DAYS })
    const row = docState(sqlDb, uuid(1))
    expect(row.deleted_at).toBeTruthy()
    expect(row.deleted_by).toBe('mcp:Claude')
    expect(writeCount(sqlDb, owner)).toBe(before + 1)

    const trash = (await (await call(env, '/api/trash')).json()) as { id: string }[]
    expect(trash.map((t) => t.id)).toContain(uuid(1))

    const again = await tool(env, 'delete_document', { id: uuid(1) })
    expect(payload(again)).toMatchObject({ error: 'not_found' })
    expect(writeCount(sqlDb, owner)).toBe(before + 1)
  })

  it('M2 공유받은 문서 forbidden, 내 금고 e2ee_doc, 남의 금고·없는 id 는 not_found — 행은 그대로', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), 'other')
    grant(sqlDb, uuid(1))
    insertDoc(sqlDb, uuid(2), owner, { e2ee_key: 'K' })
    insertDoc(sqlDb, uuid(3), 'other', { e2ee_key: 'K' })

    expect(payload(await tool(env, 'delete_document', { id: uuid(1) }))).toMatchObject({ error: 'forbidden' })
    expect(payload(await tool(env, 'delete_document', { id: uuid(2) }))).toMatchObject({ error: 'e2ee_doc', message: VAULT_DOC_MESSAGE })
    expect(payload(await tool(env, 'delete_document', { id: uuid(3) }))).toMatchObject({ error: 'not_found' })
    expect(payload(await tool(env, 'delete_document', { id: uuid(4) }))).toMatchObject({ error: 'not_found' })
    for (const id of [uuid(1), uuid(2), uuid(3)]) expect(docState(sqlDb, id).deleted_at, id).toBeNull()
  })

  it('M3 delete_folder 는 하위 폴더와 문서들을 휴지통으로, 폴더 행은 0', async () => {
    const { sqlDb, env, owner } = await setup()
    insertFolder(sqlDb, uuid(10), owner, { name: '상위' })
    insertFolder(sqlDb, uuid(11), owner, { parentId: uuid(10), name: '하위' })
    insertDoc(sqlDb, uuid(1), owner, { folder_id: uuid(10) })
    insertDoc(sqlDb, uuid(2), owner, { folder_id: uuid(11) })

    const result = await tool(env, 'delete_folder', { id: uuid(10) })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({ id: uuid(10), parentId: null, trashedDocuments: 2, deletedFolders: 2, retentionDays: TRASH_RETENTION_DAYS })
    for (const id of [uuid(1), uuid(2)]) {
      const row = docState(sqlDb, id)
      expect(row.deleted_by, id).toBe('mcp:Claude')
      expect(row.deleted_path, id).toBeTruthy()
    }
    expect(folderCount(sqlDb, uuid(10)) + folderCount(sqlDb, uuid(11))).toBe(0)
  })

  it('M4 금고 문서가 든 폴더는 e2ee_folder 로 아무것도 안 바꾸고, 남의 폴더·없는 id 는 not_found', async () => {
    const { sqlDb, env, owner } = await setup()
    insertFolder(sqlDb, uuid(10), owner)
    insertFolder(sqlDb, uuid(11), owner, { parentId: uuid(10) })
    insertDoc(sqlDb, uuid(1), owner, { folder_id: uuid(10) })
    insertDoc(sqlDb, uuid(2), owner, { folder_id: uuid(11), e2ee_key: 'K' })
    insertFolder(sqlDb, uuid(12), 'other')

    expect(payload(await tool(env, 'delete_folder', { id: uuid(10) }))).toMatchObject({ error: 'e2ee_folder' })
    expect(folderCount(sqlDb, uuid(10)) + folderCount(sqlDb, uuid(11))).toBe(2)
    expect(docState(sqlDb, uuid(1)).deleted_at).toBeNull()
    expect(docState(sqlDb, uuid(2)).deleted_at).toBeNull()
    expect(payload(await tool(env, 'delete_folder', { id: uuid(12) }))).toMatchObject({ error: 'not_found' })
    expect(payload(await tool(env, 'delete_folder', { id: uuid(13) }))).toMatchObject({ error: 'not_found' })
    expect(folderCount(sqlDb, uuid(12))).toBe(1)
  })

  it('M5 하루 한도 계정은 /limits?scope=day 링크, 막힌 계정은 account_blocked — 행은 그대로', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner)
    sqlDb.prepare('UPDATE users SET write_day = ?, write_count = ? WHERE id = ?').run(utcDay(Date.now()), DAILY_WRITE_LIMIT, owner)
    for (const name of ['delete_document', 'delete_folder']) {
      const result = await tool(env, name, { id: uuid(1) })
      expect(result.isError, name).toBe(true)
      expect(result.content[0].text, name).toContain('/limits?scope=day')
    }
    expect(docState(sqlDb, uuid(1)).deleted_at).toBeNull()

    sqlDb.prepare('UPDATE users SET write_count = 0, blocked_at = 5 WHERE id = ?').run(owner)
    for (const name of ['delete_document', 'delete_folder']) {
      expect(payload(await tool(env, name, { id: uuid(1) })), name).toMatchObject({ error: 'account_blocked' })
    }
    expect(docState(sqlDb, uuid(1)).deleted_at).toBeNull()
  })

  it('M6 tools/list 는 제목·주석·설명을, initialize 는 안내 문장을 준다', async () => {
    const { env } = await setup()
    const list = (await rpc(env, 'tools/list')).result as { tools: { name: string; title: string; description: string; annotations: unknown }[] }
    const days = TRASH_RETENTION_DAYS
    const expected = {
      delete_document: {
        title: 'Move document to trash',
        description: `Moves one of your documents to the trash. It disappears from lists, search and shared links at once, and is permanently deleted after ${days} days unless the user restores it from the trash in the app. Only the owner can do this. Vault (end-to-end encrypted) documents cannot be deleted through this connection.`,
      },
      delete_folder: {
        title: 'Delete folder',
        description: `Deletes one of your folders together with its subfolders and moves every document inside to the trash. Documents can be restored from the trash in the app for ${days} days; a restored document goes back to the top level if its folder no longer exists. Shares and links on the folder are removed and do not come back. Fails without changing anything if any vault (end-to-end encrypted) item is inside.`,
      },
    }
    for (const [name, want] of Object.entries(expected)) {
      const found = list.tools.find((t) => t.name === name)
      expect(found, name).toBeDefined()
      expect(found?.title).toBe(want.title)
      expect(found?.description).toBe(want.description)
      expect(found?.annotations).toEqual(DESTRUCTIVE)
    }

    const init = (await rpc(env, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })).result as {
      instructions: string
    }
    const sentence = `Deleting moves documents to the trash, where the user can restore them in the app for ${days} days; deleting a folder also removes its subfolders and folder shares. Ask the user before deleting.`
    expect(init.instructions).toBe(MCP_INSTRUCTIONS)
    expect(init.instructions.endsWith(sentence)).toBe(true)
  })
})
