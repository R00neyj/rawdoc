// /login — 스크립트 없는 완결 HTML, 복귀 주소 규칙, 오류 코드 → 문구 (specs/features/F-2033.md 6장, F-2032.md 3.2~3.4)
import brand from '../brand.config'
import { renderSiteFooter, renderSiteHeader, SITE_CHROME_CSS } from '../src/lib/siteChrome'
import { PAGE_TOKENS_CSS } from './pageTokens'
import { GITHUB_LOGO_SVG, GOOGLE_LOGO_SVG } from './providerLogos'

// oauth_state 쿠키에 두 번 들어가 브라우저 쿠키 한도 4,096바이트 안에 머무는 길이 (F-2032 3.2)
export const LOGIN_RETURN_MAX = 512

export type LoginReturn = { hash: string; successUrl: string; failureUrl: string }

export function loginReturn(raw: string | null): LoginReturn {
  if (raw && raw.startsWith('#/') && raw.length <= LOGIN_RETURN_MAX) {
    return { hash: raw, successUrl: `/${raw}`, failureUrl: `/login?return=${encodeURIComponent(raw)}` }
  }
  return { hash: '', successUrl: '/?app=1', failureUrl: '/login' }
}

const UNVERIFIED =
  '이메일 주소가 인증되지 않은 계정이라 로그인하지 못했습니다. Google 또는 GitHub 계정 설정에서 이메일을 인증한 뒤 다시 시도해 주세요.'
const STATE_LOST = '로그인 시간이 지났거나 다른 창에서 시작한 로그인입니다. 다시 시도해 주세요.'

// F-2028 이 signup_closed 한 줄을 더할 자리 (2.5)
export const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  email_not_verified: UNVERIFIED,
  account_not_linked: UNVERIFIED,
  email_not_found: UNVERIFIED,
  access_denied: '로그인을 취소했습니다.',
  state_mismatch: STATE_LOST,
  state_not_found: STATE_LOST,
  state_invalid: STATE_LOST,
  state_security_mismatch: STATE_LOST,
}

export const LOGIN_ERROR_FALLBACK = '로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'

// error 값 자체는 화면에 넣지 않는다 (6.2)
export function loginErrorMessage(code: string | null): string | null {
  if (!code) return null
  return Object.hasOwn(LOGIN_ERROR_MESSAGES, code) ? LOGIN_ERROR_MESSAGES[code] : LOGIN_ERROR_FALLBACK
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const LOGO_ATTRS: [string, string][] = [
  ['aria-hidden', 'true'],
  ['width', '20'],
  ['height', '20'],
  ['focusable', 'false'],
]

// 원본 속성은 지우지 않고, 원본에 없는 장식 속성만 여는 태그에 덧붙인다 (6.4)
function decorateLogo(svg: string): string {
  const open = /<svg\b[^>]*>/i.exec(svg)
  if (!open) return ''
  const tag = open[0]
  const selfClosing = tag.endsWith('/>')
  const head = tag.slice(0, selfClosing ? -2 : -1)
  const extra = LOGO_ATTRS.filter(([name]) => !new RegExp(`\\s${name}\\s*=`, 'i').test(head))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join('')
  const decorated = `${head}${extra}${selfClosing ? '/>' : '>'}`
  return svg.slice(0, open.index) + decorated + svg.slice(open.index + tag.length)
}

function providerButton(provider: 'google' | 'github', label: string, logo: string): string {
  const icon = logo ? `\n        ${decorateLogo(logo)}` : ''
  return `<button class="login-provider" type="submit" name="provider" value="${provider}">${icon}
        <span>${label}</span>
      </button>`
}

const LOGIN_CSS = `
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
.login {
  max-width: 420px;
  margin: 48px auto 80px;
  padding: 36px 32px;
  background: var(--panel);
  border: 1px solid var(--rule);
  border-radius: var(--radius-dialog);
}
.login h1 {
  margin: 0 0 12px;
  font-family: var(--font-display);
  font-size: 26px;
  line-height: 1.3;
}
.login-lead { margin: 0 0 24px; color: var(--ink-2); font-size: 15px; }
.login-error {
  margin: 0 0 20px;
  padding: 10px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--rule));
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--accent) 7%, var(--panel));
  font-size: 14px;
}
.login-form { display: flex; flex-direction: column; gap: 12px; margin: 0; }
.login-provider {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--panel);
  color: var(--ink);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.login-provider:hover { background: color-mix(in srgb, var(--ink) 4%, var(--panel)); }
.login-provider:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.login-provider svg { width: 20px; height: 20px; flex: none; }
.login-note { margin: 20px 0 0; color: var(--ink-2); font-size: 13px; }
.login-consent { margin: 12px 0 0; color: var(--muted); font-size: 13px; }
.login-consent a { color: var(--ink-2); }
@media (max-width: 480px) {
  .login { margin: 24px 16px 48px; padding: 28px 20px; }
}
`

export function renderLoginPage(args: { returnHash: string; error: string | null }): Response {
  const message = loginErrorMessage(args.error)
  const errorLine = message ? `\n    <p class="login-error" role="alert">${message}</p>` : ''
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex">
    <title>로그인 · ${escapeAttr(brand.name)}</title>
    <link rel="icon" href="${escapeAttr(brand.icon)}" />
    <style>
      ${PAGE_TOKENS_CSS}
${SITE_CHROME_CSS}
${LOGIN_CSS}
    </style>
  </head>
  <body>
${renderSiteHeader({ brandName: brand.name, brandIcon: brand.icon, appCta: 'link' })}
  <main class="login">
    <h1>로그인</h1>
    <p class="login-lead">Google 또는 GitHub 계정으로 로그인하면 문서가 서버에 저장되고 다른 기기에서 이어서 쓸 수 있습니다.</p>${errorLine}
    <form class="login-form" method="post" action="/api/login">
      <input type="hidden" name="return" value="${escapeAttr(args.returnHash)}">
      ${providerButton('google', 'Google로 계속', GOOGLE_LOGO_SVG)}
      ${providerButton('github', 'GitHub로 계속', GITHUB_LOGO_SVG)}
    </form>
    <p class="login-note">이메일 주소가 인증된 계정만 쓸 수 있습니다. 이메일이 같으면 Google 과 GitHub 중 어느 쪽으로 들어와도 같은 계정입니다.</p>
    <p class="login-consent">계속하면 <a href="/terms">이용약관</a>과 <a href="/privacy">개인정보 처리방침</a>에 동의하는 것으로 봅니다.</p>
  </main>
${renderSiteFooter({ brandName: brand.name })}
  </body>
</html>
`
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
  })
}
