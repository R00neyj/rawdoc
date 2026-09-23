// F-2021 U9 (specs/features/F-2021.md 13.1, 5.2)
import { describe, expect, it } from 'vitest'
import { generateSealKeyPair, sealToken } from '../../src/lib/cliSeal'
import {
  CALLBACK_DENIED_BODY,
  CALLBACK_MISMATCH_BODY,
  CALLBACK_SUCCESS_BODY,
  checkAlreadyLoggedIn,
  classifyCallback,
  generateLoginState,
  startCallbackServer,
  type CallbackRequest,
} from './login'
import type { ClientConfig } from './client'
import { CliError } from './output'

const PORT = 45678
const STATE = 's'.repeat(22)

function req(overrides: Partial<CallbackRequest> = {}): CallbackRequest {
  return {
    method: 'GET',
    host: `127.0.0.1:${PORT}`,
    path: '/callback',
    query: new URLSearchParams({ state: STATE, sealed: 'x' }),
    ...overrides,
  }
}

describe('F-2021 U9 classifyCallback — 5.2 표', () => {
  it('메서드가 GET 아니면 405, 계속 기다림', () => {
    expect(classifyCallback(req({ method: 'POST' }), PORT, STATE)).toEqual({ kind: 'continue', status: 405 })
  })

  it('Host 가 127.0.0.1:{port} 정확히 아니면 400 — localhost 거절', () => {
    expect(classifyCallback(req({ host: `localhost:${PORT}` }), PORT, STATE)).toEqual({ kind: 'continue', status: 400 })
  })

  it('경로가 /callback 아니면 404', () => {
    expect(classifyCallback(req({ path: '/favicon.ico' }), PORT, STATE)).toEqual({ kind: 'continue', status: 404 })
  })

  it('state 다르면 400 + 안내 문구', () => {
    const result = classifyCallback(req({ query: new URLSearchParams({ state: 'x'.repeat(22), sealed: 'x' }) }), PORT, STATE)
    expect(result).toEqual({ kind: 'continue', status: 400, body: CALLBACK_MISMATCH_BODY })
  })

  it('error=denied 면 denied', () => {
    const result = classifyCallback(req({ query: new URLSearchParams({ state: STATE, error: 'denied' }) }), PORT, STATE)
    expect(result).toEqual({ kind: 'denied' })
  })

  it('sealed 없으면 400 + 안내 문구', () => {
    const result = classifyCallback(req({ query: new URLSearchParams({ state: STATE }) }), PORT, STATE)
    expect(result).toEqual({ kind: 'continue', status: 400, body: CALLBACK_MISMATCH_BODY })
  })

  it('성공 조건이면 try-seal', () => {
    const result = classifyCallback(req(), PORT, STATE)
    expect(result).toEqual({ kind: 'try-seal', sealed: 'x' })
  })
})

describe('F-2021 U9 startCallbackServer — 실제 루프백 서버', () => {
  it('올바른 콜백 → 성공, 토큰이 풀린다', async () => {
    const { publicKey, privateKey } = await generateSealKeyPair()
    const handle = await startCallbackServer({ expectedState: STATE, privateKey })
    const token = 'rd_' + 'a'.repeat(43)
    const sealed = await sealToken(publicKey, token)

    const res = await fetch(`http://127.0.0.1:${handle.port}/callback?state=${STATE}&sealed=${encodeURIComponent(sealed)}`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain(CALLBACK_SUCCESS_BODY)

    const result = await handle.result
    expect(result).toEqual({ kind: 'success', token })
    handle.close()
  })

  it('취소 → denied', async () => {
    const { privateKey } = await generateSealKeyPair()
    const handle = await startCallbackServer({ expectedState: STATE, privateKey })

    const res = await fetch(`http://127.0.0.1:${handle.port}/callback?state=${STATE}&error=denied`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain(CALLBACK_DENIED_BODY)

    const result = await handle.result
    expect(result).toEqual({ kind: 'denied' })
    handle.close()
  })

  it('상태 불일치·풀기 실패 뒤에도 올바른 콜백을 받으면 성공한다', async () => {
    const { publicKey, privateKey } = await generateSealKeyPair()
    const handle = await startCallbackServer({ expectedState: STATE, privateKey })

    const badState = await fetch(`http://127.0.0.1:${handle.port}/callback?state=${'x'.repeat(22)}&sealed=x`)
    expect(badState.status).toBe(400)

    const badSeal = await fetch(`http://127.0.0.1:${handle.port}/callback?state=${STATE}&sealed=not-a-real-seal`)
    expect(badSeal.status).toBe(400)

    const token = 'rd_' + 'b'.repeat(43)
    const sealed = await sealToken(publicKey, token)
    const good = await fetch(`http://127.0.0.1:${handle.port}/callback?state=${STATE}&sealed=${encodeURIComponent(sealed)}`)
    expect(good.status).toBe(200)

    const result = await handle.result
    expect(result).toEqual({ kind: 'success', token })
    handle.close()
  })
})

describe('F-2021 U9 checkAlreadyLoggedIn', () => {
  function cfg(fetchImpl: typeof fetch): ClientConfig {
    return { origin: 'https://rawdoc.app', token: 'rd_' + 'a'.repeat(43), fetchImpl, userAgent: 'rawdoc/0.1.0 node/v22' }
  }

  it('200 이면 V1Me', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ id: 'u1', email: 'a@b.com' }), { status: 200 })) as unknown as typeof fetch
    const me = await checkAlreadyLoggedIn(cfg(fetchImpl))
    expect(me).toEqual({ id: 'u1', email: 'a@b.com' })
  })

  it('401 이면 null', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    const me = await checkAlreadyLoggedIn(cfg(fetchImpl))
    expect(me).toBeNull()
  })

  it('그 밖의 오류는 던진다', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    await expect(checkAlreadyLoggedIn(cfg(fetchImpl))).rejects.toBeInstanceOf(CliError)
  })
})

describe('F-2021 U9 generateLoginState', () => {
  it('22자 base64url', () => {
    const state = generateLoginState()
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
})
