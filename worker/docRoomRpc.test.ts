// 다른 핸들러가 DocRoom 에 알리는 도우미와 그 배선 (specs/features/F-304.md 9.3·9.4, A23·A24)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./docRoomRpc', () => ({
  notifyRevalidate: vi.fn(async () => {}),
  notifyPurge: vi.fn(async () => {}),
  writeTextInRoom: vi.fn(async () => null),
}))
vi.mock('./auth', () => ({
  requireUser: vi.fn(async () => ({ id: 'me', email: 'me@example.com' })),
}))

import * as rpc from './docRoomRpc'
import { handleDeleteDocGrant, handleDeleteFolderGrant, handlePutDocGrant } from './grants'
import { handleDeleteDoc } from './docs'
import { handleDeleteFolder } from './folders'
import { asD1, openTestDb } from './testD1'
import type { DatabaseSync } from 'node:sqlite'

const { notifyPurge, notifyRevalidate, writeTextInRoom } = await vi.importActual<typeof import('./docRoomRpc')>('./docRoomRpc')

const DOC_ID = '33333333-3333-4333-8333-333333333333'

function stubEnv(stub: { revalidateConnections?: (email?: string) => Promise<void>; purgeRoom?: () => Promise<void>; writeText?: (input: unknown) => Promise<unknown> }) {
  const getByName = vi.fn(() => stub)
  return { env: { DOC_ROOM: { getByName } } as unknown as Env, getByName }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('F-304 A23 notifyRevalidate·notifyPurge', () => {
  it('env.DOC_ROOM 이 없으면 던지지 않고 끝난다', async () => {
    await expect(notifyRevalidate({} as Env, undefined, DOC_ID, 'a@example.com')).resolves.toBeUndefined()
    await expect(notifyPurge({} as Env, undefined, DOC_ID)).resolves.toBeUndefined()
  })

  it('ctx.waitUntil 이 함수면 그 약속을 넘긴다', async () => {
    let release!: () => void
    const pending = new Promise<void>((r) => (release = r))
    const revalidateConnections = vi.fn(() => pending)
    const { env, getByName } = stubEnv({ revalidateConnections })
    const waitUntil = vi.fn()
    await notifyRevalidate(env, { waitUntil } as unknown as ExecutionContext, DOC_ID, 'a@example.com')
    expect(getByName).toHaveBeenCalledWith(DOC_ID)
    expect(revalidateConnections).toHaveBeenCalledWith('a@example.com')
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise)
    release()
    await waitUntil.mock.calls[0][0]
  })

  it('waitUntil 이 없으면 기다린다', async () => {
    let done = false
    const purgeRoom = vi.fn(async () => {
      await Promise.resolve()
      done = true
    })
    const { env } = stubEnv({ purgeRoom })
    await notifyPurge(env, {} as ExecutionContext, DOC_ID)
    expect(purgeRoom).toHaveBeenCalledTimes(1)
    expect(done).toBe(true)
  })

  it('스텁이 던지면 console.error 1번, 던지지 않는다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env } = stubEnv({
      purgeRoom: vi.fn(async () => {
        throw new Error('aborted')
      }),
    })
    await expect(notifyPurge(env, undefined, DOC_ID)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)

    const sync = stubEnv({
      revalidateConnections: vi.fn(() => {
        throw new Error('sync throw')
      }),
    })
    await expect(notifyRevalidate(sync.env, undefined, DOC_ID, 'a@example.com')).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(2)
  })

  it('waitUntil 에 넘긴 약속도 실패를 삼킨다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env } = stubEnv({
      purgeRoom: vi.fn(async () => {
        throw new Error('aborted')
      }),
    })
    const waitUntil = vi.fn()
    await notifyPurge(env, { waitUntil } as unknown as ExecutionContext, DOC_ID)
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledTimes(1)
  })
})

describe('F-304 A24 배선', () => {
  const FOLDER_ID = '44444444-4444-4444-8444-444444444444'
  const EMAIL = 'friend@example.com'

  function makeEnv(order: string[]) {
    const DB = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first<T>() {
                if (sql.startsWith('SELECT id, owner_id, folder_id, e2ee_key FROM docs WHERE id = ?') || sql.startsWith('SELECT * FROM docs WHERE id = ?')) {
                  return (args[0] === DOC_ID ? { id: DOC_ID, owner_id: 'me', folder_id: null, e2ee_key: null } : null) as T | null
                }
                if (sql.startsWith('SELECT id, owner_id, e2ee FROM folders WHERE id = ?')) {
                  return (args[0] === FOLDER_ID ? { id: FOLDER_ID, owner_id: 'me', e2ee: 0 } : null) as T | null
                }
                if (sql.startsWith('SELECT write_day')) return null
                throw new Error(`unhandled first sql: ${sql}`)
              },
              async run() {
                if (sql.startsWith('INSERT INTO grants') || sql.startsWith('DELETE FROM grants')) return { meta: { changes: 1 } }
                if (sql.startsWith('DELETE FROM share_link_docs')) return { meta: { changes: 0 } }
                // F-502 8.1 — 댓글 행·알림 지우기
                if (sql.startsWith('DELETE FROM doc_comments') || sql.startsWith('DELETE FROM notifications')) return { meta: { changes: 0 } }
                if (sql.startsWith('DELETE FROM docs')) {
                  order.push('delete-docs')
                  return { meta: { changes: 1 } }
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

  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext

  function putRole(role: 'view' | 'edit') {
    return new Request(`https://x/api/docs/${DOC_ID}/grants/${EMAIL}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
  }

  beforeEach(() => {
    vi.mocked(rpc.notifyRevalidate).mockClear()
    vi.mocked(rpc.notifyPurge).mockClear()
  })

  it('문서 초대 삭제 → notifyRevalidate(…, docId, email) 1번, 204', async () => {
    const env = makeEnv([])
    const res = await handleDeleteDocGrant(new Request('https://x', { method: 'DELETE' }), env, ctx, { id: DOC_ID, email: EMAIL })
    expect(res.status).toBe(204)
    expect(rpc.notifyRevalidate).toHaveBeenCalledTimes(1)
    expect(rpc.notifyRevalidate).toHaveBeenCalledWith(env, ctx, DOC_ID, EMAIL)
  })

  it('문서 초대 view PUT → 1번, edit PUT → 0번', async () => {
    const env = makeEnv([])
    const view = await handlePutDocGrant(putRole('view'), env, ctx, { id: DOC_ID, email: EMAIL })
    expect(view.status).toBe(200)
    expect(rpc.notifyRevalidate).toHaveBeenCalledTimes(1)
    expect(rpc.notifyRevalidate).toHaveBeenCalledWith(env, ctx, DOC_ID, EMAIL)

    const edit = await handlePutDocGrant(putRole('edit'), env, ctx, { id: DOC_ID, email: EMAIL })
    expect(edit.status).toBe(200)
    expect(rpc.notifyRevalidate).toHaveBeenCalledTimes(1)
  })

  it('폴더 초대 삭제 → 0번', async () => {
    const env = makeEnv([])
    const res = await handleDeleteFolderGrant(new Request('https://x', { method: 'DELETE' }), env, ctx, { id: FOLDER_ID, email: EMAIL })
    expect(res.status).toBe(204)
    expect(rpc.notifyRevalidate).not.toHaveBeenCalled()
  })

  it('문서 삭제 → DELETE FROM docs 뒤 notifyPurge(…, docId) 1번, 204', async () => {
    const order: string[] = []
    const env = makeEnv(order)
    vi.mocked(rpc.notifyPurge).mockImplementation(async () => {
      order.push('purge')
    })
    const res = await handleDeleteDoc(new Request('https://x', { method: 'DELETE' }), env, ctx, { id: DOC_ID })
    expect(res.status).toBe(204)
    expect(rpc.notifyPurge).toHaveBeenCalledTimes(1)
    expect(rpc.notifyPurge).toHaveBeenCalledWith(env, ctx, DOC_ID)
    expect(order).toEqual(['delete-docs', 'purge'])
  })
})

// 버그 수정(명세 없음) — 폴더 `전부 삭제` 는 지운 문서들의 DO 방을 비우지 않았다(notifyPurge 없음, F-2038.md 12장 X2).
// 문서 단건 삭제가 하는 것과 같게, 지운 문서마다 notifyPurge 를 부른다
describe('버그 수정 X2 — 폴더 전부 삭제 notifyPurge 배선', () => {
  const ctx = { waitUntil: () => {} } as unknown as ExecutionContext

  function setup() {
    const sqlDb = openTestDb()
    const env = { DB: asD1(sqlDb) } as unknown as Env
    return { sqlDb, env }
  }
  function insertUser(sqlDb: DatabaseSync, id: string, email: string) {
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
  }
  function insertFolder(sqlDb: DatabaseSync, id: string, ownerId: string) {
    sqlDb
      .prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at, e2ee) VALUES (?,?,?,?,?,?,0)')
      .run(id, ownerId, id, null, 1, 1)
  }
  function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, folderId: string | null) {
    sqlDb
      .prepare(
        'INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(id, ownerId, 't', 'c', 'lf', folderId, 1, 1, 1)
  }

  beforeEach(() => {
    vi.mocked(rpc.notifyPurge).mockClear()
  })

  it('폴더 전부 삭제 → 지운 문서마다 notifyPurge(env, ctx, docId) 1번씩, 204', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'me', 'me@example.com')
    insertFolder(sqlDb, 'f1', 'me')
    insertDoc(sqlDb, 'd1', 'me', 'f1')
    insertDoc(sqlDb, 'd2', 'me', 'f1')
    insertDoc(sqlDb, 'd3', 'me', null) // 폴더 밖 — 지워지지 않는다

    const res = await handleDeleteFolder(
      new Request('https://x/api/folders/f1?contents=delete-all', { method: 'DELETE' }),
      env,
      ctx,
      { id: 'f1' },
    )
    expect(res.status).toBe(204)
    expect(rpc.notifyPurge).toHaveBeenCalledTimes(2)
    const purgedIds = vi.mocked(rpc.notifyPurge).mock.calls.map((call) => call[2]).sort()
    expect(purgedIds).toEqual(['d1', 'd2'])
    expect(sqlDb.prepare('SELECT id FROM docs WHERE id = ?').get('d3')).toBeTruthy()
  })
})

describe('F-308 A23 writeTextInRoom', () => {
  const input = { content: 'x', baseVersion: 1, docVersion: 1 }

  it('env.DOC_ROOM 이 없으면 null', async () => {
    await expect(writeTextInRoom({} as Env, DOC_ID, input)).resolves.toBeNull()
  })

  it('스텁 결과를 그대로 돌려주고 getByName(docId) 1번', async () => {
    const result = { type: 'ok', doc: { title: 't', content: 'x', version: 2, updatedAt: null } }
    const writeText = vi.fn(async () => result)
    const { env, getByName } = stubEnv({ writeText })
    await expect(writeTextInRoom(env, DOC_ID, input)).resolves.toBe(result)
    expect(getByName).toHaveBeenCalledTimes(1)
    expect(getByName).toHaveBeenCalledWith(DOC_ID)
    expect(writeText).toHaveBeenCalledWith(input)
  })

  it('스텁이 던지면(비동기·동기) console.error 1번씩, null', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { env } = stubEnv({
      writeText: vi.fn(async () => {
        throw new Error('DO down')
      }),
    })
    await expect(writeTextInRoom(env, DOC_ID, input)).resolves.toBeNull()
    expect(error).toHaveBeenCalledTimes(1)
    const sync = stubEnv({
      writeText: vi.fn(() => {
        throw new Error('sync throw')
      }),
    })
    await expect(writeTextInRoom(sync.env, DOC_ID, input)).resolves.toBeNull()
    expect(error).toHaveBeenCalledTimes(2)
  })
})
