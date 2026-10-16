// 앱 연결 — /login 이어가기 갈래, 동의 화면·제출, 오류 화면 (specs/features/F-4010.md 3~5장)
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider'
import { getUser } from './auth'
import { getAuth } from './authServer'
import { errorResponse } from './http'
import { renderLoginPage, type LoginReturn } from './loginPage'
import { clientLabel } from './oauthClientLabel'
import {
  OAUTH_PRE_REDIRECT_ERRORS,
  consentRedirectAllowed,
  renderConsentPage,
  renderOAuthErrorPage,
  signedOAuthQuery,
} from './oauthPages'
import { readVar } from './origin'

// 상태 쿠키 4,096B 한도 아래로 잡은 값 — 실측 q 870자(오류 주소 포함)·1,756자에서 한도에 닿는다 (근거, 3장)
const OAUTH_QUERY_MAX = 1700
const ERROR_CALLBACK_QUERY_MAX = 850
const MAX_CONSENT_FORM_BYTES = 4096

export const OAUTH_EXPIRED_PATH = '/oauth/error?error=request_expired'

function redirect(location: string, status: 302 | 303): Response {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

// 비밀이 없으면 서명을 못 만든다 — 던지면 무효로 본다
export async function isLiveOAuthQuery(query: string, env: Env): Promise<boolean> {
  if (query.length > OAUTH_QUERY_MAX) return false
  try {
    return await verifyOAuthQueryParams(query, env.BETTER_AUTH_SECRET)
  } catch {
    return false
  }
}

// POST /api/login 의 OAuth 갈래 — 성공은 플러그인이 동의 화면으로 돌리고, 실패는 이어가기를 들고 /login 으로 (3장)
export function oauthLoginReturn(query: string): LoginReturn {
  return { hash: '', successUrl: '/?app=1', failureUrl: query.length <= ERROR_CALLBACK_QUERY_MAX ? `/login?${query}` : '/login' }
}

// /login 의 OAuth 갈래 — null 이면 지금 흐름 그대로. 플러그인은 다시 로그인이 필요할 때만 이리 보내 세션을 보지 않는다 (3장 ①~③)
export async function handleOAuthLoginPage(url: URL, env: Env): Promise<Response | null> {
  const query = signedOAuthQuery(url.search)
  const error = url.searchParams.get('error')
  if (query === null) return error && OAUTH_PRE_REDIRECT_ERRORS.has(error) ? redirect(`/oauth/error?error=${error}`, 302) : null
  if (!(await isLiveOAuthQuery(query, env))) return redirect(OAUTH_EXPIRED_PATH, 302)
  return renderLoginPage({ returnHash: '', error, oauthQuery: query })
}

async function publicClientName(request: Request, env: Env, clientId: string): Promise<string | null | undefined> {
  const api: Record<string, unknown> = getAuth(env).api
  const getClient = api.getOAuthClientPublic
  if (typeof getClient !== 'function') throw new Error('oauth-provider 플러그인 없음')
  try {
    const client: unknown = await getClient({ query: { client_id: clientId }, headers: request.headers })
    if (!client || typeof client !== 'object') return undefined
    return 'client_name' in client && typeof client.client_name === 'string' ? client.client_name : null
  } catch {
    return undefined
  }
}

export async function handleConsentPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  const query = signedOAuthQuery(new URL(request.url).search)
  if (query === null || !(await isLiveOAuthQuery(query, env))) return redirect(OAUTH_EXPIRED_PATH, 302)
  const user = await getUser(request, env)
  if (!user) return redirect(`/login?${query}`, 302)
  const params = new URLSearchParams(query)
  const name = await publicClientName(request, env, params.get('client_id') ?? '')
  if (name === undefined) return redirect('/oauth/error?error=invalid_client', 302)
  const label = clientLabel({ name, redirectUris: [] }, params.get('redirect_uri') ?? undefined)
  return renderConsentPage({ appName: label.name, host: label.host, email: user.email, oauthQuery: query })
}

function consentRedirectUrl(body: unknown): string | null {
  return body && typeof body === 'object' && 'url' in body && typeof body.url === 'string' ? body.url : null
}

// Origin 관문을 지난 뒤에만 온다 — 교차 사이트 자동 제출로 남의 앱에 동의시키지 못하게 (4장)
export async function handleConsentSubmit(request: Request, env: Env): Promise<Response> {
  const invalid = redirect('/oauth/error?error=invalid_request', 303)
  const length = request.headers.get('Content-Length')
  if (!length || !/^\d+$/.test(length) || Number(length) > MAX_CONSENT_FORM_BYTES) return invalid
  if (!(request.headers.get('Content-Type') ?? '').startsWith('application/x-www-form-urlencoded')) return invalid
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return invalid
  }
  const accept = form.get('accept')
  if (accept !== 'yes' && accept !== 'no') return invalid
  const query = form.get('oauth_query')
  if (typeof query !== 'string' || !(await isLiveOAuthQuery(query, env))) return redirect(OAUTH_EXPIRED_PATH, 303)

  // authorize 는 ctx.request 가 없으면 401 이라 auth.api 직접 호출로는 안 된다 (근거)
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' })
  for (const name of ['Cookie', 'Origin']) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  const inner = new Request(new URL('/api/auth/oauth2/consent', readVar(env, 'BETTER_AUTH_URL')), {
    method: 'POST',
    headers,
    body: JSON.stringify({ accept: accept === 'yes', oauth_query: query }),
  })
  const res = await getAuth(env).handler(inner)
  if (res.status === 401) return redirect(`/login?${query}`, 303)
  const url = res.status === 200 ? consentRedirectUrl(await res.json()) : null
  if (url && consentRedirectAllowed(url, query)) return redirect(url, 303)
  console.error('oauth consent failed', res.status)
  return redirect('/oauth/error?error=server_error', 303)
}

export function handleOAuthErrorPage(request: Request): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  return renderOAuthErrorPage(new URL(request.url).searchParams.get('error'))
}
