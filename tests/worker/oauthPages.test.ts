// 동의·오류 화면과 그 순수 판정 (specs/features/F-4010.md 2·4·5장, A9)
import { describe, expect, it } from 'vitest'
import brand from '../../brand.config'
import {
  OAUTH_ERROR_MESSAGES,
  OAUTH_PRE_REDIRECT_ERRORS,
  consentFormTarget,
  consentRedirectAllowed,
  oauthErrorMessage,
  renderConsentPage,
  renderOAuthErrorPage,
  signedOAuthQuery,
} from '../../worker/oauthPages'

const SIGNED_NAMES = ['ba_iat', 'ba_param', 'client_id', 'exp', 'redirect_uri', 'state'].map((n) => `ba_param=${n}`).join('&')
const SIGNED = `client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&state=s&exp=9&ba_iat=8&${SIGNED_NAMES}&sig=SIG`

const NOT_FOUND = '연결하려는 앱을 찾을 수 없습니다. 앱에서 연결을 처음부터 다시 시작해 주세요.'
const BAD_REDIRECT = '앱이 알려 준 돌아갈 주소가 등록된 주소와 달라 연결을 멈췄습니다. 안전을 위해 앱으로 돌려보내지 않았습니다.'
const EXPIRED = '연결 요청 시간이 지났습니다. 앱에서 연결을 다시 시작해 주세요.'
const FALLBACK = '연결 요청을 처리하지 못했습니다. 앱에서 연결을 다시 시작해 주세요.'

describe('F-4010 A9 signedOAuthQuery', () => {
  it('sig·ba_param 과 ba_param 에 적힌 이름만 순서대로 남긴다', () => {
    expect(signedOAuthQuery(`?${SIGNED}`)).toBe(SIGNED)
    expect(signedOAuthQuery(`?return=https%3A%2F%2Fevil.example&${SIGNED}&error=access_denied`)).toBe(SIGNED)
  })

  it('sig 나 ba_param 이 없으면 null', () => {
    expect(signedOAuthQuery('')).toBeNull()
    expect(signedOAuthQuery('?return=%23%2Fd%2Fa&error=access_denied')).toBeNull()
    expect(signedOAuthQuery('?client_id=c1&sig=SIG')).toBeNull()
    expect(signedOAuthQuery(`?client_id=c1&${SIGNED_NAMES}`)).toBeNull()
  })
})

describe('F-4010 A9 consentRedirectAllowed', () => {
  it('서명 질의의 redirect_uri 와 같거나 뒤에 ?·& 가 이어질 때만', () => {
    expect(consentRedirectAllowed('https://claude.ai/cb', SIGNED)).toBe(true)
    expect(consentRedirectAllowed('https://claude.ai/cb?code=x&state=s', SIGNED)).toBe(true)
    expect(consentRedirectAllowed('https://claude.ai/cb&x=1', SIGNED)).toBe(true)
    expect(consentRedirectAllowed('https://claude.ai/cbx?code=x', SIGNED)).toBe(false)
    expect(consentRedirectAllowed('https://claude.ai/cb/../evil?code=x', SIGNED)).toBe(false)
    expect(consentRedirectAllowed('https://claude.ai.evil.example/cb?code=x', SIGNED)).toBe(false)
    expect(consentRedirectAllowed('https://evil.example/?https://claude.ai/cb', SIGNED)).toBe(false)
  })

  it('/login? · /oauth/consent? 로 시작하면 참, 그 밖 우리 주소는 거짓', () => {
    expect(consentRedirectAllowed('/login?a=1', SIGNED)).toBe(true)
    expect(consentRedirectAllowed('/oauth/consent?a=1', SIGNED)).toBe(true)
    expect(consentRedirectAllowed('/login', SIGNED)).toBe(false)
    expect(consentRedirectAllowed('/oauth/error?error=x', SIGNED)).toBe(false)
    expect(consentRedirectAllowed('//evil.example/login?a', SIGNED)).toBe(false)
  })

  it('redirect_uri 가 없는 질의는 앱 쪽 주소를 하나도 받지 않는다', () => {
    expect(consentRedirectAllowed('?code=x', 'client_id=c1&sig=S')).toBe(false)
    expect(consentRedirectAllowed('&code=x', 'client_id=c1&redirect_uri=&sig=S')).toBe(false)
    expect(consentRedirectAllowed('/login?a=1', 'client_id=c1&sig=S')).toBe(true)
  })
})

describe('F-4010 A9 consentFormTarget', () => {
  it('http(s) 는 출처, 앱 전용 스킴은 {스킴}:', () => {
    expect(consentFormTarget('https://claude.ai/api/mcp/auth_callback')).toBe('https://claude.ai')
    expect(consentFormTarget('HTTPS://Claude.AI/x')).toBe('https://claude.ai')
    expect(consentFormTarget('http://127.0.0.1:33418/callback')).toBe('http://127.0.0.1:33418')
    expect(consentFormTarget('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe('cursor:')
  })

  it('javascript·data·blob·file·못 읽음·없음은 null', () => {
    for (const uri of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,x', 'blob:https://a.example/1', 'file:///etc/passwd', 'not a url', '']) {
      expect([uri, consentFormTarget(uri)]).toEqual([uri, null])
    }
    expect(consentFormTarget(null)).toBeNull()
  })
})

describe('F-4010 A9 oauthErrorMessage', () => {
  it('5장 표대로, 모르는 값·없음은 대체 문구', () => {
    for (const code of ['invalid_client', 'client_disabled', 'unauthorized_client']) expect(oauthErrorMessage(code)).toBe(NOT_FOUND)
    expect(oauthErrorMessage('invalid_redirect')).toBe(BAD_REDIRECT)
    expect(oauthErrorMessage('request_expired')).toBe(EXPIRED)
    for (const code of ['server_error', 'invalid_request', 'toString', '__proto__', '<img src=x>', '', null]) {
      expect([code, oauthErrorMessage(code)]).toEqual([code, FALLBACK])
    }
    expect(Object.keys(OAUTH_ERROR_MESSAGES).sort()).toEqual(['client_disabled', 'invalid_client', 'invalid_redirect', 'request_expired', 'unauthorized_client'])
  })

  it('플러그인 사전 오류 코드 열하나, better-auth 콜백 코드와 겹치지 않는다', () => {
    expect([...OAUTH_PRE_REDIRECT_ERRORS].sort()).toEqual(
      [
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
      ].sort(),
    )
    for (const code of ['state_mismatch', 'state_not_found', 'invalid_callback_request', 'internal_server_error', 'access_denied', 'signup_closed']) {
      expect(OAUTH_PRE_REDIRECT_ERRORS.has(code)).toBe(false)
    }
  })
})

describe('F-4010 동의·오류 화면 틀', () => {
  it('동의 화면 — 문구·폼·이스케이프, 스크립트 없음', async () => {
    const res = renderConsentPage({ appName: '<b>A&B</b>', host: 'claude.ai', email: 'me"@example.com', oauthQuery: SIGNED })
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    const html = await res.text()
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`<title>앱 연결 · ${brand.name}</title>`)
    expect(html).toContain(`<h1>&lt;b&gt;A&amp;B&lt;/b&gt; 앱이 ${brand.name} 계정에 접근하려고 합니다</h1>`)
    expect(html).toContain('me&quot;@example.com 계정')
    for (const line of ['할 수 있는 일', '문서·폴더 목록과 본문 읽기 (공유받은 문서 포함)', '문서·폴더 만들기·고치기·옮기기', '문서·폴더를 휴지통으로 보내기', '돌아갈 곳: claude.ai']) {
      expect(html).toContain(line)
    }
    expect(html).toContain('금고 문서는 열 수 없습니다. 연결은 설정 › 연결된 앱에서 끊을 수 있습니다.')
    expect(html).toContain('<form class="oauth-consent-form" method="post" action="/api/oauth/consent">')
    expect(html).toContain(`<input type="hidden" name="oauth_query" value="${SIGNED.replace(/&/g, '&amp;')}">`)
    expect(html).toMatch(/<button[^>]*name="accept" value="yes"[^>]*>허용<\/button>/)
    expect(html).toMatch(/<button[^>]*name="accept" value="no"[^>]*>거부<\/button>/)
  })

  it('오류 화면 — 400, 문구 한 줄, 앱 열기 링크, 코드는 넣지 않는다', async () => {
    const res = renderOAuthErrorPage('<img src=x>')
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).toContain(`<title>앱 연결 · ${brand.name}</title>`)
    expect(html).toContain('<h1>앱을 연결하지 못했습니다</h1>')
    expect(html).toContain(`<p class="login-error" role="alert">${FALLBACK}</p>`)
    expect(html).toContain(`<a href="/?app=1">${brand.name} 열기</a>`)
    expect(html).not.toContain('src=x')
    expect(await renderOAuthErrorPage('invalid_redirect').text()).toContain(BAD_REDIRECT)
  })
})
