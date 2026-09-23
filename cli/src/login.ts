// 루프백 서버·콜백 판정·로그인 흐름 (specs/features/F-2021.md 5.1~5.5)
// 콜백 state 는 자기 공개키 문자열, 풀기는 openSealedTokenV2 (F-2023 9장)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { openSealedTokenV2 } from '../../src/lib/cliSeal'
import { apiMe, type ClientConfig } from './client'
import { CliError } from './output'
import type { V1Me } from '../../worker/v1Contract'

export type CallbackRequest = { method: string; host: string | null; path: string; query: URLSearchParams }

export type CallbackClassification =
  | { kind: 'continue'; status: number; body?: string }
  | { kind: 'denied' }
  | { kind: 'try-seal'; sealed: string }

export const CALLBACK_MISMATCH_BODY = '로그인 응답이 맞지 않습니다. 터미널에서 다시 로그인하세요.'
export const CALLBACK_DENIED_BODY = '로그인을 취소했습니다. 이 창을 닫아도 됩니다.'
export const CALLBACK_SUCCESS_BODY = '로그인했습니다. 이 창을 닫고 터미널로 돌아가세요.'

const TOKEN_RE = /^rd_[A-Za-z0-9_-]{43}$/

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// 5.2 표. 실제 sealed 풀기(비동기)는 하지 않는다 — 'try-seal' 로 넘긴다
export function classifyCallback(req: CallbackRequest, port: number, expectedState: string): CallbackClassification {
  if (req.method !== 'GET') return { kind: 'continue', status: 405 }
  if (req.host !== `127.0.0.1:${port}`) return { kind: 'continue', status: 400 }
  if (req.path !== '/callback') return { kind: 'continue', status: 404 }

  const state = req.query.get('state') ?? ''
  if (!constantTimeEqual(state, expectedState)) return { kind: 'continue', status: 400, body: CALLBACK_MISMATCH_BODY }
  if (req.query.get('error') === 'denied') return { kind: 'denied' }

  const sealed = req.query.get('sealed')
  if (!sealed) return { kind: 'continue', status: 400, body: CALLBACK_MISMATCH_BODY }
  return { kind: 'try-seal', sealed }
}

function htmlPage(text: string): string {
  return `<!doctype html><meta charset="utf-8"><p>${text}</p>`
}

function respond(res: ServerResponse, status: number, body?: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(body ? htmlPage(body) : undefined)
}

export type LoginCallbackResult = { kind: 'success'; token: string } | { kind: 'denied' }

export type CallbackServerHandle = {
  port: number
  result: Promise<LoginCallbackResult>
  close: () => void
}

// 127.0.0.1 에만 연다(5.2). 5분 제한·Ctrl+C 는 main.ts 가 잰다
// 기대하는 state 는 opts.publicKey 자신이다 — v2 는 state 를 따로 만들지 않는다(F-2023 5.1)
export function startCallbackServer(opts: { publicKey: string; privateKey: CryptoKey }): Promise<CallbackServerHandle> {
  return new Promise((resolveHandle, rejectHandle) => {
    let resolveResult: (r: LoginCallbackResult) => void = () => {}
    const result = new Promise<LoginCallbackResult>((resolve) => {
      resolveResult = resolve
    })
    let boundPort = 0

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const hostHeader = req.headers.host
        const host = typeof hostHeader === 'string' ? hostHeader : null
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const callbackReq: CallbackRequest = {
          method: req.method ?? '',
          host,
          path: url.pathname,
          query: url.searchParams,
        }
        const classification = classifyCallback(callbackReq, boundPort, opts.publicKey)

        if (classification.kind === 'continue') {
          respond(res, classification.status, classification.body)
          return
        }
        if (classification.kind === 'denied') {
          respond(res, 200, CALLBACK_DENIED_BODY)
          resolveResult({ kind: 'denied' })
          return
        }

        let token: string
        try {
          token = await openSealedTokenV2(opts.privateKey, opts.publicKey, classification.sealed)
        } catch {
          respond(res, 400, CALLBACK_MISMATCH_BODY)
          return
        }
        if (!TOKEN_RE.test(token)) {
          respond(res, 400, CALLBACK_MISMATCH_BODY)
          return
        }
        respond(res, 200, CALLBACK_SUCCESS_BODY)
        resolveResult({ kind: 'success', token })
      })()
    })

    server.on('error', () => rejectHandle(new CliError('login_port')))
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        rejectHandle(new CliError('login_port'))
        return
      }
      boundPort = address.port
      resolveHandle({ port: boundPort, result, close: () => server.close() })
    })
  })
}

// 이미 로그인돼 있는지 GET /v1/me 로 확인한다. 401(unauthenticated)이면 새 로그인으로 진행 — null (5.1-1)
export async function checkAlreadyLoggedIn(cfg: ClientConfig): Promise<V1Me | null> {
  try {
    return await apiMe(cfg)
  } catch (err) {
    if (err instanceof CliError && err.code === 'unauthenticated') return null
    throw err
  }
}
