// MCP 쓰기·지우기 도구의 관문 — /v1 과 같은 runWriteGate 를 부르고 결과를 도구 오류로 바꾼다 (F-3031 2장)
import type { CallToolResult } from '@modelcontextprotocol/server'
import { rememberUser } from './auth'
import { toToolResult, toolError, type McpCall } from './mcpCall'
import { runWriteGate, type RateLimitedBody } from './writeGate'

export function limitsUrl(origin: string, scope: 'minute' | 'day', retryAfter: number): string {
  return `${origin}/limits?scope=${scope}&retry=${retryAfter}`
}

export const BLOCKED_MESSAGE = 'This account is blocked from writing. Reading still works.'

export async function gateMcpWrite(call: McpCall): Promise<CallToolResult | null> {
  rememberUser(call.request, call.caller.user)
  const blocked = await runWriteGate(call.request, call.env)
  if (!blocked) return null
  if (blocked.status === 429) {
    const body = (await blocked.json()) as RateLimitedBody
    const url = limitsUrl(new URL(call.request.url).origin, body.scope, body.retryAfter)
    const prefix =
      body.scope === 'day'
        ? `Daily write limit reached (${body.limit} writes per UTC day)`
        : `Write limit reached (${body.limit} writes per minute)`
    return toolError(`${prefix}. Writes resume in ${body.retryAfter} seconds. Details: ${url}`, {
      error: 'rate_limited',
      scope: body.scope,
      limit: body.limit,
      retryAfter: body.retryAfter,
      limitsUrl: url,
    })
  }
  if (blocked.status === 403) return toolError(BLOCKED_MESSAGE, { error: 'account_blocked' })
  return toToolResult(blocked)
}
