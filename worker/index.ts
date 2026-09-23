import { errorResponse, jsonResponse } from './http'
import { getUser } from './auth'
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
import { handleCreateToken, handleDeleteToken, handleListTokens } from './apiTokens'
import { handleCreateAttachmentV1, handleCreateDocLinkV1, handleCreateDocV1, handleUpdateDocV1 } from './v1'
import { renderPublicPage } from './publicPage'
import { renderWelcomePage } from './welcomePage'
import { rootTarget, welcomeRedirect, withRootHeaders } from './rootRoute'
import { handleDocSocket } from './docSocket'
import { DOC_SOCKET_PREFIX } from '../src/lib/docRoomProtocol'

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

async function handleMe(request: Request, env: Env): Promise<Response> {
  const user = await getUser(request, env)
  if (!user) return errorResponse('unauthenticated', 401)
  return jsonResponse({ id: user.id, email: user.email })
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const user = await getUser(request, env)
  if (!user) return errorResponse('unauthenticated', 401)
  const url = new URL(request.url)
  const returnTo = url.searchParams.get('return') ?? ''
  const location = returnTo.startsWith('#/') ? `/${returnTo}` : '/'
  return new Response(null, { status: 302, headers: { Location: location } })
}

const routes: Route[] = [
  { method: 'GET', path: '/api/health', handler: handleHealth },
  { method: 'GET', path: '/api/me', handler: handleMe },
  { method: 'GET', path: '/api/login', handler: handleLogin },
  { method: 'GET', path: '/api/docs', handler: handleListDocs },
  { method: 'POST', path: '/api/docs', handler: handleCreateDoc },
  { method: 'GET', path: '/api/docs/:id', handler: handleGetDoc },
  { method: 'PUT', path: '/api/docs/:id', handler: handleUpdateDoc },
  { method: 'DELETE', path: '/api/docs/:id', handler: handleDeleteDoc },
  { method: 'PUT', path: '/api/docs/:id/folder', handler: handleMoveDocFolder },
  { method: 'PUT', path: '/api/docs/:id/pin', handler: handleSetPinned },
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
  { method: 'GET', path: '/pub/docs/:token/attachments/:idext', handler: handlePublicGetAttachment },
  { method: 'GET', path: '/pub/folders/:token', handler: handlePublicGetFolder },
  { method: 'GET', path: '/pub/folders/:token/docs/:docId', handler: handlePublicGetFolderDoc },
  {
    method: 'GET',
    path: '/pub/folders/:token/docs/:docId/attachments/:idext',
    handler: handlePublicGetFolderAttachment,
  },
  { method: 'GET', path: '/v1/docs', handler: handleListDocs },
  { method: 'POST', path: '/v1/docs', handler: handleCreateDocV1 },
  { method: 'GET', path: '/v1/docs/:id', handler: handleGetDoc },
  { method: 'PUT', path: '/v1/docs/:id', handler: handleUpdateDocV1 },
  { method: 'GET', path: '/v1/folders', handler: handleListFolders },
  { method: 'POST', path: '/v1/folders', handler: handleCreateFolder },
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

      return await found.route.handler(request, env, ctx, found.params)
    } catch (err) {
      // requireUser 는 401 Response 를 던진다 — 그대로 돌려준다
      if (err instanceof Response) return err
      console.error(err)
      return errorResponse('internal', 500)
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanupServerAttachments(env, Date.now()))
  },
} satisfies ExportedHandler<Env>
