// 정해진 기기들에 실제로 보내기 — 루프·이메일 단위·Worker 백그라운드. ./auth 를 import 하지 않는다 (specs/features/F-3007.md 2장)
import type { PushPayload } from '../src/lib/pushPayload'
import { readVar } from './origin'
import { listLivePushSubscriptions, loadVapid, pushResultStatements } from './pushServer'
import type { LivePushSubscription } from './pushServer'
import { createVapidAuth, sendPush } from './webPush'
import type { PushOutcome, VapidAuth } from './webPush'

export const PUSH_SEND_CONCURRENCY = 6

export type PushJob = { sub: LivePushSubscription; payload: PushPayload; topic?: string }
export type PushJobResult = { sub: LivePushSubscription; outcome: PushOutcome }

export async function sendPushJobs(jobs: readonly PushJob[], auth: VapidAuth, now: number, fetchImpl?: typeof fetch): Promise<PushJobResult[]> {
  const results: PushJobResult[] = []
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const { sub, payload, topic } = jobs[next++]
      const { outcome } = await sendPush(sub, payload, auth, now, topic, fetchImpl)
      results.push({ sub, outcome })
    }
  }
  await Promise.all(Array.from({ length: Math.min(PUSH_SEND_CONCURRENCY, jobs.length) }, worker))
  return results
}

export async function pushToEmail(db: D1Database, auth: VapidAuth, email: string, payload: PushPayload, now: number, fetchImpl?: typeof fetch): Promise<number> {
  const subs = await listLivePushSubscriptions(db, [email], now)
  if (subs.length === 0) return 0
  const results = await sendPushJobs(subs.map((sub) => ({ sub, payload })), auth, now, fetchImpl)
  const statements = results.flatMap(({ sub, outcome }) => pushResultStatements(db, sub, outcome, now))
  if (statements.length > 0) await db.batch(statements)
  return subs.length
}

export async function pushInBackground(env: Env, ctx: ExecutionContext | undefined, label: string, task: (auth: VapidAuth) => Promise<void>): Promise<void> {
  const run = async () => {
    try {
      const vapid = await loadVapid(env)
      if (vapid) await task(createVapidAuth(vapid.keys, vapid.subject))
    } catch (err) {
      console.warn(`push ${label} failed`, err)
    }
  }
  if (!readVar(env, 'VAPID_PRIVATE_JWK')) return
  if (ctx?.waitUntil) ctx.waitUntil(run())
  else await run()
}
