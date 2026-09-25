// 금고 키 묶음 라우트 — 본인 것만, 서버는 크기만 본다 (specs/features/F-401.md 3.1, F-400.md 2.3)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { readJsonLimited } from './docs'
import { dayUsageStatement, utf8Bytes } from './usage'
import { E2EE_BUNDLE_MAX_BYTES } from '../src/lib/e2eeLimits'

// 묶음 JSON 이 JSON 문자열 안에 들어가면 이스케이프로 두 배 가까이 늘어난다 (3.1)
const MAX_KEYS_BODY_BYTES = 16_384

const INSERT_SQL =
  'INSERT INTO e2ee_keys (user_id, bundle, rev, created_at, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(user_id) DO NOTHING'
const UPDATE_SQL = 'UPDATE e2ee_keys SET bundle = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND rev = ?'
const E2EE_COUNTS_SQL =
  'SELECT (SELECT COUNT(*) FROM docs WHERE owner_id = ?1 AND e2ee_key IS NOT NULL) AS docs, (SELECT COUNT(*) FROM folders WHERE owner_id = ?1 AND e2ee = 1) AS folders'
const DELETE_SQL =
  'DELETE FROM e2ee_keys WHERE user_id = ?1 AND NOT EXISTS (SELECT 1 FROM docs WHERE owner_id = ?1 AND e2ee_key IS NOT NULL) AND NOT EXISTS (SELECT 1 FROM folders WHERE owner_id = ?1 AND e2ee = 1)'

function tooLarge(): Response {
  return jsonResponse({ error: 'too_large', limit: E2EE_BUNDLE_MAX_BYTES }, 413)
}

async function readRev(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT rev FROM e2ee_keys WHERE user_id = ?').bind(userId).first<{ rev: number }>()
  return row ? row.rev : null
}

async function e2eeNotEmpty(env: Env, userId: string): Promise<Response | null> {
  const counts = await env.DB.prepare(E2EE_COUNTS_SQL).bind(userId).first<{ docs: number; folders: number }>()
  if (!counts || (counts.docs === 0 && counts.folders === 0)) return null
  return jsonResponse({ error: 'vault_not_empty', docs: counts.docs, folders: counts.folders }, 409)
}

export async function handleGetE2eeKeys(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const row = await env.DB.prepare('SELECT bundle, rev FROM e2ee_keys WHERE user_id = ?')
    .bind(user.id)
    .first<{ bundle: string; rev: number }>()
  if (!row) return errorResponse('no_vault', 404)
  return jsonResponse({ bundle: row.bundle, rev: row.rev })
}

export async function handlePutE2eeKeys(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, MAX_KEYS_BODY_BYTES)
  if (!parsed.ok) return parsed.reason === 'too_large' ? tooLarge() : errorResponse('invalid', 400)
  const body = parsed.data
  if (typeof body !== 'object' || body === null) return errorResponse('invalid', 400)
  const { bundle, baseRev } = body as Record<string, unknown>

  if (typeof bundle !== 'string' || bundle.length === 0) return jsonResponse({ error: 'invalid', field: 'bundle' }, 400)
  if (utf8Bytes(bundle) > E2EE_BUNDLE_MAX_BYTES) return tooLarge()
  if (!Number.isInteger(baseRev) || (baseRev as number) < 0) return jsonResponse({ error: 'invalid', field: 'baseRev' }, 400)

  // 409 사전 검사는 batch 전 — 하루 카운터가 오르지 않는다 (F-2025 6장)
  const current = await readRev(env, user.id)
  const creating = current === null && baseRev === 0
  if (!creating && current !== baseRev) return jsonResponse({ error: 'conflict', rev: current ?? 0 }, 409)

  const now = Date.now()
  const write = creating
    ? env.DB.prepare(INSERT_SQL).bind(user.id, bundle, now, now)
    : env.DB.prepare(UPDATE_SQL).bind(bundle, now, user.id, baseRev)
  const [result] = await env.DB.batch([write, dayUsageStatement(env.DB, user.id, now)])
  // 두 기기가 동시에 바꾸면 한쪽은 0행 — 하루는 이미 +1 이다 (F-401 r3)
  if (result.meta.changes !== 1) return jsonResponse({ error: 'conflict', rev: (await readRev(env, user.id)) ?? 0 }, 409)
  return jsonResponse({ rev: creating ? 1 : (baseRev as number) + 1 })
}

export async function handleDeleteE2eeKeys(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  if ((await readRev(env, user.id)) === null) return new Response(null, { status: 204 })
  const busy = await e2eeNotEmpty(env, user.id)
  if (busy) return busy

  const [result] = await env.DB.batch([env.DB.prepare(DELETE_SQL).bind(user.id), dayUsageStatement(env.DB, user.id, Date.now())])
  if (result.meta.changes !== 1) {
    const raced = await e2eeNotEmpty(env, user.id)
    if (raced) return raced
  }
  return new Response(null, { status: 204 })
}
