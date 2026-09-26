// /login 페이지·복귀 주소·오류 문구 (specs/features/F-2033.md 6장, U25~U29)
import { afterEach, describe, expect, it, vi } from 'vitest'
import brand from '../brand.config'
import {
  LOGIN_ERROR_FALLBACK,
  LOGIN_ERROR_MESSAGES,
  LOGIN_RETURN_MAX,
  loginErrorMessage,
  loginReturn,
  renderLoginPage,
} from './loginPage'
import { PAGE_TOKENS_CSS } from './pageTokens'
import { renderWelcomePage } from './welcomePage'

const UNVERIFIED =
  '이메일 주소가 인증되지 않은 계정이라 로그인하지 못했습니다. Google 또는 GitHub 계정 설정에서 이메일을 인증한 뒤 다시 시도해 주세요.'
const CANCELLED = '로그인을 취소했습니다.'
const STATE = '로그인 시간이 지났거나 다른 창에서 시작한 로그인입니다. 다시 시도해 주세요.'
const FALLBACK = '로그인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.'
const SIGNUP_CLOSED = '오늘은 새 가입이 마감됐습니다. 한국 시간 오전 9시(UTC 자정)에 다시 열립니다. 그동안은 로그인 없이 쓸 수 있습니다.'

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

async function page(returnHash: string, error: string | null) {
  const res = renderLoginPage({ returnHash, error })
  return { res, html: await res.text() }
}

afterEach(() => {
  vi.doUnmock('./providerLogos')
  vi.resetModules()
})

describe('F-2033 U25 색 변수 한 벌', () => {
  it('랜딩과 로그인 페이지가 PAGE_TOKENS_CSS 를 정확히 한 번씩 담는다', async () => {
    const welcome = await renderWelcomePage().text()
    const { html: login } = await page('', null)
    expect(PAGE_TOKENS_CSS).toContain('--paper:')
    for (const html of [welcome, login]) {
      expect(count(html, PAGE_TOKENS_CSS)).toBe(1)
      expect(count(html, '--paper:')).toBe(1)
    }
  })
})

describe('F-2033 U26 loginReturn', () => {
  it('#/ 로 시작하면 그 해시로 돌아가고 실패하면 /login 으로 같은 값을 들고 간다', () => {
    expect(loginReturn('#/d/abc')).toEqual({
      hash: '#/d/abc',
      successUrl: '/#/d/abc',
      failureUrl: '/login?return=%23%2Fd%2Fabc',
    })
  })

  it('없음·빈 값·#/ 로 시작하지 않음은 앱 첫 화면', () => {
    const empty = { hash: '', successUrl: '/?app=1', failureUrl: '/login' }
    for (const raw of [null, '', 'https://evil.example', '//evil', '/d/abc', '#d/abc']) {
      expect(loginReturn(raw)).toEqual(empty)
    }
  })

  it('512자까지 받고 513자는 버린다', () => {
    expect(LOGIN_RETURN_MAX).toBe(512)
    const ok = '#/' + 'a'.repeat(510)
    expect(ok.length).toBe(512)
    expect(loginReturn(ok).hash).toBe(ok)
    expect(loginReturn(ok + 'a')).toEqual({ hash: '', successUrl: '/?app=1', failureUrl: '/login' })
  })
})

describe('F-2033 U27 로그인 페이지 틀', () => {
  it('스크립트 없는 완결 HTML, 문구·클래스·폼', async () => {
    const { res, html } = await page('#/d/"<x>', null)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(html.toLowerCase()).not.toContain('<script')
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`<title>로그인 · ${brand.name}</title>`)
    expect(html).toContain('<main class="login">')
    expect(html).toMatch(/<h1>로그인<\/h1>/)
    expect(html).toContain(
      '<p class="login-lead">Google 또는 GitHub 계정으로 로그인하면 문서가 서버에 저장되고 다른 기기에서 이어서 쓸 수 있습니다.</p>',
    )
    expect(html).toContain('<form class="login-form" method="post" action="/api/login">')
    expect(html).toContain('<input type="hidden" name="return" value="#/d/&quot;&lt;x&gt;">')
    expect(html).not.toContain('"<x>')
    expect(html).toMatch(/<button class="login-provider" type="submit" name="provider" value="google">[\s\S]*?<span>Google로 계속<\/span>/)
    expect(html).toMatch(/<button class="login-provider" type="submit" name="provider" value="github">[\s\S]*?<span>GitHub로 계속<\/span>/)
    expect(html).toContain(
      '<p class="login-note">이메일 주소가 인증된 계정만 쓸 수 있습니다. 이메일이 같으면 Google 과 GitHub 중 어느 쪽으로 들어와도 같은 계정입니다.</p>',
    )
    expect(html).toContain(
      '<p class="login-consent">계속하면 <a href="/terms">이용약관</a>과 <a href="/privacy">개인정보 처리방침</a>에 동의하는 것으로 봅니다.</p>',
    )
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('class="login-error"')
    expect(html).toContain('class="site-head"')
    expect(html).toContain('class="site-foot"')
  })

  it('main 안 순서 — 제목, 안내, 폼, 안내, 동의', async () => {
    const { html: full } = await page('', 'access_denied')
    const html = full.slice(full.indexOf('<main class="login">'))
    const order = ['<h1>', 'class="login-lead"', 'class="login-error"', 'class="login-form"', 'value="google"', 'value="github"', 'class="login-note"', 'class="login-consent"']
    const at = order.map((s) => html.indexOf(s))
    for (const i of at) expect(i).toBeGreaterThan(-1)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })
})

describe('F-2038 L2 다시 로그인 안내 줄', () => {
  const REAUTH = '<p class="login-reauth">계정 삭제를 계속하려면 다시 로그인하세요. 삭제할 계정의 Google 또는 GitHub 로 로그인해야 합니다.</p>'

  it('reauth 참이면 4.4 문장 그대로, 오류 줄보다 먼저. 스크립트 없음', async () => {
    const html = await renderLoginPage({ returnHash: '', error: null, reauth: true }).text()
    expect(html).toContain(REAUTH)
    expect(html.toLowerCase()).not.toContain('<script')
    const withError = await renderLoginPage({ returnHash: '#/d/a', error: 'access_denied', reauth: true }).text()
    expect(withError.indexOf('class="login-reauth"')).toBeLessThan(withError.indexOf('class="login-error"'))
    expect(withError.indexOf('<h1>')).toBeLessThan(withError.indexOf('class="login-reauth"'))
  })

  it('reauth 를 안 주면 login-reauth 가 없다', async () => {
    const { html } = await page('', null)
    expect(html).not.toContain('class="login-reauth"')
    const off = await renderLoginPage({ returnHash: '', error: null, reauth: false }).text()
    expect(off).not.toContain('class="login-reauth"')
  })
})

describe('F-2033 U28 오류 코드 → 문구', () => {
  it('표대로 옮기고 모르는 값은 마지막 줄', async () => {
    const table: [string, string][] = [
      ['email_not_verified', UNVERIFIED],
      ['account_not_linked', UNVERIFIED],
      ['email_not_found', UNVERIFIED],
      ['access_denied', CANCELLED],
      ['state_mismatch', STATE],
      ['state_not_found', STATE],
      ['state_invalid', STATE],
      ['state_security_mismatch', STATE],
      ['signup_closed', SIGNUP_CLOSED],
      ['bad_request', FALLBACK],
      ['provider_unavailable', FALLBACK],
      ['internal_server_error', FALLBACK],
    ]
    expect(LOGIN_ERROR_FALLBACK).toBe(FALLBACK)
    for (const [code, message] of table) {
      expect(loginErrorMessage(code)).toBe(message)
      const { html } = await page('', code)
      expect(html).toContain(`<p class="login-error" role="alert">${message}</p>`)
    }
    expect(Object.keys(LOGIN_ERROR_MESSAGES).length).toBe(9)
  })

  it('F-2028 L1 가입 마감 문구, validation_failed 는 마지막 줄', async () => {
    expect(loginErrorMessage('signup_closed')).toBe(SIGNUP_CLOSED)
    const { html } = await page('', 'signup_closed')
    expect(count(html, `<p class="login-error" role="alert">${SIGNUP_CLOSED}</p>`)).toBe(1)
    expect(html).not.toContain('signup_closed')
    expect(loginErrorMessage('validation_failed')).toBe(LOGIN_ERROR_FALLBACK)
  })

  it('error 값 자체는 화면에 넣지 않는다', async () => {
    for (const code of ['unknown_code', '<img src=x>']) {
      expect(loginErrorMessage(code)).toBe(FALLBACK)
      const { html } = await page('', code)
      expect(html).toContain(`<p class="login-error" role="alert">${FALLBACK}</p>`)
      expect(html).not.toContain(code)
      expect(html).not.toContain('&lt;img')
    }
  })

  it('없거나 빈 값이면 오류 줄이 없다', async () => {
    expect(loginErrorMessage(null)).toBeNull()
    expect(loginErrorMessage('')).toBeNull()
    const { html } = await page('', '')
    expect(html).not.toContain('class="login-error"')
    expect(html).not.toContain('role="alert"')
  })
})

describe('F-2033 U29 제공자 로고', () => {
  async function pageWithLogos(google: string, github: string) {
    vi.resetModules()
    vi.doMock('./providerLogos', () => ({ GOOGLE_LOGO_SVG: google, GITHUB_LOGO_SVG: github }))
    const mod = await import('./loginPage')
    return mod.renderLoginPage({ returnHash: '', error: null }).text()
  }

  it('로고가 있으면 버튼마다 svg 하나, 장식 속성을 덧붙이고 원본 속성은 둔다', async () => {
    const html = await pageWithLogos(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0h48v48H0z"/></svg>',
      '<svg width="24" viewBox="0 0 98 96"><path d="M0 0h98v96H0z"/></svg>',
    )
    const openTags = html.match(/<svg[^>]*>/g) ?? []
    expect(openTags.length).toBe(2)
    for (const tag of openTags) {
      expect(tag).toContain('aria-hidden="true"')
      expect(tag).toContain('focusable="false"')
      expect(tag).toContain('height="20"')
    }
    expect(openTags[0]).toContain('width="20"')
    expect(html).toContain('viewBox="0 0 48 48"')
    expect(html).toContain('<path d="M0 0h98v96H0z"/>')
    expect(html).toContain('width="24"')
    expect(html).not.toMatch(/<svg[^>]*width="24"[^>]*width="20"/)
    expect(html).toMatch(/value="google">\s*<svg[\s\S]*?<\/svg>\s*<span>Google로 계속<\/span>/)
    expect(html).toMatch(/value="github">\s*<svg[\s\S]*?<\/svg>\s*<span>GitHub로 계속<\/span>/)
  })

  it('로고가 비었으면 svg 없이 글자만', async () => {
    const html = await pageWithLogos('', '')
    expect(count(html, '<svg')).toBe(0)
    expect(html).toContain('<span>Google로 계속</span>')
    expect(html).toContain('<span>GitHub로 계속</span>')
  })
})
