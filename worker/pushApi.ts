// 웹 푸시 구독 API 넷 — 검사 순서가 계약이다 (specs/features/F-3003.md 5.2)
import { jsonResponse } from './http'
import { requireUser } from './auth'
import { readJsonLimited } from './docs'
import { dayUsageStatement } from './usage'
import { findLivePushSubscription, loadVapid, pushResultStatements } from './pushServer'
import { PUSH_ENDPOINT_MAX_CHARS, createVapidAuth, isAllowedPushEndpoint, readPushKeys, sendPush } from './webPush'
import { PUSH_SUBSCRIPTIONS_PER_USER_MAX } from '../src/lib/pushPayload'
import { testPushPayload } from '../src/lib/pushText'
import { PUSH_API_MAX_BODY_BYTES, type PushApiError, type PushKeyResponse } from '../src/lib/pushApi'

const noContent = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
const fail = (body: PushApiError, status: number) => jsonResponse(body, status)
const unavailable = () => fail({ error: 'push_unavailable' }, 503)
const badEndpoint = () => fail({ error: 'invalid', field: 'endpoint' }, 400)

type Parsed = { ok: true; body: Record<string, unknown> } | { ok: false; response: Response }

async function readBody(request: Request): Promise<Parsed> {
  const parsed = await readJsonLimited(request, PUSH_API_MAX_BODY_BYTES)
  if (!parsed.ok) {
    if (parsed.reason === 'too_large') return { ok: false, response: fail({ error: 'too_large', limit: 2048 }, 413) }
    return { ok: false, response: fail({ error: 'invalid' }, 400) }
  }
  const data = parsed.data
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, response: fail({ error: 'invalid' }, 400) }
  return { ok: true, body: data as Record<string, unknown> }
}

function readEndpoint(body: Record<string, unknown>): string | null {
  const { endpoint } = body
  return typeof endpoint === 'string' && endpoint.length > 0 && endpoint.length <= PUSH_ENDPOINT_MAX_CHARS ? endpoint : null
}

export async function handleGetPushKey(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env)
  const vapid = await loadVapid(env)
  if (!vapid) return unavailable()
  const body: PushKeyResponse = { publicKey: vapid.keys.publicKey }
  return jsonResponse(body)
}

const UPSERT_SQL = `INSERT INTO push_subscriptions (id, user_id, session_id, endpoint, p256dh, auth, created_at, last_ok_at, fail_count)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 0)
ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, session_id = excluded.session_id, p256dh = excluded.p256dh,
  auth = excluded.auth, created_at = excluded.created_at, last_ok_at = NULL, fail_count = 0`

const TRIM_SQL = `DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint != ?2 AND id NOT IN (
  SELECT id FROM push_subscriptions WHERE user_id = ?1 AND endpoint != ?2
  ORDER BY COALESCE(last_ok_at, created_at) DESC, id DESC LIMIT ?3)`

export async function handlePutPushSubscription(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if (!(await loadVapid(env))) return unavailable()
  const parsed = await readBody(request)
  if (!parsed.ok) return parsed.response
  const endpoint = readEndpoint(parsed.body)
  if (endpoint === null) return badEndpoint()
  try {
    new URL(endpoint)
  } catch {
    return badEndpoint()
  }
  if (!isAllowedPushEndpoint(endpoint)) return fail({ error: 'unsupported_push_service' }, 400)
  const { keys } = parsed.body
  const { p256dh, auth } = (typeof keys === 'object' && keys !== null ? keys : {}) as Record<string, unknown>
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !(await readPushKeys(p256dh, auth))) {
    return fail({ error: 'invalid', field: 'keys' }, 400)
  }
  const now = Date.now()
  const db = env.DB
  await db.batch([
    db.prepare(UPSERT_SQL).bind(crypto.randomUUID(), user.id, user.sessionId ?? null, endpoint, p256dh, auth, now),
    db.prepare(TRIM_SQL).bind(user.id, endpoint, PUSH_SUBSCRIPTIONS_PER_USER_MAX - 1),
    dayUsageStatement(db, user.id, now),
  ])
  return noContent()
}

export async function handleDeletePushSubscription(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readBody(request)
  if (!parsed.ok) return parsed.response
  const endpoint = readEndpoint(parsed.body)
  if (endpoint === null) return badEndpoint()
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?1 AND endpoint = ?2').bind(user.id, endpoint).run()
  return noContent()
}

export async function handlePostPushTest(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const vapid = await loadVapid(env)
  if (!vapid) return unavailable()
  const parsed = await readBody(request)
  if (!parsed.ok) return parsed.response
  const endpoint = readEndpoint(parsed.body)
  if (endpoint === null) return badEndpoint()
  const now = Date.now()
  const target = await findLivePushSubscription(env.DB, user.id, endpoint, now)
  if (!target) return fail({ error: 'not_found' }, 404)
  const result = await sendPush(target, testPushPayload(), createVapidAuth(vapid.keys, vapid.subject), now)
  await env.DB.batch([...pushResultStatements(env.DB, target, result.outcome, now), dayUsageStatement(env.DB, user.id, now)])
  if (result.outcome === 'sent') return noContent()
  return fail({ error: 'push_failed', status: result.status }, 502)
}
