// 사용자 CSS 라우트 — 본인 것만, 서버는 모양·크기만 본다 (specs/features/F-3010.md 3장)
import { errorResponse, jsonResponse } from './http'
import { requireUser } from './auth'
import { readJsonLimited } from './docs'
import { ifNoneMatchHits } from './notifications'
import { dayUsageStatement } from './usage'
import { USER_CSS_MAX_BODY_BYTES, USER_CSS_MAX_TOTAL_BYTES, validateUserCssSnippets } from '../src/lib/userCssPolicy'
import type { UserCssSnippet } from '../src/lib/userCssPolicy'

const INSERT_SQL =
  'INSERT INTO user_css (user_id, snippets, rev, created_at, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT(user_id) DO NOTHING'
const UPDATE_SQL = 'UPDATE user_css SET snippets = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND rev = ?'

const tooLarge = () => jsonResponse({ error: 'too_large', limit: USER_CSS_MAX_TOTAL_BYTES }, 413)

async function readRev(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT rev FROM user_css WHERE user_id = ?').bind(userId).first<{ rev: number }>()
  return row ? row.rev : null
}

export async function handleGetUserCss(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const row = await env.DB.prepare('SELECT snippets, rev FROM user_css WHERE user_id = ?')
    .bind(user.id)
    .first<{ snippets: string; rev: number }>()
  const rev = row ? row.rev : 0
  const etag = `"c1-${user.id}-${rev}"`
  if (ifNoneMatchHits(request.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'no-store' } })
  }
  const snippets = row ? (JSON.parse(row.snippets) as UserCssSnippet[]) : []
  const res = jsonResponse({ snippets, rev })
  res.headers.set('ETag', etag)
  return res
}

export async function handlePutUserCss(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  const parsed = await readJsonLimited(request, USER_CSS_MAX_BODY_BYTES)
  if (!parsed.ok) return parsed.reason === 'too_large' ? tooLarge() : errorResponse('invalid', 400)
  const body = parsed.data
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return errorResponse('invalid', 400)
  const { snippets, baseRev } = body as Record<string, unknown>

  const checked = validateUserCssSnippets(snippets)
  if (!checked.ok) return checked.error === 'too_large' ? tooLarge() : jsonResponse({ error: 'invalid', field: checked.field }, 400)
  if (!Number.isInteger(baseRev) || (baseRev as number) < 0) return jsonResponse({ error: 'invalid', field: 'baseRev' }, 400)

  const current = await readRev(env, user.id)
  const creating = current === null && baseRev === 0
  if (!creating && current !== baseRev) return jsonResponse({ error: 'conflict', rev: current ?? 0 }, 409)

  const now = Date.now()
  const json = JSON.stringify(checked.snippets)
  const write = creating
    ? env.DB.prepare(INSERT_SQL).bind(user.id, json, now, now)
    : env.DB.prepare(UPDATE_SQL).bind(json, now, user.id, baseRev)
  const [result] = await env.DB.batch([write, dayUsageStatement(env.DB, user.id, now)])
  if (result.meta.changes !== 1) return jsonResponse({ error: 'conflict', rev: (await readRev(env, user.id)) ?? 0 }, 409)
  return jsonResponse({ rev: creating ? 1 : (baseRev as number) + 1 })
}
