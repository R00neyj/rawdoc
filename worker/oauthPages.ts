// 앱 연결 동의·오류 화면과 그 순수 판정 (specs/features/F-4010.md 2·4·5장)
import brand from '../brand.config'
import { escapeAttr, renderAuthPage } from './loginPage'

const NOT_FOUND = '연결하려는 앱을 찾을 수 없습니다. 앱에서 연결을 처음부터 다시 시작해 주세요.'

export const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  invalid_client: NOT_FOUND,
  client_disabled: NOT_FOUND,
  unauthorized_client: NOT_FOUND,
  invalid_redirect: '앱이 알려 준 돌아갈 주소가 등록된 주소와 달라 연결을 멈췄습니다. 안전을 위해 앱으로 돌려보내지 않았습니다.',
  request_expired: '연결 요청 시간이 지났습니다. 앱에서 연결을 다시 시작해 주세요.',
}

const OAUTH_ERROR_FALLBACK = '연결 요청을 처리하지 못했습니다. 앱에서 연결을 다시 시작해 주세요.'

// error 값 자체는 화면에 넣지 않는다 (F-2033 6.2)
export function oauthErrorMessage(code: string | null): string {
  return code && Object.hasOwn(OAUTH_ERROR_MESSAGES, code) ? OAUTH_ERROR_MESSAGES[code] : OAUTH_ERROR_FALLBACK
}

// 플러그인이 앱으로 돌려보내기 전에 onAPIError.errorURL(/login)로 보내는 코드 — better-auth 콜백 코드와 겹치지 않는다
export const OAUTH_PRE_REDIRECT_ERRORS: ReadonlySet<string> = new Set([
  'invalid_client',
  'client_disabled',
  'unauthorized_client',
  'invalid_redirect',
  'unsupported_response_type',
  'unsupported_prompt_select_account',
  'invalid_request',
  'invalid_target',
  'request_not_supported',
  'request_uri_not_supported',
  'invalid_request_uri',
])

// 플러그인 buildSignedOAuthQuery 와 같은 규칙 — 서명 밖 이름(return·error 등)은 버린다
export function signedOAuthQuery(search: string): string | null {
  const params = new URLSearchParams(search)
  const names = new Set(params.getAll('ba_param'))
  if (!params.has('sig') || names.size === 0) return null
  const signed = new URLSearchParams()
  for (const [key, value] of params) {
    if (key === 'sig' || key === 'ba_param' || names.has(key)) signed.append(key, value)
  }
  return signed.toString()
}

export function consentRedirectAllowed(url: string, signedQuery: string): boolean {
  if (url.startsWith('/login?') || url.startsWith('/oauth/consent?')) return true
  const redirectUri = new URLSearchParams(signedQuery).get('redirect_uri')
  if (!redirectUri) return false
  return url === redirectUri || url.startsWith(`${redirectUri}?`) || url.startsWith(`${redirectUri}&`)
}

const UNSAFE_FORM_SCHEMES = new Set(['javascript:', 'data:', 'blob:', 'file:'])

// 동의 폼 303 이 가는 앱 출처 — CSP form-action 끝에 붙는다 (4장)
export function consentFormTarget(redirectUri: string | null): string | null {
  if (!redirectUri) return null
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    return null
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin
  return UNSAFE_FORM_SCHEMES.has(parsed.protocol) ? null : parsed.protocol
}

const OAUTH_CSS = `
.oauth-account { margin: 0 0 20px; color: var(--ink-2); font-size: 15px; }
.oauth-scope-title { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
.oauth-scopes { margin: 0 0 20px; padding-left: 20px; font-size: 15px; }
.oauth-scopes li + li { margin-top: 4px; }
.oauth-return { margin: 0 0 8px; font-size: 14px; }
.oauth-note { margin: 0 0 24px; color: var(--ink-2); font-size: 13px; }
.oauth-consent-form { display: flex; gap: 12px; margin: 0; }
.oauth-consent-form .login-provider { flex: 1; }
.oauth-consent-form .oauth-allow { background: var(--accent); border-color: var(--accent); color: var(--paper); }
.oauth-consent-form .oauth-allow:hover { background: color-mix(in srgb, var(--ink) 12%, var(--accent)); }
.oauth-open { margin: 20px 0 0; font-size: 15px; }
.oauth-open a { color: var(--ink); }
`

export function renderConsentPage(args: { appName: string; host: string; email: string; oauthQuery: string }): Response {
  const product = escapeAttr(brand.name)
  return renderAuthPage({
    title: '앱 연결',
    status: 200,
    css: OAUTH_CSS,
    main: `
    <h1>${escapeAttr(args.appName)} 앱이 ${product} 계정에 접근하려고 합니다</h1>
    <p class="oauth-account">${escapeAttr(args.email)} 계정</p>
    <p class="oauth-scope-title">할 수 있는 일</p>
    <ul class="oauth-scopes">
      <li>문서·폴더 목록과 본문 읽기 (공유받은 문서 포함)</li>
      <li>문서·폴더 만들기·고치기·옮기기</li>
      <li>문서·폴더를 휴지통으로 보내기</li>
    </ul>
    <p class="oauth-return">돌아갈 곳: ${escapeAttr(args.host)}</p>
    <p class="oauth-note">금고 문서는 열 수 없습니다. 연결은 설정 › 연결된 앱에서 끊을 수 있습니다.</p>
    <form class="oauth-consent-form" method="post" action="/api/oauth/consent">
      <input type="hidden" name="oauth_query" value="${escapeAttr(args.oauthQuery)}">
      <button class="login-provider" type="submit" name="accept" value="no">거부</button>
      <button class="login-provider oauth-allow" type="submit" name="accept" value="yes">허용</button>
    </form>`,
  })
}

export function renderOAuthErrorPage(code: string | null): Response {
  return renderAuthPage({
    title: '앱 연결',
    status: 400,
    css: OAUTH_CSS,
    main: `
    <h1>앱을 연결하지 못했습니다</h1>
    <p class="login-error" role="alert">${oauthErrorMessage(code)}</p>
    <p class="oauth-open"><a href="/?app=1">${escapeAttr(brand.name)} 열기</a></p>`,
  })
}
