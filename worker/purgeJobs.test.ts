// 정리 작업 비우기·Cron 가르기 (specs/features/F-2038.md 5.4·5.5, 9.1 P1~P5)
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { asD1, openTestDb } from './testD1'
import { DAILY_CRON, PURGE_CRON, PURGE_SQL, runPurgeJobs } from './purgeJobs'

afterEach(() => {
  vi.restoreAllMocks()
})

const NOW = 10_000_000_000
const HOUR = 60 * 60 * 1000

function addJob(sqlDb: DatabaseSync, kind: 'room' | 'r2_prefix', target: string, priority: number, opts: { createdAt?: number; attempts?: number } = {}) {
  sqlDb
    .prepare('INSERT INTO purge_jobs (kind, target, priority, created_at, attempts) VALUES (?, ?, ?, ?, ?)')
    .run(kind, target, priority, opts.createdAt ?? NOW, opts.attempts ?? 0)
}

function jobs(sqlDb: DatabaseSync) {
  return sqlDb.prepare('SELECT kind, target, attempts FROM purge_jobs ORDER BY kind, target').all() as { kind: string; target: string; attempts: number }[]
}

function rooms(behaviour: (name: string) => Promise<void> = async () => {}) {
  const names: string[] = []
  const getByName = vi.fn((name: string) => {
    names.push(name)
    return { purgeRoom: () => behaviour(name) }
  })
  return { ns: { getByName }, names }
}

// R2 바인딩 흉내 — list 는 prefix 로 거르고 limit 만큼, delete 는 받은 키를 지운다
function fakeBucket(keys: string[]) {
  const store = new Set(keys)
  const calls: { op: 'list' | 'delete'; n: number }[] = []
  return {
    store,
    calls,
    bucket: {
      async list({ prefix, limit }: { prefix: string; limit: number }) {
        const objects = [...store].filter((k) => k.startsWith(prefix)).slice(0, limit).map((key) => ({ key }))
        calls.push({ op: 'list', n: objects.length })
        return { objects, truncated: false, delimitedPrefixes: [] }
      },
      async delete(input: string | string[]) {
        const list = Array.isArray(input) ? input : [input]
        calls.push({ op: 'delete', n: list.length })
        for (const k of list) store.delete(k)
      },
    },
  }
}

// D1 문장 수를 센다 — prepare 로 실행된 것
function counted(sqlDb: DatabaseSync) {
  const inner = asD1(sqlDb)
  const executed: string[] = []
  const db = {
    prepare(sql: string) {
      executed.push(sql)
      return inner.prepare(sql)
    },
    batch: inner.batch.bind(inner),
  } as unknown as D1Database
  return { db, executed }
}

function env(over: Record<string, unknown>): Env {
  return over as unknown as Env
}

describe('F-2038 P1 방 먼저, 최근 고친 문서부터', () => {
  it('maxCalls 3 → 5·4·3 순으로 3번, 3행 지움', async () => {
    const sqlDb = openTestDb()
    for (let p = 1; p <= 5; p++) addJob(sqlDb, 'room', `d${p}`, p)
    const r = rooms()
    await runPurgeJobs(env({ DB: asD1(sqlDb), DOC_ROOM: r.ns }), NOW, 3)
    expect(r.names).toEqual(['d5', 'd4', 'd3'])
    expect(jobs(sqlDb).map((j) => j.target)).toEqual(['d1', 'd2'])
  })
})

describe('F-2038 P2 실패·바인딩 없음·멈춤 로그', () => {
  it('던지면 attempts + 1 로 남는다', async () => {
    const sqlDb = openTestDb()
    addJob(sqlDb, 'room', 'd1', 1)
    const r = rooms(async () => {
      throw new Error('down')
    })
    await runPurgeJobs(env({ DB: asD1(sqlDb), DOC_ROOM: r.ns }), NOW, 5)
    expect(jobs(sqlDb)).toEqual([{ kind: 'room', target: 'd1', attempts: 1 }])
  })

  it('DOC_ROOM 이 없으면 성공으로 지운다', async () => {
    const sqlDb = openTestDb()
    addJob(sqlDb, 'room', 'd1', 1)
    await runPurgeJobs(env({ DB: asD1(sqlDb) }), NOW, 5)
    expect(jobs(sqlDb)).toEqual([])
  })

  it('attempts 143 → 144 에서만 purge_job_stuck 한 번, 대상은 로그에 없다', async () => {
    const sqlDb = openTestDb()
    addJob(sqlDb, 'room', 'secret-doc', 1, { attempts: 143 })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = rooms(async () => {
      throw new Error('down')
    })
    const e = env({ DB: asD1(sqlDb), DOC_ROOM: r.ns })
    await runPurgeJobs(e, NOW, 5)
    await runPurgeJobs(e, NOW, 5)
    const stuck = error.mock.calls.filter((c) => c[0] === 'purge_job_stuck')
    expect(stuck).toEqual([['purge_job_stuck', 'room']])
    expect(JSON.stringify(error.mock.calls)).not.toContain('secret-doc')
    expect(jobs(sqlDb)).toEqual([{ kind: 'room', target: 'secret-doc', attempts: 145 }])
  })
})

describe('F-2038 P3 R2 접두사', () => {
  function world(createdAgo: number) {
    const sqlDb = openTestDb()
    addJob(sqlDb, 'r2_prefix', 'att/u1/', 0, { createdAt: NOW - createdAgo })
    const keys = Array.from({ length: 2500 }, (_, i) => `att/u1/${String(i).padStart(16, '0')}.png`)
    const b = fakeBucket([...keys, 'att/u2/keep.png'])
    return { sqlDb, b }
  }

  it('2,500개 → list·delete 1,000·1,000·500, 빈 list 한 번. 61분이면 행 지움', async () => {
    const { sqlDb, b } = world(61 * 60 * 1000)
    await runPurgeJobs(env({ DB: asD1(sqlDb), BUCKET: b.bucket }), NOW, 10)
    expect(b.calls).toEqual([
      { op: 'list', n: 1000 },
      { op: 'delete', n: 1000 },
      { op: 'list', n: 1000 },
      { op: 'delete', n: 1000 },
      { op: 'list', n: 500 },
      { op: 'delete', n: 500 },
      { op: 'list', n: 0 },
    ])
    expect([...b.store]).toEqual(['att/u2/keep.png'])
    expect(jobs(sqlDb)).toEqual([])
  })

  it('59분이면 비어도 행을 남긴다', async () => {
    const { sqlDb, b } = world(59 * 60 * 1000)
    await runPurgeJobs(env({ DB: asD1(sqlDb), BUCKET: b.bucket }), NOW, 10)
    expect(b.store.size).toBe(1)
    expect(jobs(sqlDb)).toEqual([{ kind: 'r2_prefix', target: 'att/u1/', attempts: 0 }])
  })

  it('R2 가 던지면 attempts + 1', async () => {
    const sqlDb = openTestDb()
    addJob(sqlDb, 'r2_prefix', 'att/u1/', 0, { createdAt: NOW - 2 * HOUR })
    const bucket = {
      async list() {
        throw new Error('r2 down')
      },
    }
    await runPurgeJobs(env({ DB: asD1(sqlDb), BUCKET: bucket }), NOW, 10)
    expect(jobs(sqlDb)).toEqual([{ kind: 'r2_prefix', target: 'att/u1/', attempts: 1 }])
  })
})

describe('F-2038 P4 예산', () => {
  it('D1 ≤ 4, 방·R2 호출 합 ≤ maxCalls, 방이 예산을 다 쓰면 R2 는 안 부른다', async () => {
    const sqlDb = openTestDb()
    for (let p = 1; p <= 8; p++) addJob(sqlDb, 'room', `d${p}`, p)
    addJob(sqlDb, 'r2_prefix', 'att/u1/', 0, { createdAt: NOW - 2 * HOUR })
    const b = fakeBucket(['att/u1/a.png'])
    let fail = true
    const r = rooms(async () => {
      fail = !fail
      if (fail) throw new Error('down')
    })
    const { db, executed } = counted(sqlDb)
    await runPurgeJobs(env({ DB: db, DOC_ROOM: r.ns, BUCKET: b.bucket }), NOW, 5)
    expect(r.names).toHaveLength(5)
    expect(b.calls).toEqual([])
    expect(executed.length).toBeLessThanOrEqual(4)
    expect(executed.every((sql) => Object.values(PURGE_SQL).includes(sql as never))).toBe(true)

    const second = counted(sqlDb)
    const left = rooms()
    await runPurgeJobs(env({ DB: second.db, DOC_ROOM: left.ns, BUCKET: b.bucket }), NOW, 10)
    expect(second.executed.length).toBeLessThanOrEqual(4)
    expect(left.names.length + b.calls.length).toBeLessThanOrEqual(10)
    expect(left.names).toHaveLength(5)
    expect(b.calls.map((c) => c.op)).toEqual(['list', 'delete', 'list'])
    expect(jobs(sqlDb)).toEqual([])
  })
})

describe('F-2038 P5 Cron 가르기', () => {
  type Worker = { scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> }

  async function loadWorker(): Promise<Worker> {
    vi.doMock('./docRoom', () => ({ DocRoom: class {} }))
    vi.resetModules()
    return (await import('./index')).default as unknown as Worker
  }

  async function pendingFor(worker: Worker, event: object): Promise<number> {
    const pending: Promise<unknown>[] = []
    const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext
    const DB = {
      prepare() {
        throw new Error('db down')
      },
    }
    await worker.scheduled(event as ScheduledController, { DB } as unknown as Env, ctx)
    await expect(Promise.all(pending)).resolves.toBeDefined()
    return pending.length
  }

  it('10분 Cron 은 정리 하나, 매일 Cron·빈 객체는 지금 있는 셋', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const worker = await loadWorker()
    expect(await pendingFor(worker, { cron: PURGE_CRON })).toBe(1)
    expect(await pendingFor(worker, { cron: DAILY_CRON })).toBe(3)
    expect(await pendingFor(worker, {})).toBe(3)
  })

  it('wrangler.jsonc 의 triggers.crons 에 두 상수가 글자까지 같게', () => {
    const raw = readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)), 'utf-8')
    const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')) as { triggers: { crons: string[] } }
    expect(config.triggers.crons).toContain(PURGE_CRON)
    expect(config.triggers.crons).toContain(DAILY_CRON)
    expect(PURGE_CRON).toBe('*/10 * * * *')
  })
})
