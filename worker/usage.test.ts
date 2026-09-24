// 사용량 순수 함수·문장 모양·SQL 의미 (specs/features/F-2025.md 8.1 U1~U12)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  DAILY_WRITE_LIMIT,
  checkDocCreate,
  checkDocGrow,
  dayUsageStatement,
  deleteDocUsageStatement,
  deleteFoldersUsageStatement,
  docUsageStatements,
  isDailyLimitReached,
  readUsage,
  rowToUsage,
  secondsUntilUtcMidnight,
  snapshotUsageStatement,
  utcDay,
  utf8Bytes,
  writesToday,
  type UserUsage,
} from './usage'
import { toAuthUser } from './auth'
import { asD1, openTestDb } from './testD1'

type RunResult = { run(): Promise<unknown> }

function usageOf(over: Partial<UserUsage> = {}): UserUsage {
  return { writeDay: null, writeCount: 0, contentBytes: 0, docCount: 0, blockedAt: null, warnedAt: null, ...over }
}

describe('U1 utcDay', () => {
  it('UTC 날짜 문자열, 한국 시간은 UTC 로 변환', () => {
    expect(utcDay(Date.parse('2026-09-24T23:59:59.999Z'))).toBe('2026-09-24')
    expect(utcDay(Date.parse('2026-09-25T00:00:00.000Z'))).toBe('2026-09-25')
    expect(utcDay(Date.parse('2026-09-24T08:59:00+09:00'))).toBe('2026-09-23')
  })
})

describe('U2 secondsUntilUtcMidnight', () => {
  it('다음 UTC 자정까지 초, 올림', () => {
    expect(secondsUntilUtcMidnight(Date.parse('2026-09-24T00:00:00.000Z'))).toBe(86400)
    expect(secondsUntilUtcMidnight(Date.parse('2026-09-24T12:00:00.000Z'))).toBe(43200)
    expect(secondsUntilUtcMidnight(Date.parse('2026-09-24T23:59:59.001Z'))).toBe(1)
    expect(secondsUntilUtcMidnight(Date.parse('2026-09-24T23:59:58.500Z'))).toBe(2)
  })
})

describe('U3 utf8Bytes', () => {
  it('TextEncoder 길이', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('가나다')).toBe(9)
    expect(utf8Bytes('😀')).toBe(4)
    expect(utf8Bytes('a\r\nb')).toBe(4)
    expect(utf8Bytes('\ud800x')).toBe(4)
  })
})

describe('U4 writesToday·isDailyLimitReached', () => {
  const now = Date.parse('2026-09-24T10:00:00.000Z')

  it('오늘·어제·null 로 나뉜다', () => {
    expect(writesToday(usageOf({ writeDay: '2026-09-24', writeCount: 4_999 }), now)).toBe(4_999)
    expect(isDailyLimitReached(usageOf({ writeDay: '2026-09-24', writeCount: 4_999 }), now)).toBe(false)
    expect(writesToday(usageOf({ writeDay: '2026-09-24', writeCount: 5_000 }), now)).toBe(5_000)
    expect(isDailyLimitReached(usageOf({ writeDay: '2026-09-24', writeCount: 5_000 }), now)).toBe(true)
    expect(writesToday(usageOf({ writeDay: '2026-09-23', writeCount: 9_999 }), now)).toBe(0)
    expect(isDailyLimitReached(usageOf({ writeDay: '2026-09-23', writeCount: 9_999 }), now)).toBe(false)
    expect(writesToday(usageOf({ writeDay: null, writeCount: 0 }), now)).toBe(0)
  })

  it('DAILY_WRITE_LIMIT 은 5,000', () => {
    expect(DAILY_WRITE_LIMIT).toBe(5_000)
  })
})

describe('U5 checkDocCreate', () => {
  it('문서 수·바이트 한도, 둘 다 넘으면 docs', () => {
    expect(checkDocCreate(usageOf({ docCount: 9_999, contentBytes: 0 }), 10)).toBeNull()
    expect(checkDocCreate(usageOf({ docCount: 10_000, contentBytes: 0 }), 10)).toEqual({
      error: 'doc_quota_exceeded',
      resource: 'docs',
      used: 10_000,
      limit: 10_000,
    })
    expect(checkDocCreate(usageOf({ docCount: 0, contentBytes: 104_857_590 }), 10)).toBeNull()
    expect(checkDocCreate(usageOf({ docCount: 0, contentBytes: 104_857_590 }), 11)).toEqual({
      error: 'doc_quota_exceeded',
      resource: 'bytes',
      used: 104_857_590,
      limit: 104_857_600,
    })
    expect(checkDocCreate(usageOf({ docCount: 10_000, contentBytes: 104_857_590 }), 11)).toEqual(
      expect.objectContaining({ resource: 'docs' }),
    )
  })
})

describe('U6 checkDocGrow', () => {
  it('증감 0 이하는 늘 null, 한도와 같으면 통과', () => {
    expect(checkDocGrow(usageOf({ contentBytes: 200_000_000 }), 0)).toBeNull()
    expect(checkDocGrow(usageOf({ contentBytes: 200_000_000 }), -5)).toBeNull()
    expect(checkDocGrow(usageOf({ contentBytes: 104_857_599 }), 1)).toBeNull()
    expect(checkDocGrow(usageOf({ contentBytes: 104_857_600 }), 1)).toEqual({
      error: 'doc_quota_exceeded',
      resource: 'bytes',
      used: 104_857_600,
      limit: 104_857_600,
    })
  })
})

describe('U7 rowToUsage·toAuthUser', () => {
  it('스네이크 → 카멜 여섯 필드, null 보존', () => {
    expect(
      rowToUsage({ write_day: null, write_count: 0, content_bytes: 0, doc_count: 0, blocked_at: null, warned_at: null }),
    ).toEqual({ writeDay: null, writeCount: 0, contentBytes: 0, docCount: 0, blockedAt: null, warnedAt: null })
  })

  it('toAuthUser({ id, email }) 는 키가 id·email 둘뿐', () => {
    expect(Object.keys(toAuthUser({ id: 'u1', email: 'a@b.com' })).sort()).toEqual(['email', 'id'])
  })

  it('better-auth 모양을 넣으면 usage 가 여섯 필드', () => {
    const result = toAuthUser({
      id: 'u1',
      email: 'a@b.com',
      writeDay: '2026-09-24',
      writeCount: 7,
      contentBytes: 123,
      docCount: 2,
      blockedAt: null,
      warnedAt: null,
    })
    expect(result.usage).toEqual({
      writeDay: '2026-09-24',
      writeCount: 7,
      contentBytes: 123,
      docCount: 2,
      blockedAt: null,
      warnedAt: null,
    })
  })
})

// 값을 받아 적는 가짜 D1 — 문장 모양만 본다
function spySqlDb() {
  const calls: { sql: string; args: unknown[] }[] = []
  const db = {
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => (calls.push({ sql, args }), { sql, args }) }
    },
  } as unknown as D1Database
  return { db, calls }
}

const DAY_ONLY_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1 WHERE id = ?2'
const DAY_AND_TOTAL_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, content_bytes = content_bytes + CASE WHEN changes() = 1 THEN ?2 ELSE 0 END, doc_count = doc_count + CASE WHEN changes() = 1 THEN ?3 ELSE 0 END WHERE id = ?4'
const TOTAL_ONLY_SQL =
  'UPDATE users SET content_bytes = content_bytes + CASE WHEN changes() = 1 THEN ?1 ELSE 0 END, doc_count = doc_count + CASE WHEN changes() = 1 THEN ?2 ELSE 0 END WHERE id = ?3'
const DELETE_DOC_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, (content_bytes, doc_count) = (SELECT users.content_bytes - COALESCE(SUM(length(CAST(content AS BLOB))), 0), users.doc_count - COUNT(*) FROM docs WHERE id = ?2 AND owner_id = ?3) WHERE id = ?3'
const DELETE_FOLDERS_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, (content_bytes, doc_count) = (SELECT users.content_bytes - COALESCE(SUM(length(CAST(content AS BLOB))), 0), users.doc_count - COUNT(*) FROM docs WHERE owner_id = ?2 AND folder_id IN (SELECT value FROM json_each(?3))) WHERE id = ?2'

describe('U8 다섯 문장 — 글자까지 같다', () => {
  it('하루만', () => {
    const { db, calls } = spySqlDb()
    dayUsageStatement(db, 'u1', Date.parse('2026-09-24T10:00:00Z'))
    expect(calls[0].sql).toBe(DAY_ONLY_SQL)
    expect(calls[0].args).toEqual(['2026-09-24', 'u1'])
  })

  it('하루·누계 (보낸 사람 = 소유자)', () => {
    const { db, calls } = spySqlDb()
    docUsageStatements(db, { actorId: 'u1', ownerId: 'u1', now: Date.parse('2026-09-24T10:00:00Z'), deltaBytes: 5, deltaDocs: 1 })
    expect(calls[0].sql).toBe(DAY_AND_TOTAL_SQL)
    expect(calls[0].args).toEqual(['2026-09-24', 5, 1, 'u1'])
  })

  it('누계만', () => {
    const { db, calls } = spySqlDb()
    docUsageStatements(db, { actorId: 'actor', ownerId: 'owner', now: Date.parse('2026-09-24T10:00:00Z'), deltaBytes: 5, deltaDocs: 1 })
    expect(calls[0].sql).toBe(TOTAL_ONLY_SQL)
    expect(calls[0].args).toEqual([5, 1, 'owner'])
  })

  it('문서 삭제', () => {
    const { db, calls } = spySqlDb()
    deleteDocUsageStatement(db, 'owner', 'doc1', Date.parse('2026-09-24T10:00:00Z'))
    expect(calls[0].sql).toBe(DELETE_DOC_SQL)
    expect(calls[0].args).toEqual(['2026-09-24', 'doc1', 'owner'])
  })

  it('폴더 삭제', () => {
    const { db, calls } = spySqlDb()
    deleteFoldersUsageStatement(db, 'owner', ['f1', 'f2'], Date.parse('2026-09-24T10:00:00Z'))
    expect(calls[0].sql).toBe(DELETE_FOLDERS_SQL)
    expect(calls[0].args).toEqual(['2026-09-24', 'owner', JSON.stringify(['f1', 'f2'])])
  })

  it('읽기 문장', async () => {
    const row = { write_day: null, write_count: 0, content_bytes: 0, doc_count: 0, blocked_at: null, warned_at: null }
    const calls: { sql: string; args: unknown[] }[] = []
    const db = {
      prepare(sql: string) {
        return { bind: (...args: unknown[]) => (calls.push({ sql, args }), { first: async () => row }) }
      },
    } as unknown as Env['DB']
    await readUsage({ DB: db } as unknown as Env, 'u1')
    expect(calls[0].sql).toBe('SELECT write_day, write_count, content_bytes, doc_count, blocked_at, warned_at FROM users WHERE id = ?')
    expect(calls[0].args).toEqual(['u1'])
  })
})

describe('U9 docUsageStatements', () => {
  it('보낸 사람 = 소유자 → 문장 1개, 다르면 2개 순서 [누계만(소유자), 하루만(보낸 사람)]', () => {
    const { db } = spySqlDb()
    const same = docUsageStatements(db, { actorId: 'u1', ownerId: 'u1', now: 1, deltaBytes: 1, deltaDocs: 0 })
    expect(same.length).toBe(1)
    const diff = docUsageStatements(db, { actorId: 'actor', ownerId: 'owner', now: 1, deltaBytes: 1, deltaDocs: 0 })
    expect(diff.length).toBe(2)
  })
})

describe('U10 0010 누계 채우기 (node:sqlite)', () => {
  it('누계가 utf8Bytes 합·문서 수와 같다, signup_gate 초기값, 새 사용자 0·NULL', () => {
    const sql = openTestDb('0009')
    sql.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    sql.exec("INSERT INTO users (id, email, created_at) VALUES ('u2', 'c@d.com', 1)")
    sql.exec("INSERT INTO users (id, email, created_at) VALUES ('u3', 'e@f.com', 1)")
    sql
      .prepare(
        "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1','u1','t','가나다','lf',1,1,1)",
      )
      .run()
    sql
      .prepare(
        "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d2','u1','t','ab\r\ncd','lf',1,1,1)",
      )
      .run()
    sql
      .prepare(
        "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d3','u1','t','😀','lf',1,1,1)",
      )
      .run()
    sql
      .prepare(
        "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d4','u2','t','','lf',1,1,1)",
      )
      .run()

    const migrationPath = fileURLToPath(new URL('../migrations/0010_usage.sql', import.meta.url))
    sql.exec(readFileSync(migrationPath, 'utf-8'))

    const u1 = sql.prepare('SELECT content_bytes, doc_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      doc_count: number
    }
    expect(u1.content_bytes).toBe(utf8Bytes('가나다') + utf8Bytes('ab\r\ncd') + utf8Bytes('😀'))
    expect(u1.doc_count).toBe(3)

    const u2 = sql.prepare('SELECT content_bytes, doc_count FROM users WHERE id = ?').get('u2') as {
      content_bytes: number
      doc_count: number
    }
    expect(u2.content_bytes).toBe(0)
    expect(u2.doc_count).toBe(1)

    const u3 = sql.prepare('SELECT content_bytes, doc_count FROM users WHERE id = ?').get('u3') as {
      content_bytes: number
      doc_count: number
    }
    expect(u3.content_bytes).toBe(0)
    expect(u3.doc_count).toBe(0)

    const gate = sql.prepare('SELECT id, day, count FROM signup_gate').all()
    expect(gate).toEqual([{ id: 1, day: '', count: 0 }])

    sql.exec("INSERT INTO users (id, email, created_at) VALUES ('u4', 'g@h.com', 1)")
    const u4 = sql
      .prepare('SELECT write_day, write_count, content_bytes, doc_count, blocked_at, warned_at FROM users WHERE id = ?')
      .get('u4') as Record<string, unknown>
    expect(u4).toEqual({ write_day: null, write_count: 0, content_bytes: 0, doc_count: 0, blocked_at: null, warned_at: null })
  })
})

describe('U11 하루 경계 (SQL 의미)', () => {
  it('같은 날 두 번은 write_count 2, 다음 날은 1로 리셋', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    const db = asD1(sqlDb)

    await (dayUsageStatement(db, 'u1', Date.parse('2026-09-24T23:59:00Z')) as unknown as RunResult).run()
    await (dayUsageStatement(db, 'u1', Date.parse('2026-09-24T23:59:00Z')) as unknown as RunResult).run()
    const afterTwo = sqlDb.prepare('SELECT write_day, write_count FROM users WHERE id = ?').get('u1') as {
      write_day: string
      write_count: number
    }
    expect(afterTwo.write_day).toBe('2026-09-24')
    expect(afterTwo.write_count).toBe(2)

    await (dayUsageStatement(db, 'u1', Date.parse('2026-09-25T00:00:00Z')) as unknown as RunResult).run()
    const nextDay = sqlDb.prepare('SELECT write_day, write_count FROM users WHERE id = ?').get('u1') as {
      write_day: string
      write_count: number
    }
    expect(nextDay.write_day).toBe('2026-09-25')
    expect(nextDay.write_count).toBe(1)
  })
})

describe('U12 삭제 빼기 (SQL 의미)', () => {
  it('문서 하나 삭제 — 빠진 바이트가 바뀐 본문 기준, 없는 id 는 누계 그대로·write_count +1', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1','u1','t','hello','lf',1,1,1)",
    )
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d2','u1','t','x','lf',1,1,1)",
    )
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d3','u1','t','y','lf',1,1,1)",
    )
    sqlDb.exec("UPDATE users SET content_bytes = 7, doc_count = 3 WHERE id = 'u1'")
    // 끼어든 PUT 흉내: D1 에서 직접 본문을 바꾼다(읽은 값과 실제 값이 달라진다)
    sqlDb.exec("UPDATE docs SET content = 'longer-text' WHERE id = 'd1'")

    const db = asD1(sqlDb)
    const now = Date.parse('2026-09-24T10:00:00Z')
    await (deleteDocUsageStatement(db, 'u1', 'd1', now) as unknown as RunResult).run()
    sqlDb.exec("DELETE FROM docs WHERE id = 'd1'")

    const row = sqlDb.prepare('SELECT content_bytes, doc_count, write_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      doc_count: number
      write_count: number
    }
    expect(row.content_bytes).toBe(7 - utf8Bytes('longer-text'))
    expect(row.doc_count).toBe(2)
    expect(row.write_count).toBe(1)

    await (deleteDocUsageStatement(db, 'u1', 'no-such-doc', now) as unknown as RunResult).run()
    const row2 = sqlDb.prepare('SELECT content_bytes, doc_count, write_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      doc_count: number
      write_count: number
    }
    expect(row2.content_bytes).toBe(row.content_bytes)
    expect(row2.doc_count).toBe(row.doc_count)
    expect(row2.write_count).toBe(2)
  })

  it('폴더째 삭제 — 폴더 안 문서만 빠진다', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@b.com', 1)")
    sqlDb.exec("INSERT INTO folders (id, owner_id, name, created_at, updated_at) VALUES ('f1','u1','A',1,1)")
    sqlDb.exec("INSERT INTO folders (id, owner_id, name, created_at, updated_at) VALUES ('f2','u1','B',1,1)")
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES ('d1','u1','t','aaa','lf','f1',1,1,1)",
    )
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES ('d2','u1','t','bbb','lf','f1',1,1,1)",
    )
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES ('d3','u1','t','ccc','lf','f2',1,1,1)",
    )
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, folder_id, version, created_at, updated_at) VALUES ('d4','u1','t','outside','lf',NULL,1,1,1)",
    )
    sqlDb.exec("UPDATE users SET content_bytes = 12, doc_count = 4 WHERE id = 'u1'")

    const db = asD1(sqlDb)
    const now = Date.parse('2026-09-24T10:00:00Z')
    await (deleteFoldersUsageStatement(db, 'u1', ['f1', 'f2'], now) as unknown as RunResult).run()
    sqlDb.exec("DELETE FROM docs WHERE owner_id = 'u1' AND folder_id IN ('f1','f2')")

    const row = sqlDb.prepare('SELECT content_bytes, doc_count FROM users WHERE id = ?').get('u1') as {
      content_bytes: number
      doc_count: number
    }
    // 12 - ('aaa'+'bbb'+'ccc' = 3+3+3 = 9) = 3
    expect(row.content_bytes).toBe(3)
    expect(row.doc_count).toBe(1)
    const remaining = sqlDb.prepare('SELECT content FROM docs').all() as { content: string }[]
    expect(remaining.map((r) => r.content)).toEqual(['outside'])
  })
})

// F-2027 4.1 — 하루 + 누계 문장 + RETURNING 사용량 열 여섯
const SNAPSHOT_USAGE_SQL = `${DAY_AND_TOTAL_SQL} RETURNING write_day, write_count, content_bytes, doc_count, blocked_at, warned_at`

describe('F-2027 U14 snapshotUsageStatement', () => {
  it('문장 글자·바인딩', () => {
    const { db, calls } = spySqlDb()
    snapshotUsageStatement(db, 'owner', 1_000_000, 7)
    expect(calls[0].sql).toBe(SNAPSHOT_USAGE_SQL)
    expect(calls[0].args).toEqual(['1970-01-01', 7, 0, 'owner'])
  })

  // 어댑터 batch 는 run() 을 불러 RETURNING 행을 버린다 — 같은 트랜잭션 안에서 all() 로 받아 본다
  it('문서 UPDATE 1행 뒤 → 갱신 뒤 값, 0행 뒤 → 누계 그대로·write_count +1', async () => {
    const sqlDb = openTestDb()
    sqlDb.exec("INSERT INTO users (id, email, created_at) VALUES ('owner', 'a@b.com', 1)")
    sqlDb.exec(
      "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES ('d1','owner','t','hello','lf',1,1,1)",
    )
    sqlDb.exec("UPDATE users SET content_bytes = 5, doc_count = 1 WHERE id = 'owner'")
    const db = asD1(sqlDb)
    const docUpdate = 'UPDATE docs SET title = ?, content = ?, version = ?, updated_at = ? WHERE id = ? AND version = ?'
    const now = 1_000_000

    const once = async (cond: number) => {
      sqlDb.exec('BEGIN')
      await (db.prepare(docUpdate).bind('t', 'hello!!', cond + 1, now, 'd1', cond) as unknown as RunResult).run()
      const stmt = snapshotUsageStatement(db, 'owner', now, 2) as unknown as { all(): Promise<{ results: unknown[] }> }
      const { results } = await stmt.all()
      sqlDb.exec('COMMIT')
      return results
    }

    expect(await once(1)).toEqual([
      { write_day: '1970-01-01', write_count: 1, content_bytes: 7, doc_count: 1, blocked_at: null, warned_at: null },
    ])
    expect(await once(1)).toEqual([
      { write_day: '1970-01-01', write_count: 2, content_bytes: 7, doc_count: 1, blocked_at: null, warned_at: null },
    ])
  })
})

describe('readUsage', () => {
  it('행이 없으면 EMPTY_USAGE', async () => {
    const sqlDb = openTestDb()
    const db = asD1(sqlDb)
    const usage = await readUsage({ DB: db } as unknown as Env, 'no-such-user')
    expect(usage).toEqual({ writeDay: null, writeCount: 0, contentBytes: 0, docCount: 0, blockedAt: null, warnedAt: null })
  })
})
