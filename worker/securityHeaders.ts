import { CSP_MODE, cspHeaders, type CspKind } from '../src/lib/cspPolicy'
import { consentFormTarget } from './oauthPages'
import { rootTarget } from './rootRoute'

export function cspKindOf(request: Request): CspKind {
  const { pathname } = new URL(request.url)
  if (/^\/(api|pub|v1|ws)\//.test(pathname)) return 'api'
  if (pathname === '/login' || pathname.startsWith('/oauth/')) return 'login'
  if (pathname === '/welcome') return 'landing'
  if (pathname === '/') return rootTarget(request) === 'landing' ? 'landing' : 'app'
  if (pathname.startsWith('/p/')) return 'app'
  return 'site'
}

export function withSecurityHeaders(response: Response, request: Request, nonce: string): Response {
  if (response.status === 101) return response
  const url = new URL(request.url)
  const kind = cspKindOf(request)
  // 이미 CSP 를 정해 둔 api 응답(이미지 프록시)은 그 머리를 그대로 둔다
  if (kind === 'api' && response.headers.has('Content-Security-Policy')) return response
  const headers = new Headers(response.headers)
  const setIfAbsent = (name: string, value: string) => {
    if (!headers.has(name)) headers.set(name, value)
  }
  setIfAbsent('X-Frame-Options', 'DENY')
  setIfAbsent('X-Content-Type-Options', 'nosniff')
  // 공개 페이지 주소에 링크 토큰이 있어 외부로 새지 않게 한다
  if (url.pathname.startsWith('/p/')) headers.set('Referrer-Policy', 'no-referrer')
  else setIfAbsent('Referrer-Policy', 'strict-origin-when-cross-origin')
  // _headers 의 site 정책이 먼저 붙어 올 수 있어 두 CSP 머리를 지우고 다시 쓴다
  headers.delete('Content-Security-Policy')
  headers.delete('Content-Security-Policy-Report-Only')
  // 동의 폼의 303 은 앱의 redirect_uri 로 간다 — 서명이 틀린 주소는 폼 없는 오류로 가 넓혀도 쓸 곳이 없다 (F-4010 4장)
  const formTarget = url.pathname === '/oauth/consent' ? consentFormTarget(url.searchParams.get('redirect_uri')) : null
  for (const [name, value] of Object.entries(cspHeaders(kind, CSP_MODE, { nonce, origin: url.origin, formTarget }))) headers.set(name, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
