// /limits — 쓰기 한도 안내. 스크립트 없는 완결 HTML (specs/features/F-2147.md)
import brand from '../brand.config'
import { renderSiteFooter, renderSiteHeader, SITE_CHROME_CSS } from '../src/lib/site/siteChrome'
import { getUser } from './auth'
import { errorResponse } from './http'
import { PAGE_TOKENS_CSS } from './pageTokens'
import { DAILY_WRITE_LIMIT, secondsUntilUtcMidnight, usageOf, writesToday } from './usage'
import { MINUTE_WRITE_LIMIT } from './writeGate'

export type LimitsScope = 'minute' | 'day'
type LimitsAccount = { used: number; resetIn: number } | { blocked: true } | null

const MAX_RETRY = 86_400
const BLOCKED_LINE = '이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.'

export function parseLimitsQuery(params: URLSearchParams): { scope: LimitsScope | null; retry: number | null } {
  const rawScope = params.get('scope')
  const scope = rawScope === 'minute' || rawScope === 'day' ? rawScope : null
  if (!scope) return { scope: null, retry: null }
  const rawRetry = params.get('retry')
  const retry = rawRetry !== null && /^\d{1,5}$/.test(rawRetry) ? Number(rawRetry) : 0
  return { scope, retry: retry >= 1 && retry <= MAX_RETRY ? retry : null }
}

// day 는 cli/src/output.ts remainingTimeText 와 같은 규칙 — worker 는 cli 를 들여오지 못한다
export function waitText(seconds: number, scope: LimitsScope): string {
  if (scope === 'minute') return `${seconds}초`
  const totalMinutes = Math.max(1, Math.ceil(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`
  if (hours > 0) return `${hours}시간`
  return `${minutes}분`
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const LIMITS_CSS = `
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.6;
  word-break: keep-all;
  overflow-wrap: break-word;
  -webkit-font-smoothing: antialiased;
}
* { box-sizing: border-box; letter-spacing: var(--tracking); }
.limits {
  max-width: 420px;
  margin: 48px auto 80px;
  padding: 36px 32px;
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: var(--radius-dialog);
}
.limits h1 {
  margin: 0 0 16px;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.3;
}
.limits-rules { margin: 0 0 20px; padding-left: 20px; color: var(--ink-2); font-size: 15px; }
.limits-rules li + li { margin-top: 6px; }
.limits-wait, .limits-status { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
@media (max-width: 480px) {
  .limits { margin: 24px 16px 48px; padding: 28px 20px; }
}
`

function statusLine(account: LimitsAccount): string | null {
  if (!account) return null
  if ('blocked' in account) return BLOCKED_LINE
  const base = `지금 상태: 하루 ${account.used}/${DAILY_WRITE_LIMIT}`
  return account.used >= DAILY_WRITE_LIMIT ? `${base} · 약 ${waitText(account.resetIn, 'day')} 뒤 다시 가능` : base
}

export function renderLimitsPage(args: { scope: LimitsScope | null; retry: number | null; account: LimitsAccount }): Response {
  const title = args.scope ? '쓰기 제한에 걸렸습니다' : '쓰기 한도'
  const showWait = args.retry !== null && args.scope !== null && (args.scope === 'minute' || args.account === null)
  const waitLine = showWait ? `\n    <p class="limits-wait">약 ${waitText(args.retry!, args.scope!)} 뒤 다시 가능</p>` : ''
  const status = statusLine(args.account)
  const statusHtml = status ? `\n    <p class="limits-status">${status}</p>` : ''
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex">
    <title>${title} · ${escapeAttr(brand.name)}</title>
    <link rel="icon" href="${escapeAttr(brand.icon)}" />
    <style>
      ${PAGE_TOKENS_CSS}
${SITE_CHROME_CSS}
${LIMITS_CSS}
    </style>
  </head>
  <body>
${renderSiteHeader({ brandName: brand.name, brandIcon: brand.icon, appCta: 'link' })}
  <main class="limits">
    <h1>${title}</h1>
    <ul class="limits-rules">
      <li>1분에 ${MINUTE_WRITE_LIMIT}번, 하루 ${DAILY_WRITE_LIMIT}번까지 쓸 수 있습니다 (CLI·MCP·앱 공통)</li>
      <li>하루 횟수는 한국 시간 오전 9시(UTC 자정)에 0부터 다시 셉니다.</li>
    </ul>${waitLine}${statusHtml}
  </main>
${renderSiteFooter({ brandName: brand.name })}
  </body>
</html>
`
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

// 세션·사용량 판정이 던져도 페이지는 그린다 — 읽기만 한다
export async function handleLimitsPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  const { scope, retry } = parseLimitsQuery(new URL(request.url).searchParams)
  let account: LimitsAccount = null
  try {
    const user = await getUser(request, env)
    if (user) {
      const usage = await usageOf(env, user)
      const now = Date.now()
      account = usage.blockedAt !== null ? { blocked: true } : { used: writesToday(usage, now), resetIn: secondsUntilUtcMidnight(now) }
    }
  } catch (err) {
    console.error(err)
  }
  return renderLimitsPage({ scope, retry, account })
}
