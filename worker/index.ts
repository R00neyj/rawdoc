import { errorResponse, jsonResponse } from './http'
import { getUser } from './auth'

type RouteHandler = (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>

interface Route {
  method: string
  path: string
  handler: RouteHandler
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
]

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request)
    }

    try {
      const matchingPath = routes.filter((route) => route.path === url.pathname)
      if (matchingPath.length === 0) {
        return errorResponse('not_found', 404)
      }

      const route = matchingPath.find((r) => r.method === request.method)
      if (!route) {
        return errorResponse('method_not_allowed', 405)
      }

      return await route.handler(request, env, ctx)
    } catch (err) {
      console.error(err)
      return errorResponse('internal', 500)
    }
  },
} satisfies ExportedHandler<Env>
