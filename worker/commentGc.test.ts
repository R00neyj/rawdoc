// 매일 Cron 댓글·알림 정리 (specs/features/F-502.md 10장, 13.5 K1~K4)
import { describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { asD1, openTestDb } from './testD1'
import { OVERFLOW_SQL, cleanupComments } from './commentGc'
import { NOTIFICATIONS_PER_RECIPIENT_MAX } from '../src/lib/docComments'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('./docRoom', () => ({ DocRoom: class {} }))

const DAY = 24 * 60 * 60 * 1000
const NOW = 200 * DAY

function setup() {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u1', 'u1@example.com', 1)
  doc(sqlDb, 'live', null)
  doc(sqlDb, 'vault', 'KEY')
  return { sqlDb, env: { DB: asD1(sqlDb) } as unknown as Env }
}

function doc(sqlDb: DatabaseSync, id: string, e2eeKey: string | null) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, 'u1', 't', '', 'lf', 1, 1, 1, e2eeKey)
}

function comment(sqlDb: DatabaseSync, docId: string, id: string) {
  sqlDb
    .prepare("INSERT INTO doc_comments (doc_id, id, body, created_at, bytes, sig, anchor_sig) VALUES (?, ?, 'b', 1, 1, 's', 'a')")
    .run(docId, id)
}

function note(sqlDb: DatabaseSync, id: string, recipient: string, docId: string, createdAt: number) {
  sqlDb
    .prepare(
      "INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES (?, ?, 'mention', ?, ?, ?, 'x@example.com', 't', 'e', ?)",
    )
    .run(id, recipient, docId, id, id, createdAt)
}

const ids = (sqlDb: DatabaseSync, sql: string) => (sqlDb.prepare(sql).all() as { id: string }[]).map((r) => r.id).sort()

describe('F-502 K1 90일', () => {
  it('91일 된 알림은 지우고 89일은 남긴다', async () => {
    const { sqlDb, env } = setup()
    note(sqlDb, 'old', 'a@example.com', 'live', NOW - 91 * DAY)
    note(sqlDb, 'young', 'a@example.com', 'live', NOW - 89 * DAY)
    const result = await cleanupComments(env, NOW)
    expect(ids(sqlDb, 'SELECT id FROM notifications')).toEqual(['young'])
    expect(result.oldNotifications).toBe(1)
  })
})

describe('F-502 K2 받는 사람별 300개', () => {
  it('A 305 → 새것 300, B 5 그대로', async () => {
    const { sqlDb, env } = setup()
    for (let i = 0; i < 305; i++) note(sqlDb, `a${String(i).padStart(3, '0')}`, 'a@example.com', 'live', NOW - 1000 + i)
    for (let i = 0; i < 5; i++) note(sqlDb, `b${i}`, 'b@example.com', 'live', NOW - 5000 + i)
    const result = await cleanupComments(env, NOW)
    const a = ids(sqlDb, "SELECT id FROM notifications WHERE recipient_email = 'a@example.com'")
    expect(a).toHaveLength(300)
    expect(a[0]).toBe('a005')
    expect(ids(sqlDb, "SELECT id FROM notifications WHERE recipient_email = 'b@example.com'")).toHaveLength(5)
    expect(result.overflowNotifications).toBe(5)
  })
})

describe('F-502 K3 없는 문서·금고 문서', () => {
  it('댓글 행과 알림을 지우고 있는 문서 것은 남긴다', async () => {
    const { sqlDb, env } = setup()
    comment(sqlDb, 'live', 'c1')
    comment(sqlDb, 'vault', 'c2')
    comment(sqlDb, 'gone', 'c3')
    note(sqlDb, 'n1', 'a@example.com', 'live', NOW)
    note(sqlDb, 'n2', 'a@example.com', 'vault', NOW)
    note(sqlDb, 'n3', 'a@example.com', 'gone', NOW)
    const result = await cleanupComments(env, NOW)
    expect(ids(sqlDb, 'SELECT id FROM doc_comments')).toEqual(['c1'])
    expect(ids(sqlDb, 'SELECT id FROM notifications')).toEqual(['n1'])
    expect(result).toEqual({ orphanRows: 2, oldNotifications: 0, orphanNotifications: 2, overflowNotifications: 0 })
  })
})

describe('F-502 K4 scheduled', () => {
  it('waitUntil 3개, prepare 가 던져도 삼킨다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
    const DB = {
      prepare() {
        throw new Error('db down')
      },
    }
    const worker = (await import('./index')).default as unknown as {
      scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>
    }
    await worker.scheduled({} as ScheduledController, { DB } as unknown as Env, ctx)
    expect(pending.length).toBe(3)
    await expect(Promise.all(pending)).resolves.toBeDefined()
    vi.restoreAllMocks()
  })
})

describe('F-2057 U9 알림 리비전', () => {
  it('91일 된 알림·고아 알림의 받는 사람 +1, 89일만 가진 사람 그대로, 돌려주는 객체는 같다', async () => {
    const { sqlDb, env } = setup()
    for (const [id, email] of [['a', 'a@example.com'], ['b', 'b@example.com'], ['c', 'c@example.com']]) {
      sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(id, email, 1)
    }
    note(sqlDb, 'old', 'a@example.com', 'live', NOW - 91 * DAY)
    note(sqlDb, 'orphan', 'b@example.com', 'gone', NOW)
    note(sqlDb, 'young', 'c@example.com', 'live', NOW - 89 * DAY)
    const result = await cleanupComments(env, NOW)
    expect(result).toEqual({ orphanRows: 0, oldNotifications: 1, orphanNotifications: 1, overflowNotifications: 0 })
    const revs = sqlDb.prepare('SELECT email, notif_rev FROM users ORDER BY email').all() as { email: string; notif_rev: number }[]
    expect(Object.fromEntries(revs.map((r) => [r.email, r.notif_rev]))).toEqual({
      'a@example.com': 1,
      'b@example.com': 1,
      'c@example.com': 0,
      'u1@example.com': 0,
    })
  })
})

// 기준: created_at 내림·id 내림(BINARY) 앞 300개
function top300(rows: readonly { id: string; created_at: number }[]): string[] {
  return [...rows]
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, NOTIFICATIONS_PER_RECIPIENT_MAX)
    .map((r) => r.id)
    .sort()
}

const rowsOf = (sqlDb: DatabaseSync, recipient: string) =>
  sqlDb.prepare('SELECT id, created_at FROM notifications WHERE recipient_email = ?').all(recipient) as { id: string; created_at: number }[]

describe('F-2075 A2 매일 정리 — 결과 동일', () => {
  it('A 305(동점)·B 300·C 1,000·D 5 → A·C 기준 300개, B·D 그대로, 705', async () => {
    const { sqlDb, env } = setup()
    const mixed = (tag: string, i: number) => `${String((i * 7919) % 100_003).padStart(6, '0')}-${tag}-${i}`
    for (let i = 0; i < 305; i++) note(sqlDb, mixed('a', i), 'a@x', 'live', NOW - 10_000 + Math.floor(i / 7))
    for (let i = 0; i < 300; i++) note(sqlDb, mixed('b', i), 'b@x', 'live', NOW - 10_000 + i)
    for (let i = 0; i < 1000; i++) note(sqlDb, mixed('c', i), 'c@x', 'live', NOW - 10_000 + Math.floor(i / 3))
    for (let i = 0; i < 5; i++) note(sqlDb, mixed('d', i), 'd@x', 'live', NOW - 10_000)
    const expectedA = top300(rowsOf(sqlDb, 'a@x'))
    const expectedC = top300(rowsOf(sqlDb, 'c@x'))
    const result = await cleanupComments(env, NOW)
    expect(ids(sqlDb, "SELECT id FROM notifications WHERE recipient_email = 'a@x'")).toEqual(expectedA)
    expect(ids(sqlDb, "SELECT id FROM notifications WHERE recipient_email = 'c@x'")).toEqual(expectedC)
    expect(ids(sqlDb, "SELECT id FROM notifications WHERE recipient_email = 'b@x'")).toHaveLength(300)
    expect(ids(sqlDb, "SELECT id FROM notifications WHERE recipient_email = 'd@x'")).toHaveLength(5)
    expect(result.overflowNotifications).toBe(705)
  })
})

describe('F-2075 A5 매일 정리 문장 계획', () => {
  it('MATERIALIZE cut·새 색인, 상관 부질의·임시 B-트리 없음', () => {
    const { sqlDb } = setup()
    const detail = (sqlDb.prepare('EXPLAIN QUERY PLAN ' + OVERFLOW_SQL).all() as { detail: string }[]).map((r) => r.detail).join('\n')
    expect(detail).toContain('MATERIALIZE cut')
    expect(detail).toContain('notifications_recipient_order')
    expect(detail).not.toContain('CORRELATED LIST SUBQUERY')
    expect(detail).not.toContain('USE TEMP B-TREE')
  })
})
