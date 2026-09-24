// scripts/lib/admin.mjs 단위 테스트 — 순수 함수·SQL 의미·흐름 (specs/features/F-2029.md 9.1)
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  AdminError,
  SQL,
  normalizeEmail,
  parseAdminArgs,
  parseWranglerJson,
  runAdmin,
  sqlText,
  utcDay,
  utcDayStartMs,
} from './admin.mjs'

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url))

function openDb() {
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(MIGRATIONS + file, 'utf-8'))
  }
  return db
}

function execOn(db) {
  return async (sql) => db.prepare(sql).all().map((r) => ({ ...r }))
}

function insertUser(db, { id, email, created_at, write_day = null, write_count = 0, content_bytes = 0, doc_count = 0, blocked_at = null, warned_at = null }) {
  db.prepare(
    'INSERT INTO users (id, email, created_at, write_day, write_count, content_bytes, doc_count, blocked_at, warned_at) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, email, created_at, write_day, write_count, content_bytes, doc_count, blocked_at, warned_at)
}

function insertDoc(db, { id, owner_id, content }) {
  db.prepare(
    "INSERT INTO docs (id, owner_id, title, content, line_ending, version, created_at, updated_at) VALUES (?,?,?,?,'lf',1,0,0)",
  ).run(id, owner_id, 't', content)
}

describe('normalizeEmail (S1)', () => {
  it('공백을 빼고 소문자로 바꾼다', () => {
    assert.equal(normalizeEmail(' A@Example.COM '), 'a@example.com')
  })
  it("작은따옴표가 든 주소를 받는다", () => {
    assert.equal(normalizeEmail("o'b@x.com"), "o'b@x.com")
  })
  for (const bad of ['', 'no-at', 'a@b', 'a b@c.d', 'a@@b.c', 'x'.repeat(255), 'a\u0000@b.c']) {
    it(`형식이 아니면 던진다: ${JSON.stringify(bad)}`, () => {
      assert.throws(() => normalizeEmail(bad), AdminError)
    })
  }
})

describe('sqlText (S2)', () => {
  it('UTF-8 16진 리터럴로 바꾼다', () => {
    assert.equal(sqlText('a@example.com'), "CAST(X'61406578616d706c652e636f6d' AS TEXT)")
    assert.equal(sqlText('가'), "CAST(X'eab080' AS TEXT)")
  })
})

describe('주입 (S3)', () => {
  const evil = "x'); DROP TABLE users; --@a.com"
  it('문장에 원본 글자·세미콜론·-- 가 없다', () => {
    const statements = [
      SQL.findUser(evil),
      SQL.block(evil, 1000),
      SQL.unblock(evil),
      SQL.warn(evil, 1000),
      SQL.clearWarn(evil),
      SQL.recountPreview({ email: evil }),
      SQL.recount({ email: evil }),
    ]
    for (const sql of statements) {
      assert.equal(sql.includes(evil), false)
      assert.equal(sql.includes(';'), false)
      assert.equal(sql.includes('--'), false)
    }
  })
  it('그 문장을 돌려도 users 표가 그대로 있다', () => {
    const db = openDb()
    insertUser(db, { id: 'u1', email: 'a@example.com', created_at: 0 })
    for (const sql of [SQL.findUser(evil), SQL.block(evil, 1000), SQL.unblock(evil), SQL.warn(evil, 1000), SQL.clearWarn(evil), SQL.recountPreview({ email: evil }), SQL.recount({ email: evil })]) {
      db.prepare(sql).all()
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1)
  })
})

describe('utcDay·utcDayStartMs (S4)', () => {
  it('worker/usage.ts utcDay 와 같은 값', () => {
    assert.equal(utcDay(Date.parse('2026-09-24T15:00Z')), '2026-09-24')
    assert.equal(utcDayStartMs(Date.parse('2026-09-24T15:00Z')), Date.parse('2026-09-24T00:00Z'))
  })
})

describe('parseAdminArgs (S5)', () => {
  it('알 수 없는 인자', () => {
    assert.throws(() => parseAdminArgs('usage', ['--foo']), AdminError)
  })
  it('위치 인자 둘', () => {
    assert.throws(() => parseAdminArgs('block', ['a@x.com', 'b@x.com']), AdminError)
  })
  for (const top of ['0', '1001', 'abc']) {
    it(`--top ${top} 는 틀림`, () => {
      assert.throws(() => parseAdminArgs('usage', ['--top', top]), AdminError)
    })
  }
  it('--top 1000 은 통과', () => {
    const opts = parseAdminArgs('usage', ['--top', '1000'])
    assert.equal(opts.top, 1000)
  })
  it('recount 둘 다면 틀림', () => {
    assert.throws(() => parseAdminArgs('recount', ['a@x.com', '--all']), AdminError)
  })
  it('recount 둘 다 없으면 틀림', () => {
    assert.throws(() => parseAdminArgs('recount', []), AdminError)
  })
  it('--persist-to 만이면 틀림', () => {
    assert.throws(() => parseAdminArgs('usage', ['--persist-to', 'x']), AdminError)
  })
  it('--local --persist-to x 는 통과', () => {
    const opts = parseAdminArgs('usage', ['--local', '--persist-to', 'x'])
    assert.equal(opts.local, true)
    assert.equal(opts.persistTo, 'x')
  })
  it('usage 에 --yes 는 틀림', () => {
    assert.throws(() => parseAdminArgs('usage', ['--yes']), AdminError)
  })
})

describe('parseWranglerJson (S6)', () => {
  it('성공 출력에서 첫 results', () => {
    const out = JSON.stringify([{ results: [{ id: 'u1' }], success: true, meta: { duration: 1 } }])
    assert.deepEqual(parseWranglerJson(out), [{ id: 'u1' }])
  })
  it('실패 출력(앞 빈 줄) 은 SQLITE_ERROR 를 담은 오류', () => {
    const out = '\n{ "error": { "text": "near \\"SELEC\\": syntax error at offset 0: SQLITE_ERROR" } }'
    assert.throws(() => parseWranglerJson(out), (err) => err instanceof AdminError && err.message.includes('SQLITE_ERROR'))
  })
  it("'hello' 는 오류", () => {
    assert.throws(() => parseWranglerJson('hello'), AdminError)
  })
  it('success:false 는 오류', () => {
    assert.throws(() => parseWranglerJson(JSON.stringify([{ success: false, results: [] }])), AdminError)
  })
})

describe('block·unblock·warn·clearWarn 의미 (S7)', () => {
  it('두 번째부터는 바꾸지 않는다', async () => {
    const db = openDb()
    insertUser(db, { id: 'u1', email: 'a@example.com', created_at: 0 })
    insertUser(db, { id: 'u2', email: 'b@example.com', created_at: 0 })
    const exec = execOn(db)
    const r1 = await exec(SQL.block('a@example.com', 1000))
    assert.deepEqual(r1, [{ id: 'u1', email: 'a@example.com', blocked_at: 1000 }])
    const r2 = await exec(SQL.block('a@example.com', 2000))
    assert.deepEqual(r2, [])
    assert.equal(db.prepare("SELECT blocked_at FROM users WHERE email = 'a@example.com'").get().blocked_at, 1000)

    const u1 = await exec(SQL.unblock('a@example.com'))
    assert.equal(u1.length, 1)
    const u2 = await exec(SQL.unblock('a@example.com'))
    assert.deepEqual(u2, [])

    const none = await exec(SQL.block('nobody@example.com', 1000))
    assert.deepEqual(none, [])

    const w1 = await exec(SQL.warn('a@example.com', 500))
    assert.equal(w1.length, 1)
    const w2 = await exec(SQL.warn('a@example.com', 999))
    assert.deepEqual(w2, [])
    const c1 = await exec(SQL.clearWarn('a@example.com'))
    assert.equal(c1.length, 1)
    const c2 = await exec(SQL.clearWarn('a@example.com'))
    assert.deepEqual(c2, [])

    const other = { ...db.prepare("SELECT blocked_at, warned_at FROM users WHERE email = 'b@example.com'").get() }
    assert.deepEqual(other, { blocked_at: null, warned_at: null })
  })
})

describe('recount 의미 (S8)', () => {
  it('틀림·음수 두 명만 고친다', async () => {
    const db = openDb()
    insertUser(db, { id: 'u1', email: 'a@example.com', created_at: 0, content_bytes: 9, doc_count: 1 })
    insertUser(db, { id: 'u2', email: 'b@example.com', created_at: 0, content_bytes: 999, doc_count: 999 })
    insertUser(db, { id: 'u3', email: 'c@example.com', created_at: 0, content_bytes: -1, doc_count: -1 })
    insertDoc(db, { id: 'd1', owner_id: 'u1', content: '가나다' })
    const exec = execOn(db)

    const preview = await exec(SQL.recountPreview({ all: true }))
    assert.equal(preview.length, 3)
    const u1Row = preview.find((r) => r.email === 'a@example.com')
    assert.equal(u1Row.real_bytes, Buffer.byteLength('가나다', 'utf-8'))
    assert.equal(u1Row.real_docs, 1)

    const changed = await exec(SQL.recount({ all: true }))
    assert.equal(changed.length, 2)
    const emails = changed.map((r) => r.email).sort()
    assert.deepEqual(emails, ['b@example.com', 'c@example.com'])

    const again = await exec(SQL.recount({ all: true }))
    assert.deepEqual(again, [])

    db.prepare("UPDATE users SET content_bytes = -5 WHERE email = 'a@example.com'").run()
    const one = await exec(SQL.recount({ email: 'a@example.com' }))
    assert.equal(one.length, 1)
    assert.equal(one[0].email, 'a@example.com')
  })
})

describe('usageTop·usageSummary 의미 (S9)', () => {
  it('오늘 순서·gate_today·created_today·blocked·warned', async () => {
    const db = openDb()
    const now = Date.parse('2026-09-24T10:00Z')
    const dayMs = 24 * 60 * 60 * 1000
    insertUser(db, { id: 'u1', email: 'today@example.com', created_at: now, write_day: '2026-09-24', write_count: 3 })
    insertUser(db, { id: 'u2', email: 'yesterday@example.com', created_at: now - 2 * dayMs, write_day: '2026-09-23', write_count: 9999 })
    insertUser(db, { id: 'u3', email: 'never@example.com', created_at: now - 3 * dayMs, write_day: null, write_count: 0, blocked_at: 1, warned_at: 2 })
    db.prepare("UPDATE signup_gate SET day = ?, count = ? WHERE id = 1").run('2026-09-23', 7)
    const exec = execOn(db)

    const top = await exec(SQL.usageTop(now, 20))
    assert.equal(top[0].email, 'today@example.com')
    const yesterdayRow = top.find((r) => r.email === 'yesterday@example.com')
    assert.equal(yesterdayRow.today, 0)

    const top1 = await exec(SQL.usageTop(now, 1))
    assert.equal(top1.length, 1)

    const summary1 = (await exec(SQL.usageSummary(now)))[0]
    assert.equal(summary1.gate_today, 0)
    assert.equal(summary1.created_today, 1)
    assert.equal(summary1.blocked, 1)
    assert.equal(summary1.warned, 1)

    db.prepare("UPDATE signup_gate SET day = ?, count = ? WHERE id = 1").run('2026-09-24', 2)
    const summary2 = (await exec(SQL.usageSummary(now)))[0]
    assert.equal(summary2.gate_today, 2)
  })
})

function fakeExecFactory(handlers, calls) {
  return () => async (sql) => {
    calls.push(sql)
    for (const [match, result] of handlers) {
      if (sql.startsWith(match)) return typeof result === 'function' ? result() : result
    }
    throw new Error(`가짜 실행기에 정의 없음: ${sql}`)
  }
}

describe('흐름 — admin-block (S10)', () => {
  it('--yes 없으면 findUser 만, SQL·M3 출력', async () => {
    const calls = []
    const prints = []
    const exec = fakeExecFactory(
      [
        ['SELECT id, email, created_at, write_day', [{ id: 'u1', email: 'a@x.com', blocked_at: null, warned_at: null }]],
      ],
      calls,
    )
    const code = await runAdmin('block', ['a@x.com'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 0)
    assert.equal(calls.length, 1)
    assert.ok(prints.some((l) => l.startsWith('SQL: ')))
    assert.ok(prints.includes('실행하지 않았습니다. 위 SQL 을 실행하려면 --yes 를 붙이세요.'))
  })

  it('--yes 있으면 findUser·block 둘, 막았습니다 출력', async () => {
    const calls = []
    const prints = []
    const exec = fakeExecFactory(
      [
        ['SELECT id, email, created_at, write_day', [{ id: 'u1', email: 'a@x.com', blocked_at: null, warned_at: null }]],
        ['UPDATE users SET blocked_at', [{ id: 'u1', email: 'a@x.com', blocked_at: 1000 }]],
      ],
      calls,
    )
    const code = await runAdmin('block', ['a@x.com', '--yes'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 0)
    assert.equal(calls.length, 2)
    assert.ok(prints.some((l) => l.startsWith('막았습니다: a@x.com')))
    assert.ok(prints.some((l) => l.includes('/api/me')))
  })

  it('없는 계정 → 3·M4', async () => {
    const prints = []
    const exec = fakeExecFactory([['SELECT id, email, created_at, write_day', []]], [])
    const code = await runAdmin('block', ['nobody@x.com'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 3)
    assert.ok(prints.includes('계정이 없습니다: nobody@x.com'))
  })

  it('이미 막힘 → 0·M9, 쓰기 SQL 없음', async () => {
    const calls = []
    const prints = []
    const exec = fakeExecFactory(
      [['SELECT id, email, created_at, write_day', [{ id: 'u1', email: 'a@x.com', blocked_at: 500, warned_at: null }]]],
      calls,
    )
    const code = await runAdmin('block', ['a@x.com', '--yes'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 0)
    assert.equal(calls.length, 1)
    assert.ok(prints.some((l) => l.startsWith('이미 막혀 있습니다')))
  })

  it('findUser 는 안 막힘인데 block 결과 [] → 1·M13', async () => {
    const prints = []
    const exec = fakeExecFactory(
      [
        ['SELECT id, email, created_at, write_day', [{ id: 'u1', email: 'a@x.com', blocked_at: null, warned_at: null }]],
        ['UPDATE users SET blocked_at', []],
      ],
      [],
    )
    const code = await runAdmin('block', ['a@x.com', '--yes'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 1)
    assert.ok(prints.includes('그 사이 상태가 바뀌었습니다. 다시 실행해 지금 상태를 보세요.'))
  })
})

describe('--yes 없으면 실행기가 받은 SQL 이 모두 SELECT (S11)', () => {
  const cases = [
    ['usage', []],
    ['block', ['a@x.com']],
    ['unblock', ['a@x.com']],
    ['warn', ['a@x.com']],
    ['recount', ['--all']],
  ]
  for (const [command, argv] of cases) {
    it(command, async () => {
      const calls = []
      const exec = fakeExecFactory(
        [
          [
            'SELECT',
            [
              {
                id: 'u1',
                email: 'a@x.com',
                blocked_at: null,
                warned_at: null,
                content_bytes: 1,
                doc_count: 1,
                real_bytes: 2,
                real_docs: 2,
                created_at: 1000,
                today: 1,
                gate_today: 0,
                created_today: 0,
                users: 1,
                bytes: 1,
                docs: 1,
                blocked: 0,
                warned: 0,
              },
            ],
          ],
        ],
        calls,
      )
      await runAdmin(command, argv, { exec, now: () => 1000, print: () => {} })
      assert.ok(calls.length > 0)
      for (const sql of calls) assert.ok(sql.trim().startsWith('SELECT'))
    })
  }
})

describe('실행기 실패 (S12)', () => {
  it('AdminError(db) 를 던지면 1·D1 실행 실패', async () => {
    const prints = []
    const exec = () => async () => {
      throw new AdminError('db', 'boom')
    }
    const code = await runAdmin('usage', [], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 1)
    assert.ok(prints.includes('D1 실행 실패: boom'))
  })
})

describe('--local 전달 (S13)', () => {
  it('exec 팩토리가 파싱한 옵션을 받는다', async () => {
    const summaryOnly = async (sql) =>
      sql.includes('gate_today')
        ? [{ gate_today: 0, created_today: 0, users: 0, bytes: 0, docs: 0, blocked: 0, warned: 0 }]
        : []
    let received = null
    const exec = (opts) => {
      received = opts
      return summaryOnly
    }
    await runAdmin('usage', ['--local', '--persist-to', 'x'], { exec, now: () => 1000, print: () => {} })
    assert.equal(received.local, true)
    assert.equal(received.persistTo, 'x')

    let received2 = null
    const exec2 = (opts) => {
      received2 = opts
      return summaryOnly
    }
    await runAdmin('usage', [], { exec: exec2, now: () => 1000, print: () => {} })
    assert.equal(received2.local, false)
    assert.equal(received2.persistTo, null)
  })
})

describe('recount 출력 (S14)', () => {
  it('가짜 실행기 결과 두 행 → 다시 셌습니다: 2명', async () => {
    const prints = []
    const calls = []
    const exec = fakeExecFactory(
      [
        [
          'SELECT id, email, content_bytes, doc_count, (SELECT COALESCE',
          [
            { id: 'u1', email: 'a@x.com', content_bytes: 1, doc_count: 1, real_bytes: 2, real_docs: 2 },
            { id: 'u2', email: 'b@x.com', content_bytes: 0, doc_count: 0, real_bytes: 5, real_docs: 3 },
          ],
        ],
        [
          'UPDATE users SET (content_bytes, doc_count)',
          [
            { id: 'u1', email: 'a@x.com', content_bytes: 2, doc_count: 2 },
            { id: 'u2', email: 'b@x.com', content_bytes: 5, doc_count: 3 },
          ],
        ],
      ],
      calls,
    )
    const code = await runAdmin('recount', ['--all', '--yes'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 0)
    assert.ok(prints.includes('다시 셌습니다: 2명'))
  })

  it('미리보기 어긋남 0 → M12, recount 문장을 보내지 않는다', async () => {
    const prints = []
    const calls = []
    const exec = fakeExecFactory(
      [
        [
          'SELECT id, email, content_bytes, doc_count, (SELECT COALESCE',
          [{ id: 'u1', email: 'a@x.com', content_bytes: 1, doc_count: 1, real_bytes: 1, real_docs: 1 }],
        ],
      ],
      calls,
    )
    const code = await runAdmin('recount', ['--all', '--yes'], { exec, now: () => 1000, print: (l) => prints.push(l) })
    assert.equal(code, 0)
    assert.ok(prints.includes('다시 셀 것이 없습니다.'))
    assert.equal(calls.filter((sql) => sql.startsWith('UPDATE')).length, 0)
  })
})
