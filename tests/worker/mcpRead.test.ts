// POST /mcp 읽기 도구 — worker/index.ts 를 통째로, 실제 SQLite, authenticateMcp 는 정한 사용자를 준다 (F-3030 6장)
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { asD1, openTestDb } from '../../worker/testD1'
import { readUsage } from '../../worker/usage'
import brand from '../../brand.config'

type Worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }
type Caller = { user: { id: string; email: string }; clientId: string; clientName: string }

const ORIGIN = 'http://localhost:8790'
const EMAIL = 'owner@example.com'
const OTHER_EMAIL = 'other@example.com'
const NOT_FOUND = 'Not found, or you do not have access.'
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }

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
    DOC_ROOM: { getByName: () => ({ async purgeRoom() {} }) },
  } as unknown as Env
  await call(env, '/api/docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'seed', content: 'seed', lineEnding: 'lf' }),
  })
  const owner = (sqlDb.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL) as { id: string }).id
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('other', OTHER_EMAIL, 1)
  const tokenRes = await call(env, '/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '토큰' }),
  })
  const token = ((await tokenRes.json()) as { token: string }).token
  authenticateMcp.mockReset()
  authenticateMcp.mockResolvedValue({ user: { id: owner, email: EMAIL }, clientId: 'client-1', clientName: 'Claude' })
  return { sqlDb, env, owner, token }
}

type DocOverrides = Partial<{ title: string; content: string; folder_id: string | null; e2ee_key: string | null; updated_at: number; version: number }>

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, over: DocOverrides = {}) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, pinned_at, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
    .run(id, ownerId, over.title ?? 't', over.content ?? 'c', 'lf', over.folder_id ?? null, null, over.version ?? 1, 1, over.updated_at ?? 1, over.e2ee_key ?? null)
}

function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string, opts: { parentId?: string | null; e2ee?: number; name?: string } = {}) {
  sqlDb
    .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, opts.name ?? 'f', opts.parentId ?? null, 1, 1, opts.e2ee ?? 0)
}

function grant(sqlDb: DatabaseSync, type: 'doc' | 'folder', targetId: string, role: 'view' | 'edit') {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(type, targetId, 'other', EMAIL, role, 1)
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const docUrl = (id: string) => `${ORIGIN}/?app=1#/d/${id}`

let rpcId = 0

function mcpRequest(env: Env, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const method = init.method ?? 'POST'
  return worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
        Authorization: 'Bearer mcp-access-token',
      },
      body: method === 'POST' ? JSON.stringify(init.body) : undefined,
    }),
    env,
    ctx(),
  )
}

function dataLine(text: string): Record<string, unknown> {
  const line = text.split('\n').find((l) => l.startsWith('data: '))
  if (!line) throw new Error(`data 줄 없음: ${text}`)
  return JSON.parse(line.slice('data: '.length)) as Record<string, unknown>
}

async function rpc(env: Env, method: string, params?: unknown): Promise<{ message: Record<string, unknown>; raw: string }> {
  const res = await mcpRequest(env, { body: { jsonrpc: '2.0', id: ++rpcId, method, params } })
  expect(res.status).toBe(200)
  const raw = await res.text()
  return { message: dataLine(raw), raw }
}

async function tool(env: Env, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const { message } = await rpc(env, 'tools/call', { name, arguments: args })
  return message.result as ToolResult
}

function errorMessage(result: ToolResult): unknown {
  expect(result.isError).toBe(true)
  return (JSON.parse(result.content[0].text) as { message: unknown }).message
}

describe('F-3030 POST /mcp 읽기 도구', () => {
  it('M1 initialize 는 이름·안내문을, tools/list 는 읽기 다섯을 제목·주석과 함께 준다', async () => {
    const { env } = await setup()
    const init = await rpc(env, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    const initResult = init.message.result as { serverInfo: { name: string }; instructions: string }
    expect(initResult.serverInfo.name).toBe(brand.cliName)
    expect(initResult.instructions).toBe(MCP_INSTRUCTIONS)

    const list = await rpc(env, 'tools/list')
    const tools = (list.message.result as { tools: { name: string; title: string; annotations: unknown }[] }).tools
    const expected: Record<string, string> = {
      search: 'Search documents',
      fetch: 'Fetch document',
      list_documents: 'List documents',
      list_folders: 'List folders',
      list_shared: 'List shared documents',
    }
    for (const [name, title] of Object.entries(expected)) {
      const found = tools.find((t) => t.name === name)
      expect(found, name).toBeDefined()
      expect(found?.title).toBe(title)
      expect(found?.annotations).toEqual(READ_ONLY)
    }
  })

  it('M2 GET·DELETE 는 인증 전에 405, 인증이 준 401 은 상태·헤더 그대로', async () => {
    const { env } = await setup()
    for (const method of ['GET', 'DELETE']) {
      const res = await mcpRequest(env, { method })
      expect(res.status, method).toBe(405)
      expect(res.headers.get('Allow')).toBe('POST')
      expect(await res.json()).toEqual({ error: 'method_not_allowed' })
    }
    expect(authenticateMcp).not.toHaveBeenCalled()

    const challenge = 'Bearer resource_metadata="http://localhost:8790/.well-known/oauth-protected-resource/mcp"'
    authenticateMcp.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: { 'WWW-Authenticate': challenge, 'Content-Type': 'application/json' } }),
    )
    const res = await mcpRequest(env, { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe(challenge)
    expect(await res.json()).toEqual({ error: 'invalid_token' })
  })

  it('M3 search 는 내 문서 중 맞는 것만 id·title·url 로 준다', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { title: '본문 문서', content: 'The NEEDLE here', updated_at: 30 })
    insertDoc(sqlDb, uuid(2), owner, { title: 'Needle 제목', content: 'x', updated_at: 20 })
    insertDoc(sqlDb, uuid(3), owner, { title: 'x', content: 'no match' })
    insertDoc(sqlDb, uuid(4), owner, { title: '', content: 'needle', e2ee_key: 'K' })
    insertDoc(sqlDb, uuid(5), 'other', { title: 'needle', content: 'needle' })
    insertDoc(sqlDb, uuid(6), 'other', { title: 'needle', content: 'needle' })
    grant(sqlDb, 'doc', uuid(6), 'edit')

    const result = await tool(env, 'search', { query: 'needle' })
    expect(result.isError).toBeFalsy()
    expect(result.structuredContent).toEqual({
      results: [
        { id: uuid(1), title: '본문 문서', url: docUrl(uuid(1)) },
        { id: uuid(2), title: 'Needle 제목', url: docUrl(uuid(2)) },
      ],
    })
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent)
  })

  it('M4 fetch 는 /v1 content 를 바이트까지 그대로, 공유 문서도 열고, 금고·없음·형식 오류는 isError', async () => {
    const { sqlDb, env, owner, token } = await setup()
    const content = '# 제목  \r\n\r\n줄 끝 공백\t \n이모지 😀 \u00a0끝\r\n'
    insertDoc(sqlDb, uuid(1), owner, { title: '원문', content, version: 7, updated_at: 42 })
    insertDoc(sqlDb, uuid(2), 'other', { title: '공유', content: 'shared\r\nbody' })
    grant(sqlDb, 'doc', uuid(2), 'edit')
    insertDoc(sqlDb, uuid(3), owner, { title: '', content: 'cipher', e2ee_key: 'K' })

    for (const id of [uuid(1), uuid(2)]) {
      const v1 = (await (await call(env, `/v1/docs/${id}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { content: string }
      const result = await tool(env, 'fetch', { id })
      expect(result.isError, id).toBeFalsy()
      expect((result.structuredContent as { text: string }).text).toBe(v1.content)
    }
    expect((await tool(env, 'fetch', { id: uuid(1) })).structuredContent).toEqual({
      id: uuid(1),
      title: '원문',
      text: content,
      url: docUrl(uuid(1)),
      metadata: { version: 7, folderId: null, updatedAt: 42 },
    })

    expect(errorMessage(await tool(env, 'fetch', { id: uuid(3) }))).toBe(VAULT_DOC_MESSAGE)
    expect(errorMessage(await tool(env, 'fetch', { id: uuid(99) }))).toBe(NOT_FOUND)
    const bad = await tool(env, 'fetch', { id: 5 })
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toMatch(/^Input validation error/)
  })

  it('M5 list_documents 는 금고를 빼고 세며, folderId 는 바로 아래만, 남의 폴더는 isError', async () => {
    const { sqlDb, env, owner } = await setup()
    insertFolder(sqlDb, uuid(10), owner)
    insertFolder(sqlDb, uuid(11), owner, { parentId: uuid(10) })
    insertFolder(sqlDb, uuid(12), 'other')
    insertDoc(sqlDb, uuid(1), owner, { title: 'a', folder_id: uuid(10), version: 3, updated_at: 5 })
    insertDoc(sqlDb, uuid(2), owner, { title: 'b', folder_id: uuid(11), updated_at: 4 })
    insertDoc(sqlDb, uuid(3), owner, { title: '', folder_id: uuid(10), e2ee_key: 'K', updated_at: 3 })
    insertDoc(sqlDb, uuid(4), owner, { title: '', e2ee_key: 'K', updated_at: 2 })
    insertDoc(sqlDb, uuid(5), 'other', { title: 'x' })

    const all = (await tool(env, 'list_documents')).structuredContent as { documents: { id: string }[]; vaultSkipped: number; nextOffset?: number }
    expect(all.documents.map((d) => d.id)).not.toContain(uuid(3))
    expect(all.documents.map((d) => d.id)).not.toContain(uuid(5))
    expect(all.documents.slice(1).map((d) => d.id)).toEqual([uuid(1), uuid(2)])
    expect(all.vaultSkipped).toBe(2)
    expect('nextOffset' in all).toBe(false)

    expect((await tool(env, 'list_documents', { folderId: uuid(10) })).structuredContent).toEqual({
      documents: [{ id: uuid(1), title: 'a', folderId: uuid(10), version: 3, updatedAt: 5, url: docUrl(uuid(1)) }],
      vaultSkipped: 1,
    })
    expect(errorMessage(await tool(env, 'list_documents', { folderId: uuid(12) }))).toBe(NOT_FOUND)
    expect((await tool(env, 'list_documents', { folderId: 'nope' })).isError).toBe(true)
  })

  it('M5 문서 201개면 200개와 nextOffset 200, offset 200 이면 1개·nextOffset 없음', async () => {
    const { sqlDb, env, owner } = await setup()
    for (let i = 1; i <= 200; i++) insertDoc(sqlDb, uuid(i), owner, { updated_at: i })
    insertDoc(sqlDb, uuid(500), owner, { title: '', e2ee_key: 'K', updated_at: 100 })

    const first = (await tool(env, 'list_documents')).structuredContent as { documents: { id: string }[]; vaultSkipped: number; nextOffset?: number }
    expect(first.documents).toHaveLength(200)
    expect(first.nextOffset).toBe(200)
    expect(first.vaultSkipped).toBe(1)

    const second = (await tool(env, 'list_documents', { offset: 200 })).structuredContent as { documents: { id: string }[]; nextOffset?: number }
    expect(second.documents.map((d) => d.id)).toEqual([uuid(1)])
    expect('nextOffset' in second).toBe(false)
    expect((await tool(env, 'list_documents', { offset: -1 })).isError).toBe(true)
  })

  it('M6 list_folders 는 금고 폴더를 빼고 세고, list_shared 는 role·ownerEmail·sharedFolder 를 준다', async () => {
    const { sqlDb, env, owner } = await setup()
    insertFolder(sqlDb, uuid(10), owner, { name: '위' })
    insertFolder(sqlDb, uuid(11), owner, { parentId: uuid(10), name: '아래' })
    insertFolder(sqlDb, uuid(12), owner, { e2ee: 1, name: 'vault' })
    insertFolder(sqlDb, uuid(13), 'other', { name: 'Team' })
    const folders = (await tool(env, 'list_folders')).structuredContent as { folders: unknown[]; vaultSkipped: number }
    expect(folders.vaultSkipped).toBe(1)
    expect(folders.folders).toHaveLength(2)
    expect(folders.folders).toEqual(
      expect.arrayContaining([
        { id: uuid(10), name: '위', parentId: null },
        { id: uuid(11), name: '아래', parentId: uuid(10) },
      ]),
    )

    insertDoc(sqlDb, uuid(1), 'other', { title: '문서 초대', updated_at: 9 })
    grant(sqlDb, 'doc', uuid(1), 'edit')
    insertDoc(sqlDb, uuid(2), 'other', { title: '폴더 안', folder_id: uuid(13), updated_at: 8 })
    insertDoc(sqlDb, uuid(3), 'other', { title: '', folder_id: uuid(13), e2ee_key: 'K', updated_at: 7 })
    grant(sqlDb, 'folder', uuid(13), 'view')
    const shared = (await tool(env, 'list_shared')).structuredContent as { documents: unknown[]; vaultSkipped: number }
    expect(shared).toEqual({
      documents: [
        { id: uuid(1), title: '문서 초대', role: 'edit', ownerEmail: OTHER_EMAIL, sharedFolder: null, updatedAt: 9, url: docUrl(uuid(1)) },
        { id: uuid(2), title: '폴더 안', role: 'view', ownerEmail: OTHER_EMAIL, sharedFolder: 'Team', updatedAt: 8, url: docUrl(uuid(2)) },
      ],
      // handleGetShared 가 금고 문서를 SQL 에서 빼므로 남의 금고 문서는 셀 수도 없다 (보고 참조)
      vaultSkipped: 0,
    })
  })

  it('M7 읽기 도구 다섯을 다 불러도 하루 쓰기 수는 그대로', async () => {
    const { sqlDb, env, owner } = await setup()
    insertDoc(sqlDb, uuid(1), owner, { content: 'needle' })
    const before = await readUsage(env, owner)
    await tool(env, 'search', { query: 'needle' })
    await tool(env, 'fetch', { id: uuid(1) })
    await tool(env, 'list_documents')
    await tool(env, 'list_folders')
    await tool(env, 'list_shared')
    expect(await readUsage(env, owner)).toEqual(before)
  })

  it('M8 핸들러가 던진 예외 글은 밖으로 나가지 않는다', async () => {
    const { env } = await setup()
    const db = env.DB
    const throwing = {
      ...env,
      DB: new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== 'prepare') return Reflect.get(target, prop, receiver) as unknown
          return (sql: string) => {
            if (sql === 'SELECT * FROM folders WHERE owner_id = ?') throw new Error('secret')
            return target.prepare(sql)
          }
        },
      }),
    } as Env
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { message, raw } = await rpc(throwing, 'tools/call', { name: 'list_folders', arguments: {} })
      expect(errorMessage(message.result as ToolResult)).toBe('Internal error. Try again later.')
      expect(raw).not.toContain('secret')
      expect(consoleError).toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })
})
