// 계정 설정 라우트 — 본인 것만, 마지막에 쓴 값이 이긴다 (small 2026-11-04)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { readJsonLimited } from './docs'
import { dayUsageStatement } from './usage'
import { ACCOUNT_PREFS_MAX_BODY_BYTES, pickAccountPrefs, validateAccountPrefs } from '../src/lib/account/accountPrefsPolicy'

// 보낸 키만 바꾸고 나머지 키는 남긴다
const UPSERT_SQL =
  'INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET prefs = json_patch(prefs, ?2), updated_at = ?3 RETURNING prefs'

const parseStored = (text: string | undefined) => {
  try {
    return pickAccountPrefs(text === undefined ? null : JSON.parse(text))
  } catch {
    return {}
  }
}

export async function handleGetUserPrefs(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const row = await env.DB.prepare('SELECT prefs FROM user_prefs WHERE user_id = ?').bind(user.id).first<{ prefs: string }>()
  return jsonResponse({ prefs: parseStored(row?.prefs) })
}

export async function handlePutUserPrefs(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, ACCOUNT_PREFS_MAX_BODY_BYTES)
  if (!parsed.ok) return parsed.reason === 'too_large' ? errorResponse('too_large', 413) : errorResponse('invalid', 400)
  const body = parsed.data
  const checked = validateAccountPrefs(typeof body === 'object' && body !== null ? (body as Record<string, unknown>).prefs : null)
  if (!checked.ok) return errorResponse('invalid', 400)
  const now = Date.now()
  const write = env.DB.prepare(UPSERT_SQL).bind(user.id, JSON.stringify(checked.prefs), now)
  const [result] = await env.DB.batch<{ prefs: string }>([write, dayUsageStatement(env.DB, user.id, now)])
  return jsonResponse({ prefs: parseStored(result.results[0]?.prefs) })
}
