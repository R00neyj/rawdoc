// /api 문서 만들기·PUT 총량 413, 사용량 줄 (specs/features/F-2025.md 8.1 D1~D8)
import { describe, expect, it, vi } from 'vitest'

vi.mock('./auth', () => ({
  requireUser: vi.fn(async (request: Request) => {
    const id = request.headers.get('x-test-user') ?? 'u1'
    return { id, email: `${id}@example.com` }
  }),
}))

import { handleCreateDoc, handleDeleteDoc, handleUpdateDoc } from './docs'
import { handleDeleteFolder } from './folders'
import { asD1, openTestDb } from './testD1'
import { DOC_BYTES_QUOTA, DOC_COUNT_QUOTA, utf8Bytes } from './usage'
import type { DatabaseSync } from 'node:sqlite'

function setup() {
  const sqlDb = openTestDb()
  const env = { DB: asD1(sqlDb) } as unknown as Env
  return { sqlDb, env }
}

function insertUser(sqlDb: DatabaseSync, id: string, email: string) {
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
}

function setUserUsage(sqlDb: DatabaseSync, id: string, patch: { contentBytes?: number; docCount?: number }) {
  if (patch.contentBytes !== undefined) {
    sqlDb.prepare('UPDATE users SET content_bytes = ? WHERE id = ?').run(patch.contentBytes, id)
  }
  if (patch.docCount !== undefined) {
    sqlDb.prepare('UPDATE users SET doc_count = ? WHERE id = ?').run(patch.docCount, id)
  }
}

function getUserRow(sqlDb: DatabaseSync, id: string) {
  return sqlDb
    .prepare('SELECT content_bytes, doc_count, write_count FROM users WHERE id = ?')
    .get(id) as { content_bytes: number; doc_count: number; write_count: number }
}

function insertDoc(sqlDb: DatabaseSync, doc: { id: string; ownerId: string; content: string; version?: number }) {
  sqlDb
    .prepare(
      'INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(doc.id, doc.ownerId, 't', doc.content, 'lf', doc.version ?? 1, 1, 1)
}

function getDocRow(sqlDb: DatabaseSync, id: string) {
  return sqlDb.prepare('SELECT content, version FROM docs WHERE id = ?').get(id) as { content: string; version: number }
}

function countDocs(sqlDb: DatabaseSync) {
  return (sqlDb.prepare('SELECT COUNT(*) as n FROM docs').get() as { n: number }).n
}

function insertGrant(
  sqlDb: DatabaseSync,
  grant: { targetType: 'doc' | 'folder'; targetId: string; ownerId: string; granteeEmail: string; role: 'view' | 'edit' },
) {
  sqlDb
    .prepare('INSERT INTO grants (target_type, target_id, owner_id, grantee_email, role, created_at) VALUES (?,?,?,?,?,?)')
    .run(grant.targetType, grant.targetId, grant.ownerId, grant.granteeEmail, grant.role, 1)
}

function req(method: string, path: string, body?: unknown, userId = 'u1'): Request {
  const init: RequestInit = { method, headers: { 'x-test-user': userId } }
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  return new Request(`http://local.test${path}`, init)
}

const ctx = {} as ExecutionContext

describe('F-2025 D1~D8 /api 문서 만들기·PUT 총량', () => {
  it('D1 만들기 성공 → 201, doc_count +1, content_bytes + 본문 바이트, write_count +1', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    const res = await handleCreateDoc(req('POST', '/api/docs', { title: 't', content: 'hello', lineEnding: 'lf' }), env)
    expect(res.status).toBe(201)
    const u1 = getUserRow(sqlDb, 'u1')
    expect(u1.doc_count).toBe(1)
    expect(u1.content_bytes).toBe(utf8Bytes('hello'))
    expect(u1.write_count).toBe(1)
  })

  it('D2 doc_count 10,000 에서 만들기 → 413 docs, 행 수·write_count 그대로', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    setUserUsage(sqlDb, 'u1', { docCount: DOC_COUNT_QUOTA })
    const before = countDocs(sqlDb)
    const res = await handleCreateDoc(req('POST', '/api/docs', { title: 't', content: 'c', lineEnding: 'lf' }), env)
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'doc_quota_exceeded', resource: 'docs', used: DOC_COUNT_QUOTA, limit: DOC_COUNT_QUOTA })
    expect(countDocs(sqlDb)).toBe(before)
    expect(getUserRow(sqlDb, 'u1').write_count).toBe(0)
  })

  it('D3 content_bytes = 한도 - 5 에서 6바이트면 413, 5바이트면 201', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    setUserUsage(sqlDb, 'u1', { contentBytes: DOC_BYTES_QUOTA - 5 })

    const over = await handleCreateDoc(req('POST', '/api/docs', { title: 't', content: 'abcdef', lineEnding: 'lf' }), env)
    expect(over.status).toBe(413)
    expect(await over.json()).toEqual({
      error: 'doc_quota_exceeded',
      resource: 'bytes',
      used: DOC_BYTES_QUOTA - 5,
      limit: DOC_BYTES_QUOTA,
    })

    const ok = await handleCreateDoc(req('POST', '/api/docs', { title: 't2', content: 'abcde', lineEnding: 'lf' }), env)
    expect(ok.status).toBe(201)
  })

  it('D4 doc_count 10,000 이어도 이미 있는 내 id 로 만들면 200, write_count 그대로', async () => {
    const { sqlDb, env } = setup()
    const docUuid = '00000000-0000-4000-8000-000000000001'
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertDoc(sqlDb, { id: docUuid, ownerId: 'u1', content: 'x' })
    setUserUsage(sqlDb, 'u1', { docCount: DOC_COUNT_QUOTA })
    const res = await handleCreateDoc(
      req('POST', '/api/docs', { id: docUuid, title: 't', content: 'x', lineEnding: 'lf' }),
      env,
    )
    expect(res.status).toBe(200)
    expect(getUserRow(sqlDb, 'u1').write_count).toBe(0)
  })

  it('D5 한도 - 1 에서 2바이트 늘리는 PUT 은 413, 1바이트 줄이는 PUT 은 200', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertDoc(sqlDb, { id: 'd1', ownerId: 'u1', content: 'ab', version: 1 })
    setUserUsage(sqlDb, 'u1', { contentBytes: DOC_BYTES_QUOTA - 1 })

    const over = await handleUpdateDoc(req('PUT', '/api/docs/d1', { content: 'abcd', baseVersion: 1 }), env, ctx, { id: 'd1' })
    expect(over.status).toBe(413)
    const doc = getDocRow(sqlDb, 'd1')
    expect(doc.content).toBe('ab')
    expect(doc.version).toBe(1)

    const shrink = await handleUpdateDoc(req('PUT', '/api/docs/d1', { content: 'a', baseVersion: 1 }), env, ctx, { id: 'd1' })
    expect(shrink.status).toBe(200)
    expect(getUserRow(sqlDb, 'u1').content_bytes).toBe(DOC_BYTES_QUOTA - 1 - 1)
  })

  it('D6 누계가 한도 + 100 이어도 제목만 PUT·줄이는 PUT 은 200', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertDoc(sqlDb, { id: 'd1', ownerId: 'u1', content: 'abc', version: 1 })
    setUserUsage(sqlDb, 'u1', { contentBytes: DOC_BYTES_QUOTA + 100 })

    const titleOnly = await handleUpdateDoc(req('PUT', '/api/docs/d1', { title: 'new', baseVersion: 1 }), env, ctx, { id: 'd1' })
    expect(titleOnly.status).toBe(200)

    const shrink = await handleUpdateDoc(req('PUT', '/api/docs/d1', { content: 'a', baseVersion: 2 }), env, ctx, { id: 'd1' })
    expect(shrink.status).toBe(200)
  })

  it('D7 편집 권한자 PUT — 소유자가 한도에 닿으면 413, 여유 있으면 200 (소유자 누계, 보낸 사람 write_count)', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertUser(sqlDb, 'u2', 'u2@example.com')
    insertDoc(sqlDb, { id: 'd1', ownerId: 'u1', content: 'ab', version: 1 })
    insertGrant(sqlDb, { targetType: 'doc', targetId: 'd1', ownerId: 'u1', granteeEmail: 'u2@example.com', role: 'edit' })
    setUserUsage(sqlDb, 'u1', { contentBytes: DOC_BYTES_QUOTA - 1 })

    const over = await handleUpdateDoc(req('PUT', '/api/docs/d1', { content: 'abcd', baseVersion: 1 }, 'u2'), env, ctx, { id: 'd1' })
    expect(over.status).toBe(413)
    const body = (await over.json()) as { used: number }
    expect(body.used).toBe(DOC_BYTES_QUOTA - 1)

    setUserUsage(sqlDb, 'u1', { contentBytes: 100 })
    const ok = await handleUpdateDoc(req('PUT', '/api/docs/d1', { content: 'abcd', baseVersion: 1 }, 'u2'), env, ctx, { id: 'd1' })
    expect(ok.status).toBe(200)
    const owner = getUserRow(sqlDb, 'u1')
    expect(owner.content_bytes).toBe(100 + 2)
    expect(owner.write_count).toBe(0)
    const actor = getUserRow(sqlDb, 'u2')
    expect(actor.write_count).toBe(1)
  })

  it('D8 삭제 → 204, 누계에서 빠진다. 버전 틀린 PUT → 409, write_count 그대로(사전 검사)', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertDoc(sqlDb, { id: 'd1', ownerId: 'u1', content: 'abc', version: 5 })
    setUserUsage(sqlDb, 'u1', { contentBytes: 100, docCount: 3 })

    const conflict = await handleUpdateDoc(req('PUT', '/api/docs/d1', { content: 'x', baseVersion: 1 }), env, ctx, { id: 'd1' })
    expect(conflict.status).toBe(409)
    expect(getUserRow(sqlDb, 'u1').write_count).toBe(0)

    const del = await handleDeleteDoc(req('DELETE', '/api/docs/d1'), env, ctx, { id: 'd1' })
    expect(del.status).toBe(204)
    const owner = getUserRow(sqlDb, 'u1')
    expect(owner.content_bytes).toBe(100 - utf8Bytes('abc'))
    expect(owner.doc_count).toBe(2)
  })
})

// 버그 수정(명세 없음) — share_link_docs.doc_id REFERENCES docs(id) 인데 handleDeleteDoc 이 그 행을 먼저 지우지 않아
// D1(외래 키 강제)에서 FK 오류가 날 것으로 보임(F-2038.md 12장 X1). node:sqlite 도 기본 foreign_keys = 1
describe('버그 수정 — 공유 링크 묶음에 든 문서 삭제', () => {
  function insertShareLink(sqlDb: DatabaseSync, token: string, ownerId: string, targetId: string) {
    sqlDb
      .prepare('INSERT INTO share_links (token, owner_id, target_type, target_id, created_at, revoked_at) VALUES (?,?,?,?,?,NULL)')
      .run(token, ownerId, 'doc', targetId, 1)
  }
  function insertShareLinkDoc(sqlDb: DatabaseSync, token: string, docId: string) {
    sqlDb.prepare('INSERT INTO share_link_docs (token, doc_id) VALUES (?,?)').run(token, docId)
  }

  it('묶음에 든 문서를 지워도 FK 오류 없이 204, share_link_docs 행도 사라진다', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertDoc(sqlDb, { id: 'd1', ownerId: 'u1', content: 'a' })
    insertDoc(sqlDb, { id: 'd2', ownerId: 'u1', content: 'b' })
    insertShareLink(sqlDb, 'tok1', 'u1', 'd1')
    insertShareLinkDoc(sqlDb, 'tok1', 'd2')

    const res = await handleDeleteDoc(req('DELETE', '/api/docs/d2'), env, ctx, { id: 'd2' })
    expect(res.status).toBe(204)
    expect(countDocs(sqlDb)).toBe(1)
    const bundleRow = sqlDb.prepare('SELECT * FROM share_link_docs WHERE doc_id = ?').get('d2')
    expect(bundleRow).toBeUndefined()
    // 링크 자체(시작 문서 d1)는 남아 있어야 한다 — 이 버그 수정의 규칙 밖
    const link = sqlDb.prepare('SELECT * FROM share_links WHERE token = ?').get('tok1')
    expect(link).toBeTruthy()
  })
})

// F-502 8.1·8.2 지우는 자리 — 댓글 행·알림·누계 (13.5 X1·X2)
describe('F-502 X1·X2 문서·폴더 삭제가 댓글 복사본을 지운다', () => {
  function insertComment(sqlDb: DatabaseSync, docId: string, id: string, bytes: number) {
    sqlDb
      .prepare("INSERT INTO doc_comments (doc_id, id, body, created_at, bytes, sig, anchor_sig) VALUES (?, ?, 'b', 1, ?, 's', 'a')")
      .run(docId, id, bytes)
  }
  function insertNotification(sqlDb: DatabaseSync, docId: string, commentId: string) {
    sqlDb
      .prepare(
        "INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES (?, 'x@example.com', 'mention', ?, ?, ?, 'y@example.com', 't', 'e', 1)",
      )
      .run(`${docId}-${commentId}`, docId, commentId, commentId)
  }
  function insertFolder(sqlDb: DatabaseSync, id: string, parentId: string | null) {
    sqlDb.prepare('INSERT INTO folders (id, owner_id, name, parent_id, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(id, 'u1', id, parentId, 1, 1)
  }
  const rows = (sqlDb: DatabaseSync, table: string, docId: string) =>
    (sqlDb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE doc_id = ?`).get(docId) as { n: number }).n

  it('X1 handleDeleteDoc — 204, 두 표에서 그 문서 행 0, content_bytes = 본문 + 댓글 바이트만큼 준다', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertDoc(sqlDb, { id: 'd1', ownerId: 'u1', content: '가나다' })
    insertDoc(sqlDb, { id: 'd2', ownerId: 'u1', content: 'x' })
    insertComment(sqlDb, 'd1', 'c1', 10)
    insertComment(sqlDb, 'd1', 'c2', 5)
    insertComment(sqlDb, 'd2', 'c3', 7)
    insertNotification(sqlDb, 'd1', 'c1')
    insertNotification(sqlDb, 'd2', 'c3')
    setUserUsage(sqlDb, 'u1', { contentBytes: 1000, docCount: 2 })

    const res = await handleDeleteDoc(req('DELETE', '/api/docs/d1'), env, ctx, { id: 'd1' })
    expect(res.status).toBe(204)
    expect(rows(sqlDb, 'doc_comments', 'd1')).toBe(0)
    expect(rows(sqlDb, 'notifications', 'd1')).toBe(0)
    expect(rows(sqlDb, 'doc_comments', 'd2')).toBe(1)
    expect(rows(sqlDb, 'notifications', 'd2')).toBe(1)
    expect(getUserRow(sqlDb, 'u1').content_bytes).toBe(1000 - utf8Bytes('가나다') - 15)
  })

  it('X2 handleDeleteFolder delete-all — 하위 폴더 문서의 댓글·알림 0, 폴더 밖 문서 것은 그대로, 누계 맞음', async () => {
    const { sqlDb, env } = setup()
    insertUser(sqlDb, 'u1', 'u1@example.com')
    insertFolder(sqlDb, 'top', null)
    insertFolder(sqlDb, 'sub', 'top')
    insertDoc(sqlDb, { id: 'd-top', ownerId: 'u1', content: 'ab' })
    insertDoc(sqlDb, { id: 'd-sub', ownerId: 'u1', content: 'cde' })
    insertDoc(sqlDb, { id: 'd-out', ownerId: 'u1', content: 'f' })
    sqlDb.prepare("UPDATE docs SET folder_id = 'top' WHERE id = 'd-top'").run()
    sqlDb.prepare("UPDATE docs SET folder_id = 'sub' WHERE id = 'd-sub'").run()
    insertComment(sqlDb, 'd-top', 'c1', 3)
    insertComment(sqlDb, 'd-sub', 'c2', 4)
    insertComment(sqlDb, 'd-out', 'c3', 9)
    insertNotification(sqlDb, 'd-sub', 'c2')
    insertNotification(sqlDb, 'd-out', 'c3')
    setUserUsage(sqlDb, 'u1', { contentBytes: 2 + 3 + 1 + 3 + 4 + 9, docCount: 3 })

    const res = await handleDeleteFolder(req('DELETE', '/api/folders/top?contents=delete-all'), env, ctx, { id: 'top' })
    expect(res.status).toBe(204)
    for (const id of ['d-top', 'd-sub']) {
      expect(rows(sqlDb, 'doc_comments', id)).toBe(0)
      expect(rows(sqlDb, 'notifications', id)).toBe(0)
    }
    expect(rows(sqlDb, 'doc_comments', 'd-out')).toBe(1)
    expect(rows(sqlDb, 'notifications', 'd-out')).toBe(1)
    expect(getUserRow(sqlDb, 'u1').content_bytes).toBe(1 + 9)
    expect(getUserRow(sqlDb, 'u1').doc_count).toBe(1)
  })
})
