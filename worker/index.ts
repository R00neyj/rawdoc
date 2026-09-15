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
import {
  handleCreateDocLink,
  handleCreateFolderLink,
  handleDeleteDocLink,
  handleDeleteFolderLink,
  handleGetDocLink,
  handleGetFolderLink,
  handlePublicGetDoc,
  handlePublicGetFolder,
  handlePublicGetFolderDoc,
} from './links'
import {
  handleGetAttachment,
  handlePublicGetAttachment,
  handlePublicGetFolderAttachment,
  handleUploadAttachment,
} from './attachments'

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
  { method: 'GET', path: '/api/docs/:id/link', handler: handleGetDocLink },
  { method: 'POST', path: '/api/docs/:id/link', handler: handleCreateDocLink },
  { method: 'DELETE', path: '/api/docs/:id/link', handler: handleDeleteDocLink },
  { method: 'GET', path: '/api/folders', handler: handleListFolders },
  { method: 'POST', path: '/api/folders', handler: handleCreateFolder },
  { method: 'PUT', path: '/api/folders/:id', handler: handleUpdateFolder },
  { method: 'DELETE', path: '/api/folders/:id', handler: handleDeleteFolder },
  { method: 'GET', path: '/api/folders/:id/link', handler: handleGetFolderLink },
  { method: 'POST', path: '/api/folders/:id/link', handler: handleCreateFolderLink },
  { method: 'DELETE', path: '/api/folders/:id/link', handler: handleDeleteFolderLink },
  { method: 'GET', path: '/pub/docs/:token', handler: handlePublicGetDoc },
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
]

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/pub/')) {
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
} satisfies ExportedHandler<Env>
