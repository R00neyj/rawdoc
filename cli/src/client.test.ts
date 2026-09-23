// F-2021 U4 (specs/features/F-2021.md 13.1, 4.1)
import { describe, expect, it, vi } from 'vitest'
import {
  apiCreateDoc,
  apiCreateFolder,
  apiCreateLink,
  apiGetDoc,
  apiListDocs,
  apiMe,
  apiUpdateDoc,
  apiUploadAttachment,
  type ClientConfig,
} from './client'
import { CliError } from './output'

function baseCfg(fetchImpl: typeof fetch): ClientConfig {
  return { origin: 'https://rawdoc.app', token: 'rd_' + 'a'.repeat(43), fetchImpl, userAgent: 'rawdoc/0.1.0 node/v22.0.0' }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)))
}

describe('F-2021 U4 client.ts — 요청 모양', () => {
  it('GET /v1/docs — 헤더', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse([]))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiListDocs(cfg)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://rawdoc.app/v1/docs')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${cfg.token}`)
    expect(headers['User-Agent']).toBe(cfg.userAgent)
    expect(init.method).toBe('GET')
  })

  it('GET /v1/docs/:id — encodeURIComponent', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'a b' }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiGetDoc(cfg, 'a b')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/a%20b')
  })

  it('POST /v1/docs — id·createdAt·updatedAt·pinnedAt 없이, lineEnding 명시', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1' }, 201))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiCreateDoc(cfg, { title: 't', content: 'c', lineEnding: 'lf' })
    const init = fetchImpl.mock.calls[0][1]
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ title: 't', content: 'c', lineEnding: 'lf' })
    expect('id' in body).toBe(false)
    expect('createdAt' in body).toBe(false)
    expect('updatedAt' in body).toBe(false)
    expect('pinnedAt' in body).toBe(false)
    expect((init.headers as Record<string, string>)['Content-Type']).toContain('application/json')
  })

  it('PUT /v1/docs/:id', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', version: 2 }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiUpdateDoc(cfg, 'd1', { content: 'new', baseVersion: 1 })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/d1')
    expect(fetchImpl.mock.calls[0][1].method).toBe('PUT')
  })

  it('POST /v1/folders', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'f1' }, 201))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiCreateFolder(cfg, { name: 'n' })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/folders')
  })

  it('POST /v1/attachments — 몸통이 파일 바이트 그대로', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'a1' }, 201))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const bytes = new Uint8Array([1, 2, 3])
    await apiUploadAttachment(cfg, bytes)
    const init = fetchImpl.mock.calls[0][1]
    expect(init.body).toBe(bytes)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()
  })

  it('POST /v1/docs/:id/link', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ token: 'x', url: 'https://rawdoc.app/#/p/x' }, 201))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiCreateLink(cfg, 'd1')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/d1/link')
  })

  it('GET /v1/me', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'u1', email: 'a@b.com' }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const me = await apiMe(cfg)
    expect(me).toEqual({ id: 'u1', email: 'a@b.com' })
  })
})

describe('F-2021 U4 client.ts — 오류', () => {
  it('연결 실패 → network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await expect(apiListDocs(cfg)).rejects.toMatchObject({ code: 'network' })
  })

  it('60초(주입한 시간 제한) 초과 → timeout', async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal as AbortSignal
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation timed out.', 'TimeoutError'))
        })
      })
    })
    const cfg = { ...baseCfg(fetchImpl as unknown as typeof fetch), timeoutMs: 10 }
    let error: unknown
    try {
      await apiListDocs(cfg)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).code).toBe('timeout')
  })

  it('404 → not_found (id 를 담는다)', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'not_found' }, 404))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    let error: unknown
    try {
      await apiGetDoc(cfg, 'missing')
    } catch (err) {
      error = err
    }
    expect((error as CliError).code).toBe('not_found')
    expect((error as CliError).details.id).toBe('missing')
  })

  it('409 → conflict (currentVersion)', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'conflict', doc: { version: 5 } }, 409))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    let error: unknown
    try {
      await apiUpdateDoc(cfg, 'd1', { baseVersion: 1 })
    } catch (err) {
      error = err
    }
    expect((error as CliError).code).toBe('conflict')
    expect((error as CliError).details.currentVersion).toBe(5)
  })

  it('423 → locked (email·expiresAt)', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'locked', email: 'a@b.com', expiresAt: 123 }, 423))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    let error: unknown
    try {
      await apiUpdateDoc(cfg, 'd1', { baseVersion: 1 })
    } catch (err) {
      error = err
    }
    expect((error as CliError).code).toBe('locked')
    expect((error as CliError).details.email).toBe('a@b.com')
  })

  it('401 → unauthenticated, 403 → forbidden, 400 → invalid, 5xx → server_error', async () => {
    const cases: [number, string][] = [[401, 'unauthenticated'], [403, 'forbidden'], [400, 'invalid'], [500, 'server_error']]
    for (const [status, code] of cases) {
      const fetchImpl = fakeFetch(() => jsonResponse({ error: 'x' }, status))
      const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
      let error: unknown
      try {
        await apiListDocs(cfg)
      } catch (err) {
        error = err
      }
      expect((error as CliError).code).toBe(code)
    }
  })
})
