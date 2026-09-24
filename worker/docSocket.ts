// /ws/doc/:id — 업그레이드 요청 판정, 거절 소켓, DocRoom 으로 넘기기 (specs/features/F-304.md 4장)
import { errorResponse } from './http'
import { getUser } from './auth'
import { getDocAccess, roleAtLeast } from './access'
import { isValidUuid } from './validate'
import { SOCKET_CLOSE } from '../src/lib/docRoomProtocol'
import type { SocketCloseReason } from '../src/lib/docRoomProtocol'
import { isAllowedOrigin } from './origin'

// Worker 와 DocRoom 사이 계약
export const DOC_ROOM_HEADERS = {
  userId: 'X-WS-User-Id',
  email: 'X-WS-User-Email',
  role: 'X-WS-Role',
  docVersion: 'X-WS-Doc-Version',
} as const

export type ForwardedIdentity = { userId: string; email: string; role: 'owner' | 'edit'; docVersion: number }

export type DocSocketDecision =
  | { type: 'reject'; response: Response }
  | { type: 'close'; code: number; reason: SocketCloseReason }
  | { type: 'forward'; request: Request }

export async function resolveDocSocket(request: Request, env: Env, docId: string): Promise<DocSocketDecision> {
  if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return { type: 'reject', response: errorResponse('upgrade_required', 426) }
  }
  if (!isAllowedOrigin(request.headers.get('Origin'), request, env)) {
    return { type: 'reject', response: errorResponse('forbidden_origin', 403) }
  }
  if (!isValidUuid(docId)) return { type: 'reject', response: errorResponse('not_found', 404) }

  const user = await getUser(request, env)
  if (!user) return { type: 'close', code: SOCKET_CLOSE.unauthenticated, reason: 'unauthenticated' }
  const access = await getDocAccess<{ id: string; owner_id: string; folder_id: string | null; version: number }>(
    env,
    docId,
    user,
    'id, owner_id, folder_id, version',
  )
  if (!access) return { type: 'close', code: SOCKET_CLOSE.notFound, reason: 'not_found' }
  if (!roleAtLeast(access.role, 'edit')) return { type: 'close', code: SOCKET_CLOSE.forbidden, reason: 'forbidden' }

  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith('x-ws-')) headers.delete(name)
  }
  headers.set(DOC_ROOM_HEADERS.userId, user.id)
  headers.set(DOC_ROOM_HEADERS.email, user.email)
  headers.set(DOC_ROOM_HEADERS.role, access.role)
  headers.set(DOC_ROOM_HEADERS.docVersion, String(access.doc.version))
  return { type: 'forward', request: new Request(request, { headers }) }
}

export function readForwardedIdentity(headers: Headers): ForwardedIdentity | null {
  const userId = headers.get(DOC_ROOM_HEADERS.userId)
  const email = headers.get(DOC_ROOM_HEADERS.email)
  const role = headers.get(DOC_ROOM_HEADERS.role)
  const version = Number(headers.get(DOC_ROOM_HEADERS.docVersion) ?? '')
  if (!userId || !email || (role !== 'owner' && role !== 'edit')) return null
  if (!Number.isInteger(version)) return null
  return { userId, email, role, docVersion: version }
}

// 업그레이드를 받아들이고 곧바로 닫는다 — 브라우저 WebSocket 은 HTTP 상태를 못 읽는다 (4.2)
function closedSocket(code: number, reason: SocketCloseReason): Response {
  const pair = new WebSocketPair()
  const [client, server] = [pair[0], pair[1]]
  server.accept()
  server.close(code, reason)
  return new Response(null, { status: 101, webSocket: client })
}

export async function handleDocSocket(request: Request, env: Env, docId: string): Promise<Response> {
  const decision = await resolveDocSocket(request, env, docId)
  if (decision.type === 'reject') return decision.response
  if (decision.type === 'close') return closedSocket(decision.code, decision.reason)
  try {
    return await env.DOC_ROOM.getByName(docId).fetch(decision.request)
  } catch (err) {
    console.error(err)
    return closedSocket(SOCKET_CLOSE.unavailable, 'unavailable')
  }
}
