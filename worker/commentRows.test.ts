// 댓글 D1 문장·행 왕복·알림 받는 사람·발췌 (specs/features/F-502.md 4장·5장·6장·8.4, 13.2 R1~R9)
import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'

import { asD1, openTestDb } from './testD1'
import {
  COMMENT_JSON_CHUNK_BYTES,
  accountCommentDeleteStatements,
  commentBundleStatements,
  notificationExcerpt,
  notificationStatements,
  notificationTargets,
  rowToCommentRecord,
  upsertCommentStatements,
} from './commentRows'
import type { CommentRow, DocCommentDbRow, NotificationDraft } from './commentRows'
import { groupCommentThreads, parseCommentRecords } from '../src/lib/docComments'
import type { CommentEntry, CommentRecord } from '../src/lib/docComments'

const DOC = 'doc-1'
const OWNER_ID = 'u1'
const utf8 = (s: string) => new TextEncoder().encode(s).length

function setup() {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(OWNER_ID, 'u1@example.com', 1)
  insertDoc(sqlDb, DOC, OWNER_ID)
  return { sqlDb, db: asD1(sqlDb) }
}

function insertDoc(sqlDb: DatabaseSync, id: string, ownerId: string, e2eeKey: string | null = null) {
  sqlDb
    .prepare('INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at, e2ee_key) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, ownerId, 't', '', 'lf', 1, 1, 1, e2eeKey)
}

function record(id: string, over: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id,
    parent: null,
    body: '본문',
    mentions: [],
    authorId: 'a1',
    authorEmail: 'a1@example.com',
    createdAt: 1,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: 'abc',
    prefix: '',
    suffix: '',
    anchorFrom: 0,
    anchorLength: 3,
    ...over,
  }
}

function row(id: string, over: Partial<CommentRecord> = {}): CommentRow {
  return { ...record(id, over), sig: 'sig-' + id, anchorSig: 'asig-' + id }
}

function draft(recipient: string, commentId: string, over: Partial<NotificationDraft> = {}): NotificationDraft {
  return { recipient, kind: 'mention', commentId, threadId: commentId, actor: 'a1@example.com', excerpt: 'x', ...over }
}

const all = <T,>(sqlDb: DatabaseSync, sql: string, ...args: string[]) => sqlDb.prepare(sql).all(...args) as T[]
const count = (sqlDb: DatabaseSync, sql: string, ...args: string[]) => (sqlDb.prepare(sql).get(...args) as { n: number }).n
const contentBytes = (sqlDb: DatabaseSync) => (sqlDb.prepare('SELECT content_bytes AS n FROM users WHERE id = ?').get(OWNER_ID) as { n: number }).n

describe('F-502 R1 upsert', () => {
  it('한 번 / 같은 값 다시 / body 바꿔 다시 — 행 수 같음, bytes 는 UTF-8 합', async () => {
    const { sqlDb, db } = setup()
    const r = row('c1', { body: '한글 body', quote: 'abc', prefix: '앞', suffix: '뒤쪽' })
    await db.batch(upsertCommentStatements(db, DOC, [r]))
    await db.batch(upsertCommentStatements(db, DOC, [r]))
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM doc_comments')).toBe(1)
    const first = all<DocCommentDbRow>(sqlDb, 'SELECT * FROM doc_comments')[0]
    expect(first.bytes).toBe(utf8('한글 body') + utf8('abc') + utf8('앞') + utf8('뒤쪽'))

    await db.batch(upsertCommentStatements(db, DOC, [{ ...r, body: '바뀐 본문', sig: 'sig2' }]))
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM doc_comments')).toBe(1)
    const next = all<DocCommentDbRow>(sqlDb, 'SELECT * FROM doc_comments')[0]
    expect(next.body).toBe('바뀐 본문')
    expect(next.sig).toBe('sig2')
    expect(next.bytes).toBe(utf8('바뀐 본문') + utf8('abc') + utf8('앞') + utf8('뒤쪽'))
  })
})

describe('F-502 R2 누계 빼기·더하기', () => {
  it('c1 + upsert + c7 을 두 번 돌려도 한 번 더한 값', async () => {
    const { sqlDb, db } = setup()
    const rows = [row('c1', { body: '가나다' }), row('c2', { body: 'hello' })]
    const p = { docId: DOC, ownerId: OWNER_ID, upserts: rows, deletes: [], drafts: [], docTitle: 't', now: 5 }
    await db.batch(commentBundleStatements(db, p))
    const once = contentBytes(sqlDb)
    expect(once).toBe(utf8('가나다') + utf8('hello') + 2 * utf8('abc'))
    await db.batch(commentBundleStatements(db, p))
    expect(contentBytes(sqlDb)).toBe(once)
  })
})

describe('F-502 R3 없는 문서·금고 문서', () => {
  it('upsert·알림 넣기 0행', async () => {
    const { sqlDb, db } = setup()
    insertDoc(sqlDb, 'vault', OWNER_ID, 'KEY')
    for (const docId of ['missing', 'vault']) {
      await db.batch(upsertCommentStatements(db, docId, [row('c1')]))
      await db.batch(notificationStatements(db, { docId, docTitle: 't', now: 1, drafts: [draft('b@example.com', 'c1')] }))
    }
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM doc_comments')).toBe(0)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM notifications')).toBe(0)
  })
})

describe('F-502 R4 알림 한 번', () => {
  it('같은 초안을 두 batch 로 (다른 id) → 1행', async () => {
    const { sqlDb, db } = setup()
    const d = draft('b@example.com', 'c1')
    await db.batch(notificationStatements(db, { docId: DOC, docTitle: 't', now: 1, drafts: [d] }))
    await db.batch(notificationStatements(db, { docId: DOC, docTitle: 't', now: 2, drafts: [d] }))
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM notifications')).toBe(1)
  })
})

describe('F-502 R5 받는 사람별 최근 300개', () => {
  it('305개 → 새것 300개, 다른 사람 행은 그대로', async () => {
    const { sqlDb, db } = setup()
    const insert = sqlDb.prepare(
      "INSERT INTO notifications (id, recipient_email, kind, doc_id, comment_id, thread_id, actor_email, doc_title, excerpt, created_at) VALUES (?, ?, 'mention', ?, ?, ?, 'x@example.com', 't', 'e', ?)",
    )
    for (let i = 0; i < 5; i++) insert.run(`other-${i}`, 'c@example.com', DOC, `o${i}`, `o${i}`, i)
    for (let i = 0; i < 304; i++) insert.run(`n-${String(i).padStart(3, '0')}`, 'b@example.com', DOC, `k${i}`, `k${i}`, 100 + i)
    await db.batch(notificationStatements(db, { docId: DOC, docTitle: 't', now: 10_000, drafts: [draft('b@example.com', 'last')] }))
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM notifications WHERE recipient_email = 'b@example.com'")).toBe(300)
    expect(count(sqlDb, "SELECT MIN(created_at) AS n FROM notifications WHERE recipient_email = 'b@example.com'")).toBe(105)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM notifications WHERE comment_id = 'last'")).toBe(1)
    expect(count(sqlDb, "SELECT COUNT(*) AS n FROM notifications WHERE recipient_email = 'c@example.com'")).toBe(5)
  })
})

function fullRow(i: number, ch: string): CommentRow {
  const id = String(i).padStart(64, '0')
  const email = (n: number) => 'm' + String(n).padStart(3, '0') + '.' + 'a'.repeat(236) + '@example.com'
  return {
    id,
    parent: null,
    body: ch.repeat(1_000),
    mentions: Array.from({ length: 10 }, (_, n) => email(n)),
    authorId: 'i'.repeat(128),
    authorEmail: 'e'.repeat(242) + '@example.com',
    createdAt: 1_790_000_000_000 + i,
    resolvedAt: 1_790_000_000_000,
    resolvedById: 'r'.repeat(128),
    resolvedBy: 'f'.repeat(242) + '@example.com',
    quote: ch.repeat(200),
    prefix: ch.repeat(32),
    suffix: ch.repeat(32),
    anchorFrom: 999_999,
    anchorLength: 999_999,
    sig: '0123456789abcdef',
    anchorSig: 'fedcba9876543210',
  }
}

describe('F-502 R6 JSON 나누기', () => {
  for (const [label, ch, statements] of [
    ['한글', '가', 4],
    ['제어 문자', '\u0001', 6],
  ] as const) {
    it(`${label} 행 500개 → ${statements}문장, 문장마다 ≤ 1,000,000 B, 모두 들어감`, async () => {
      const { sqlDb } = setup()
      const bound: string[] = []
      const inner = asD1(sqlDb)
      const spy = {
        prepare(sql: string) {
          const stmt = inner.prepare(sql)
          return {
            bind(...args: unknown[]) {
              for (const a of args) if (typeof a === 'string' && a.startsWith('[')) bound.push(a)
              return stmt.bind(...args)
            },
          }
        },
        batch: inner.batch.bind(inner),
      } as unknown as D1Database
      const rows = Array.from({ length: 500 }, (_, i) => fullRow(i, ch))
      const list = upsertCommentStatements(spy, DOC, rows)
      expect(list).toHaveLength(statements)
      expect(bound).toHaveLength(statements)
      for (const json of bound) expect(utf8(json)).toBeLessThanOrEqual(COMMENT_JSON_CHUNK_BYTES)
      await inner.batch(list)
      expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM doc_comments')).toBe(500)
    })
  }
})

describe('F-502 R7 행 ↔ 기록 왕복', () => {
  it('답글·자리 있음·고아 세 모양', async () => {
    const { sqlDb, db } = setup()
    const records: CommentRecord[] = [
      record('root', {
        body: '@b@example.com 봐 주세요',
        mentions: ['b@example.com'],
        quote: 'abc',
        prefix: '앞 글',
        suffix: '뒤',
        anchorFrom: 4,
        anchorLength: 3,
        resolvedAt: 9,
        resolvedById: 'r1',
        resolvedBy: 'r1@example.com',
      }),
      record('orphan', { quote: '사라진 곳', anchorFrom: null, anchorLength: null, createdAt: 2 }),
      record('re', { parent: 'root', quote: '', anchorFrom: null, anchorLength: null, createdAt: 3, authorId: null, authorEmail: null }),
    ]
    const parsed = parseCommentRecords(records)
    expect(parsed.ok).toBe(true)
    await db.batch(upsertCommentStatements(db, DOC, records.map((r) => ({ ...r, sig: 's', anchorSig: 'a' }))))
    const back = all<DocCommentDbRow>(sqlDb, 'SELECT * FROM doc_comments WHERE doc_id = ? ORDER BY created_at, id', DOC).map(rowToCommentRecord)
    const again = parseCommentRecords(back)
    expect(again.ok).toBe(true)
    expect(back).toEqual(records)
  })
})

function entry(author: string | null, over: Partial<CommentEntry> = {}): CommentEntry {
  return {
    v: 1,
    parent: null,
    anchor: null,
    quote: 'q',
    body: 'b',
    mentions: [],
    author: author === null ? { id: null, email: null } : { id: author, email: `${author}@example.com` },
    createdAt: 1,
    resolved: null,
    ...over,
  }
}

describe('F-502 R8 notificationTargets', () => {
  const people = new Set(['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'])

  it('멘션 — 집합 밖·자기 자신 빠짐, mentions 순서', () => {
    const e = entry('a', { body: '@z@example.com @a@example.com @c@example.com @b@example.com', mentions: ['z@example.com', 'a@example.com', 'c@example.com', 'b@example.com'] })
    const out = notificationTargets({ id: 'r', entry: e }, null, people)
    expect(out).toEqual([
      { recipient: 'c@example.com', kind: 'mention', commentId: 'r', threadId: 'r', actor: 'a@example.com', excerpt: e.body },
      { recipient: 'b@example.com', kind: 'mention', commentId: 'r', threadId: 'r', actor: 'a@example.com', excerpt: e.body },
    ])
  })

  it('답글 — 첫 댓글 작성자 + 앞선 답글 작성자, 뒤 답글·자기·접근 잃은 사람 빠짐, 멘션과 겹치면 mention 하나', () => {
    const items: [string, CommentEntry][] = [
      ['r', entry('b')],
      ['x1', entry('lost', { parent: 'r', quote: '', createdAt: 2 })],
      ['x2', entry('c', { parent: 'r', quote: '', createdAt: 3 })],
      ['x3', entry('a', { parent: 'r', quote: '', createdAt: 4 })],
      ['me', entry('d', { parent: 'r', quote: '', createdAt: 5, body: '@c@example.com 확인', mentions: ['c@example.com'] })],
      ['x5', entry('b', { parent: 'r', quote: '', createdAt: 6 })],
    ]
    const thread = groupCommentThreads(items).threads[0]
    const me = items[4][1]
    const out = notificationTargets({ id: 'me', entry: me }, thread, people)
    expect(out.map((d) => [d.recipient, d.kind])).toEqual([
      ['c@example.com', 'mention'],
      ['b@example.com', 'reply'],
      ['a@example.com', 'reply'],
    ])
    expect(out.every((d) => d.threadId === 'r' && d.commentId === 'me' && d.actor === 'd@example.com')).toBe(true)
  })

  it('작성자 이메일이 없으면 []', () => {
    expect(notificationTargets({ id: 'r', entry: entry(null) }, null, people)).toEqual([])
  })
})

describe('F-502 R9 notificationExcerpt', () => {
  it('119 / 120 / 121 / 120번째가 이모지 앞쪽', () => {
    const s119 = 'a'.repeat(119)
    const s120 = 'a'.repeat(120)
    expect(notificationExcerpt(s119)).toBe(s119)
    expect(notificationExcerpt(s120)).toBe(s120)
    expect(notificationExcerpt(s120 + 'b')).toBe(s120)
    const emoji = 'a'.repeat(119) + '😀' + 'z'
    expect(notificationExcerpt(emoji)).toBe('a'.repeat(119))
    expect(notificationExcerpt('줄\n바꿈')).toBe('줄\n바꿈')
  })
})

describe('F-502 8.4 계정 삭제 문장 (X5 는 F-2038 몫 — 문장만)', () => {
  it('내 문서의 댓글·알림, 받는 사람이 나인 알림 0, 남의 문서 댓글 행 그대로', async () => {
    const { sqlDb, db } = setup()
    sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u2', 'u2@example.com', 1)
    insertDoc(sqlDb, 'other-doc', 'u2')
    await db.batch(upsertCommentStatements(db, DOC, [row('c1')]))
    await db.batch(upsertCommentStatements(db, 'other-doc', [row('c2', { authorId: OWNER_ID, authorEmail: 'u1@example.com' })]))
    await db.batch(notificationStatements(db, { docId: DOC, docTitle: 't', now: 1, drafts: [draft('u2@example.com', 'c1')] }))
    await db.batch(notificationStatements(db, { docId: 'other-doc', docTitle: 't', now: 1, drafts: [draft('u1@example.com', 'c2'), draft('z@example.com', 'c2')] }))
    await db.batch(accountCommentDeleteStatements(db, OWNER_ID, 'U1@example.com'))
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?', DOC)).toBe(0)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?', 'other-doc')).toBe(1)
    expect(count(sqlDb, 'SELECT COUNT(*) AS n FROM notifications WHERE doc_id = ?', DOC)).toBe(0)
    expect(all<{ recipient_email: string }>(sqlDb, 'SELECT recipient_email FROM notifications')).toEqual([{ recipient_email: 'z@example.com' }])
  })
})
