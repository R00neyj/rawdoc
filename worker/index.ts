import { errorResponse, jsonResponse } from './http'

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

const routes: Route[] = [{ method: 'GET', path: '/api/health', handler: handleHealth }]

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
