import { errorResponse, jsonResponse } from './http'
import { getUser, getUserRefreshing, type AuthUser } from './auth'
import { cleanupExpiredAuth, getAuth } from './authServer'
import { isAllowedOrigin, needsOriginCheck } from './origin'
import { loginReturn, renderLoginPage } from './loginPage'
import {
  handleCreateDoc,
  handleDeleteDoc,
  handleGetDoc,
  handleListDocs,
  handleMoveDocFolder,
  handleSetPinned,
  handleUpdateDoc,
} from './docs'
import { handleCreateFolder, handleDeleteFolder, handleListFolders, handleUpdateFolder } from './folders'
import { handleLockDoc, handleUnlockDoc } from './locks'
import {
  handleCreateDocLink,
  handleCreateFolderLink,
  handleDeleteDocLink,
  handleDeleteFolderLink,
  handleGetDocLink,
  handleGetDocShareSet,
  handleGetFolderLink,
  handlePublicGetDoc,
  handlePublicGetDocSet,
  handlePublicGetDocSetDoc,
  handlePublicGetFolder,
  handlePublicGetFolderDoc,
} from './links'
import {
  handleDeleteAttachment,
  handleGetAttachment,
  handleGetUsage,
  handlePublicGetAttachment,
  handlePublicGetDocSetAttachment,
  handlePublicGetFolderAttachment,
  handleUploadAttachment,
} from './attachments'
import {
  handleDeleteDocGrant,
  handleDeleteFolderGrant,
  handleGetDocGrants,
  handleGetFolderGrants,
  handleGetShared,
  handlePutDocGrant,
  handlePutFolderGrant,
} from './grants'
import { handleListShares } from './shares'
import { cleanupServerAttachments } from './attachmentGc'
import { cleanupComments } from './commentGc'
import { handleCreateToken, handleDeleteToken, handleListTokens } from './apiTokens'
import {
  handleCreateAttachmentV1,
  handleCreateDocLinkV1,
  handleCreateDocV1,
  handleCreateFolderV1,
  handleGetDocV1,
  handleListDocsV1,
  handleUpdateDocV1,
} from './v1'
import { handleDeleteE2eeKeys, handleGetE2eeKeys, handlePutE2eeKeys } from './e2eeKeys'
import { handleSetDocE2ee } from './e2eeDocs'
import { renderPublicPage } from './publicPage'
import { renderWelcomePage } from './welcomePage'
import { rootTarget, welcomeRedirect, withRootHeaders } from './rootRoute'
import { handleDocSocket } from './docSocket'
import { DOC_SOCKET_PREFIX } from '../src/lib/docRoomProtocol'
import { isWriteRoute, runWriteGate } from './writeGate'
import { usageOf } from './usage'

export { DocRoom } from './docRoom'

type RouteHandler = (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  params: Record<string, string>,
) => Promise<Response>

interface Route {
  method: string
  path: string
  handler: RouteHandler
}

// ':id' 같은 세그먼트를 params 로 뽑는다. 세그먼트 수가 다르면 매치하지 않는다
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean)
  const pathParts = pathname.split('/').filter(Boolean)
  if (patternParts.length !== pathParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i]
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(pathParts[i])
    } else if (part !== pathParts[i]) {
      return null
    }
  }
  return params
}

async function handleHealth(_request: Request, env: Env): Promise<Response> {
  try {
    await env.DB.prepare('SELECT 1').first()
    return jsonResponse({ ok: true, db: true })
  } catch (err) {
    console.error(err)
    return jsonResponse({ ok: false, db: false }, 503)
  }
}

// /api/me·/v1/me 200 몸통 — warned 는 blocked 와 무관한 원래 값 (F-2028 7.1)
async function meBody(env: Env, user: AuthUser) {
  const usage = await usageOf(env, user)
  return { id: user.id, email: user.email, blocked: usage.blockedAt !== null, warned: usage.warnedAt !== null }
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getUser(request, env)
  if (!user) return errorResponse('unauthenticated', 401)
  return jsonResponse(await meBody(env, user))
}

// GET /api/me 만 세션을 연장한다 — 만료 세션의 401 에도 쿠키 지우는 줄을 싣는다 (F-2033 3.3)
async function handleApiMe(request: Request, env: Env): Promise<Response> {
  const { user, setCookies } = await getUserRefreshing(request, env)
  const res = user ? jsonResponse(await meBody(env, user)) : errorResponse('unauthenticated', 401)
  for (const cookie of setCookies) res.headers.append('Set-Cookie', cookie)
  return res
}

function redirect(location: string, status: 302 | 303): Response {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

function withError(url: string, code: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}error=${code}`
}

// 앱의 로그인 진입 주소 — 세션이 있으면 복귀 주소, 없으면 /login (F-2033 7.3)
async function handleLogin(request: Request, env: Env): Promise<Response> {
  const target = loginReturn(new URL(request.url).searchParams.get('return'))
  const user = await getUser(request, env)
  return redirect(user ? target.successUrl : target.failureUrl, 302)
}

const MAX_LOGIN_FORM_BYTES = 4096

// /login 폼 제출 — 서버에서 signInSocial 을 불러 제공자 인증 주소로 보낸다 (F-2033 7.3)
async function handleLoginStart(request: Request, env: Env): Promise<Response> {
  const length = request.headers.get('Content-Length')
  const type = request.headers.get('Content-Type') ?? ''
  const badRequest = redirect(withError('/login', 'bad_request'), 303)
  if (!length || !/^\d+$/.test(length) || Number(length) > MAX_LOGIN_FORM_BYTES) return badRequest
  if (!type.startsWith('application/x-www-form-urlencoded')) return badRequest
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest
  }
  const rawReturn = form.get('return')
  const target = loginReturn(typeof rawReturn === 'string' ? rawReturn : null)
  const provider = form.get('provider')
  if (provider !== 'google' && provider !== 'github') return redirect(withError(target.failureUrl, 'bad_request'), 303)
  const [clientId, clientSecret] =
    provider === 'google' ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET] : [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET]
  if (!clientId || !clientSecret) {
    console.error('oauth provider not configured', provider)
    return redirect(withError(target.failureUrl, 'provider_unavailable'), 303)
  }
  try {
    // 요청 Origin 은 관문이 이미 봤다 — 빈 헤더라야 로컬에서 바뀐 Origin 이 better-auth 검사에 다시 걸리지 않는다
    const { headers, response } = await getAuth(env).api.signInSocial({
      body: { provider, callbackURL: target.successUrl, errorCallbackURL: target.failureUrl },
      headers: new Headers(),
      returnHeaders: true,
    })
    if (!response.url) throw new Error('signInSocial returned no url')
    const res = redirect(response.url, 303)
    for (const cookie of headers.getSetCookie()) res.headers.append('Set-Cookie', cookie)
    return res
  } catch (err) {
    console.error(err)
    return redirect(withError(target.failureUrl, 'internal_server_error'), 303)
  }
}

// 세션 판정이 던져도(설정 오류) 페이지는 그린다 — 버튼을 누르면 POST /api/login 이 오류 줄로 돌려보낸다 (F-2033 7.2)
async function handleLoginPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse('method_not_allowed', 405)
  const url = new URL(request.url)
  const target = loginReturn(url.searchParams.get('return'))
  let user: AuthUser | null = null
  try {
    user = await getUser(request, env)
  } catch (err) {
    console.error(err)
  }
  if (user) return redirect(target.successUrl, 302)
  return renderLoginPage({ returnHash: target.hash, error: url.searchParams.get('error') })
}

// better-auth 가 여는 경로 중 콜백 둘과 로그아웃만 넘긴다 (F-2033 7.4)
const AUTH_ROUTES = new Set(['GET /api/auth/callback/google', 'GET /api/auth/callback/github', 'POST /api/auth/sign-out'])

async function runQuietly(task: () => Promise<unknown>): Promise<void> {
  try {
    await task()
  } catch (err) {
    console.error(err)
  }
}

const routes: Route[] = [
  { method: 'GET', path: '/api/health', handler: handleHealth },
  { method: 'GET', path: '/api/me', handler: handleApiMe },
  { method: 'GET', path: '/api/login', handler: handleLogin },
  { method: 'POST', path: '/api/login', handler: handleLoginStart },
  { method: 'GET', path: '/api/docs', handler: handleListDocs },
  { method: 'POST', path: '/api/docs', handler: handleCreateDoc },
  { method: 'GET', path: '/api/docs/:id', handler: handleGetDoc },
  { method: 'PUT', path: '/api/docs/:id', handler: handleUpdateDoc },
  { method: 'DELETE', path: '/api/docs/:id', handler: handleDeleteDoc },
  { method: 'PUT', path: '/api/docs/:id/folder', handler: handleMoveDocFolder },
  { method: 'PUT', path: '/api/docs/:id/pin', handler: handleSetPinned },
  { method: 'PUT', path: '/api/docs/:id/e2ee', handler: handleSetDocE2ee },
  { method: 'GET', path: '/api/e2ee/keys', handler: handleGetE2eeKeys },
  { method: 'PUT', path: '/api/e2ee/keys', handler: handlePutE2eeKeys },
  { method: 'DELETE', path: '/api/e2ee/keys', handler: handleDeleteE2eeKeys },
  { method: 'POST', path: '/api/docs/:id/lock', handler: handleLockDoc },
  { method: 'DELETE', path: '/api/docs/:id/lock', handler: handleUnlockDoc },
  { method: 'GET', path: '/api/docs/:id/link', handler: handleGetDocLink },
  { method: 'POST', path: '/api/docs/:id/link', handler: handleCreateDocLink },
  { method: 'DELETE', path: '/api/docs/:id/link', handler: handleDeleteDocLink },
  { method: 'GET', path: '/api/docs/:id/share-set', handler: handleGetDocShareSet },
  { method: 'GET', path: '/api/folders', handler: handleListFolders },
  { method: 'POST', path: '/api/folders', handler: handleCreateFolder },
  { method: 'PUT', path: '/api/folders/:id', handler: handleUpdateFolder },
  { method: 'DELETE', path: '/api/folders/:id', handler: handleDeleteFolder },
  { method: 'GET', path: '/api/folders/:id/link', handler: handleGetFolderLink },
  { method: 'POST', path: '/api/folders/:id/link', handler: handleCreateFolderLink },
  { method: 'DELETE', path: '/api/folders/:id/link', handler: handleDeleteFolderLink },
  { method: 'GET', path: '/api/docs/:id/grants', handler: handleGetDocGrants },
  { method: 'PUT', path: '/api/docs/:id/grants/:email', handler: handlePutDocGrant },
  { method: 'DELETE', path: '/api/docs/:id/grants/:email', handler: handleDeleteDocGrant },
  { method: 'GET', path: '/api/folders/:id/grants', handler: handleGetFolderGrants },
  { method: 'PUT', path: '/api/folders/:id/grants/:email', handler: handlePutFolderGrant },
  { method: 'DELETE', path: '/api/folders/:id/grants/:email', handler: handleDeleteFolderGrant },
  { method: 'GET', path: '/api/shared', handler: handleGetShared },
  { method: 'GET', path: '/api/shares', handler: handleListShares },
  { method: 'GET', path: '/api/tokens', handler: handleListTokens },
  { method: 'POST', path: '/api/tokens', handler: handleCreateToken },
  { method: 'DELETE', path: '/api/tokens/:id', handler: handleDeleteToken },
  { method: 'GET', path: '/pub/docs/:token', handler: handlePublicGetDoc },
  { method: 'GET', path: '/pub/docs/:token/set', handler: handlePublicGetDocSet },
  { method: 'GET', path: '/pub/docs/:token/docs/:docId', handler: handlePublicGetDocSetDoc },
  {
    method: 'GET',
    path: '/pub/docs/:token/docs/:docId/attachments/:idext',
    handler: handlePublicGetDocSetAttachment,
  },
  { method: 'GET', path: '/api/usage', handler: handleGetUsage },
  { method: 'PUT', path: '/api/attachments/:idext', handler: handleUploadAttachment },
  { method: 'GET', path: '/api/attachments/:idext', handler: handleGetAttachment },
  { method: 'DELETE', path: '/api/attachments/:idext', handler: handleDeleteAttachment },
  { method: 'GET', path: '/pub/docs/:token/attachments/:idext', handler: handlePublicGetAttachment },
  { method: 'GET', path: '/pub/folders/:token', handler: handlePublicGetFolder },
  { method: 'GET', path: '/pub/folders/:token/docs/:docId', handler: handlePublicGetFolderDoc },
  {
    method: 'GET',
    path: '/pub/folders/:token/docs/:docId/attachments/:idext',
    handler: handlePublicGetFolderAttachment,
  },
  { method: 'GET', path: '/v1/docs', handler: handleListDocsV1 },
  { method: 'POST', path: '/v1/docs', handler: handleCreateDocV1 },
  { method: 'GET', path: '/v1/docs/:id', handler: handleGetDocV1 },
  { method: 'PUT', path: '/v1/docs/:id', handler: handleUpdateDocV1 },
  { method: 'GET', path: '/v1/folders', handler: handleListFolders },
  { method: 'POST', path: '/v1/folders', handler: handleCreateFolderV1 },
  { method: 'POST', path: '/v1/attachments', handler: handleCreateAttachmentV1 },
  { method: 'POST', path: '/v1/docs/:id/link', handler: handleCreateDocLinkV1 },
  { method: 'GET', path: '/v1/me', handler: handleMe },
]

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // 실시간 동기화 소켓 — JSON API 분기보다 앞에서 받는다 (F-304 4.1)
    if (url.pathname.startsWith('/ws/')) {
      const rest = url.pathname.startsWith(DOC_SOCKET_PREFIX) ? url.pathname.slice(DOC_SOCKET_PREFIX.length) : ''
      if (!rest || rest.includes('/')) return errorResponse('not_found', 404)
      let docId: string
      try {
        docId = decodeURIComponent(rest)
      } catch {
        return errorResponse('not_found', 404)
      }
      try {
        return await handleDocSocket(request, env, docId)
      } catch (err) {
        console.error(err)
        return errorResponse('internal', 500)
      }
    }

    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/pub/') && !url.pathname.startsWith('/v1/')) {
      if (url.pathname.startsWith('/p/')) {
        const publicPage = await renderPublicPage(request, env, url.pathname)
        if (publicPage) return publicPage
        // 토큰 형식 오류·폐기·없는 링크 — 앱을 준다. PublicView 가 "링크를 찾을 수 없습니다" 를 보여준다 (F-272.md 7.1)
        return env.ASSETS.fetch(new URL('/', url))
      }
      if (url.pathname === '/login') {
        return handleLoginPage(request, env)
      }
      if (url.pathname === '/welcome') {
        return welcomeRedirect()
      }
      if (url.pathname === '/') {
        if (rootTarget(request) === 'landing') {
          return withRootHeaders(renderWelcomePage())
        }
        const appRes = withRootHeaders(await env.ASSETS.fetch(request))
        // ?app=1 탈출구 응답은 중복 색인을 막는다 (2.3) — 평소 / 응답에는 붙이지 않는다
        if (url.searchParams.get('app') === '1') {
          const headers = new Headers(appRes.headers)
          headers.set('X-Robots-Tag', 'noindex')
          return new Response(appRes.body, { status: appRes.status, statusText: appRes.statusText, headers })
        }
        return appRes
      }
      return env.ASSETS.fetch(request)
    }

    try {
      if (
        url.pathname.startsWith('/api/') &&
        needsOriginCheck(request.method) &&
        !isAllowedOrigin(request.headers.get('Origin'), request, env)
      ) {
        return errorResponse('forbidden_origin', 403)
      }
      if (url.pathname.startsWith('/api/auth/')) {
        if (!AUTH_ROUTES.has(`${request.method} ${url.pathname}`)) return errorResponse('not_found', 404)
        // workerd 는 본문 없는 POST 에도 빈 body 를 붙여 better-call 이 Content-Type 없음 415 를 낸다 — 로그아웃은 본문을 읽지 않는다
        const forwarded = request.method === 'POST' ? new Request(request.url, { method: 'POST', headers: request.headers }) : request
        return await getAuth(env).handler(forwarded)
      }

      const matchingPath = routes
        .map((route) => ({ route, params: matchPath(route.path, url.pathname) }))
        .filter((m): m is { route: Route; params: Record<string, string> } => m.params !== null)
      if (matchingPath.length === 0) {
        return errorResponse('not_found', 404)
      }

      const found = matchingPath.find((m) => m.route.method === request.method)
      if (!found) {
        return errorResponse('method_not_allowed', 405)
      }

      if (isWriteRoute(request.method, found.route.path)) {
        const gateResponse = await runWriteGate(request, env)
        if (gateResponse) return gateResponse
      }

      return await found.route.handler(request, env, ctx, found.params)
    } catch (err) {
      // requireUser 는 401 Response 를 던진다 — 그대로 돌려준다
      if (err instanceof Response) return err
      console.error(err)
      return errorResponse('internal', 500)
    }
  },
  async scheduled(_event, env, ctx) {
    const now = Date.now()
    ctx.waitUntil(runQuietly(() => cleanupServerAttachments(env, now)))
    ctx.waitUntil(runQuietly(() => cleanupExpiredAuth(env, now)))
    ctx.waitUntil(runQuietly(() => cleanupComments(env, now)))
  },
} satisfies ExportedHandler<Env>
