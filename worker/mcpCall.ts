// MCP 도구가 /v1 핸들러를 부르고 결과를 도구 응답으로 바꾸는 도우미 — 쓰기·지우기 도구도 같이 쓴다 (F-3030 2장)
import type { CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { rememberUser } from './auth'
import type { McpCaller } from './mcpAuth'

export type McpCall = { request: Request; env: Env; ctx: ExecutionContext; caller: McpCaller }

export const VAULT_DOC_MESSAGE = 'Vault (end-to-end encrypted) documents cannot be opened through this connection.'
export const NOT_FOUND_MESSAGE = 'Not found, or you do not have access.'
export const MCP_LIST_PAGE = 200

export function innerV1(call: McpCall, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Request {
  const headers = new Headers(call.request.headers)
  headers.delete('Content-Length')
  const init: RequestInit = { method, headers }
  if (body !== undefined) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
    init.body = JSON.stringify(body)
  }
  const inner = new Request(new URL(path, call.request.url), init)
  rememberUser(inner, call.caller.user)
  return inner
}

export function docUrl(call: McpCall, id: string): string {
  return `${new URL(call.request.url).origin}/?app=1#/d/${encodeURIComponent(id)}`
}

export function toolResult(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }
}

export function toolError(message: string, data?: Record<string, unknown>): CallToolResult {
  const payload = { message, ...data }
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload }
}

const JsonObject = z.record(z.string(), z.unknown())

function failureMessage(status: number, body: Record<string, unknown>): string {
  const { error, field } = body
  if (status === 404) return NOT_FOUND_MESSAGE
  if (status === 403 && error === 'e2ee_doc') return VAULT_DOC_MESSAGE
  if (status === 400 && error === 'invalid' && typeof field === 'string') return `Invalid argument: ${field}.`
  return `Request failed (${status}${typeof error === 'string' ? ` ${error}` : ''}).`
}

export async function toToolResult(res: Response): Promise<CallToolResult> {
  const parsed = JsonObject.safeParse(await res.json().catch(() => null))
  if (res.ok && parsed.success) return toolResult(parsed.data)
  const body = parsed.success ? parsed.data : {}
  return toolError(failureMessage(res.status, body), { status: res.status, ...body })
}

// 예외 글에는 SQL·내부 경로가 섞일 수 있어 모델에게 넘기지 않는다 — SDK 는 그대로 넘긴다
export function safeTool<A>(cb: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await cb(args)
    } catch (err) {
      if (err instanceof Response) return toToolResult(err)
      console.error(err)
      return toolError('Internal error. Try again later.')
    }
  }
}
