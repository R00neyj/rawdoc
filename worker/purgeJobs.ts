// 정리 작업 비우기 — 지운 계정의 DO 방·R2 접두사를 호출 예산 안에서 차례로 (specs/features/F-2038.md 5.3~5.5)
import { purgeRoomNow } from './docRoomRpc'

// wrangler.jsonc triggers.crons 와 글자까지 같아야 한다 — 다르면 정리가 돌지 않는다 (5.5, P5)
export const DAILY_CRON = '0 18 * * *'
export const PURGE_CRON = '*/10 * * * *'

// 무료 플랜 호출당 하위 요청 50 안 (5.4 표)
export const PURGE_CALLS_ON_DELETE = 15
export const PURGE_CALLS_ON_CRON = 40

export const PURGE_STUCK_ATTEMPTS = 144
export const R2_PREFIX_GRACE_MS = 60 * 60 * 1000
const R2_BATCH = 1000
const ROOM_CONCURRENCY = 6

// 한 번 비우기의 D1 문장은 이 넷뿐이다 (P4, W8 이 이 값으로 가려 센다)
export const PURGE_SQL = {
  rooms: "SELECT target, attempts FROM purge_jobs WHERE kind = 'room' ORDER BY priority DESC LIMIT ?1",
  prefixes: "SELECT target, created_at, attempts FROM purge_jobs WHERE kind = 'r2_prefix' ORDER BY priority DESC, created_at LIMIT ?1",
  done: "DELETE FROM purge_jobs WHERE (kind, target) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))",
  failed: "UPDATE purge_jobs SET attempts = attempts + 1 WHERE (kind, target) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))",
} as const

type JobKind = 'room' | 'r2_prefix'
type JobKey = [JobKind, string]
type RoomRow = { target: string; attempts: number }
type PrefixRow = { target: string; created_at: number; attempts: number }

type BucketLike = {
  list(options: { prefix: string; limit: number }): Promise<{ objects: { key: string }[] }>
  delete(keys: string[]): Promise<void>
}

function bucketOf(env: Env): BucketLike | null {
  const bucket = (env as unknown as { BUCKET?: BucketLike }).BUCKET
  return bucket && typeof bucket.list === 'function' ? bucket : null
}

async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function lane() {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}

// 'done' = 행을 지운다, 'keep' = 남긴다(유예·예산 끝), 'failed' = attempts + 1
async function drainPrefix(bucket: BucketLike | null, row: PrefixRow, now: number, budget: { left: number }): Promise<'done' | 'keep' | 'failed'> {
  const graceOver = now - row.created_at >= R2_PREFIX_GRACE_MS
  if (!bucket) return graceOver ? 'done' : 'keep'
  try {
    while (budget.left > 0) {
      budget.left--
      const { objects } = await bucket.list({ prefix: row.target, limit: R2_BATCH })
      if (objects.length === 0) return graceOver ? 'done' : 'keep'
      if (budget.left <= 0) return 'keep'
      budget.left--
      await bucket.delete(objects.map((o) => o.key))
    }
    return 'keep'
  } catch {
    return 'failed'
  }
}

export async function runPurgeJobs(env: Env, now: number, maxCalls: number): Promise<void> {
  const done: JobKey[] = []
  const failed: { key: JobKey; attempts: number }[] = []
  const budget = { left: maxCalls }

  const { results: rooms } = await env.DB.prepare(PURGE_SQL.rooms).bind(budget.left).all<RoomRow>()
  budget.left -= rooms.length
  await runPool(rooms, ROOM_CONCURRENCY, async (row) => {
    if (await purgeRoomNow(env, row.target)) done.push(['room', row.target])
    else failed.push({ key: ['room', row.target], attempts: row.attempts })
  })

  if (budget.left > 0) {
    const { results: prefixes } = await env.DB.prepare(PURGE_SQL.prefixes).bind(budget.left).all<PrefixRow>()
    const bucket = bucketOf(env)
    for (const row of prefixes) {
      if (budget.left <= 0) break
      const outcome = await drainPrefix(bucket, row, now, budget)
      if (outcome === 'done') done.push(['r2_prefix', row.target])
      else if (outcome === 'failed') failed.push({ key: ['r2_prefix', row.target], attempts: row.attempts })
    }
  }

  if (done.length > 0) await env.DB.prepare(PURGE_SQL.done).bind(JSON.stringify(done)).run()
  if (failed.length > 0) {
    await env.DB.prepare(PURGE_SQL.failed).bind(JSON.stringify(failed.map((f) => f.key))).run()
    for (const f of failed) {
      if (f.attempts + 1 === PURGE_STUCK_ATTEMPTS) console.error('purge_job_stuck', f.key[0])
    }
  }
}
