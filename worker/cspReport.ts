// CSP 위반 보고 — 정규화·엔드포인트·D1 쓰기·정리 (specs/features/F-4001.md 4장)
import { readJsonLimited } from './docs'
import { errorResponse } from './http'
import { isAllowedOrigin } from './origin'

export const CSP_REPORT_MAX_BYTES = 8192
export const CSP_REPORT_MAX_ROWS = 1000
export const CSP_REPORT_RETAIN_MS = 30 * 24 * 60 * 60 * 1000
const SAME_KEY_WINDOW_MS = 60_000
const MEMORY_MAX = 500

export type CspReportRow = { page: string; directive: string; blocked: string; source: string; line: number; mode: 'enforce' | 'report' }

const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'self'])
const SITE_PATHS = ['/guides', '/changelog', '/help', '/privacy', '/terms']
const SOURCE_PATH_RE = /^\/(assets\/[^/]+|sw\.js|push-sw\.js|workbox-[^/]*\.js)$/

function pageOf(documentUri: unknown, origin: string): string | null {
  if (typeof documentUri !== 'string') return null
  let url: URL
  try {
    url = new URL(documentUri)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  const p = url.pathname
  if (p === '/') return 'root'
  if (p === '/welcome') return 'welcome'
  if (p === '/login') return 'login'
  if (p.startsWith('/p/')) return 'public'
  if (SITE_PATHS.some((s) => p === s || p.startsWith(s + '/'))) return 'site'
  return 'other'
}

function classifyUri(raw: string, origin: string): string {
  if (raw === '') return ''
  if (KEYWORDS.has(raw)) return raw
  if (raw === 'data' || raw.startsWith('data:')) return 'data'
  if (raw === 'blob' || raw.startsWith('blob:')) return 'blob'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'other'
  }
  if (url.protocol.endsWith('-extension:')) return url.protocol
  if (url.origin === origin) return 'self'
  if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return url.origin
  return 'other'
}

function sourceOf(raw: unknown, origin: string): string {
  if (typeof raw !== 'string' || raw === '') return ''
  try {
    const url = new URL(raw)
    if (url.origin === origin) return (SOURCE_PATH_RE.test(url.pathname) ? url.pathname : 'self').slice(0, 200)
  } catch {
    // 아래 분류로 넘긴다
  }
  return classifyUri(raw, origin).slice(0, 200)
}

export function normalizeCspReport(body: unknown, origin: string): CspReportRow | null {
  if (typeof body !== 'object' || body === null) return null
  const report = (body as Record<string, unknown>)['csp-report']
  if (typeof report !== 'object' || report === null) return null
  const r = report as Record<string, unknown>
  const page = pageOf(r['document-uri'], origin)
  if (page === null) return null
  const rawDirective =
    typeof r['effective-directive'] === 'string' && r['effective-directive'] !== ''
      ? r['effective-directive']
      : typeof r['violated-directive'] === 'string'
        ? r['violated-directive'].split(/\s+/)[0]
        : ''
  if (!/^[a-z-]{1,40}$/.test(rawDirective)) return null
  const disposition = r['disposition']
  if (disposition !== 'enforce' && disposition !== 'report') return null
  const blocked = classifyUri(typeof r['blocked-uri'] === 'string' ? r['blocked-uri'] : '', origin).slice(0, 200)
  const lineNumber = r['line-number']
  const line = typeof lineNumber === 'number' && Number.isInteger(lineNumber) && lineNumber >= 0 && lineNumber <= 10_000_000 ? lineNumber : 0
  return { page, directive: rawDirective, blocked, source: sourceOf(r['source-file'], origin), line, mode: disposition }
}

const recent = new Map<string, number>()

export function resetCspReportMemory(): void {
  recent.clear()
}

async function limited(request: Request, env: Env): Promise<boolean> {
  const limiter = env.WRITE_LIMITER
  if (!limiter || typeof limiter.limit !== 'function') return false
  try {
    const outcome = await limiter.limit({ key: 'csp:' + (request.headers.get('CF-Connecting-IP') ?? 'unknown') })
    return !!outcome && outcome.success === false
  } catch (err) {
    console.error('csp_report_limiter_failed', err)
    return false
  }
}

async function store(env: Env, row: CspReportRow, now: number): Promise<void> {
  const key = [row.page, row.directive, row.blocked, row.source, row.line, row.mode]
  const updated = await env.DB.prepare(
    'UPDATE csp_reports SET count = count + 1, last_at = ? WHERE page = ? AND directive = ? AND blocked = ? AND source = ? AND line = ? AND mode = ?',
  )
    .bind(now, ...key)
    .run()
  if (updated.meta.changes > 0) return
  await env.DB.prepare(
    'INSERT INTO csp_reports (page, directive, blocked, source, line, mode, count, first_at, last_at) ' +
      `SELECT ?, ?, ?, ?, ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM csp_reports) < ${CSP_REPORT_MAX_ROWS}`,
  )
    .bind(...key, now, now)
    .run()
}

export async function handleCspReport(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 405)
  const originHeader = request.headers.get('Origin')
  if (originHeader && !isAllowedOrigin(originHeader, request, env)) return errorResponse('forbidden_origin', 403)
  const type = request.headers.get('Content-Type') ?? ''
  if (!type.startsWith('application/csp-report') && !type.startsWith('application/json')) {
    return errorResponse('unsupported_media_type', 415)
  }
  const parsed = await readJsonLimited(request, CSP_REPORT_MAX_BYTES)
  if (!parsed.ok) return errorResponse(parsed.reason === 'too_large' ? 'too_large' : 'invalid_json', parsed.reason === 'too_large' ? 413 : 400)
  if (await limited(request, env)) return new Response(null, { status: 204 })
  const row = normalizeCspReport(parsed.data, new URL(request.url).origin)
  if (!row) return new Response(null, { status: 204 })
  const now = Date.now()
  const memoKey = JSON.stringify(row)
  const last = recent.get(memoKey)
  if (last !== undefined && now - last < SAME_KEY_WINDOW_MS) return new Response(null, { status: 204 })
  if (recent.size >= MEMORY_MAX) recent.clear()
  recent.set(memoKey, now)
  try {
    await store(env, row, now)
  } catch (err) {
    console.error('csp_report_store_failed', err)
  }
  return new Response(null, { status: 204 })
}

export async function cleanupCspReports(env: Env, now: number): Promise<void> {
  await env.DB.prepare('DELETE FROM csp_reports WHERE last_at < ?')
    .bind(now - CSP_REPORT_RETAIN_MS)
    .run()
}
