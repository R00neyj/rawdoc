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

function rawResponse(body: string | null, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
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

describe('F-2031 A7~A12 새 오류 분기', () => {
  it('A7 429 JSON 몸통(분당)', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'rate_limited', scope: 'minute', limit: 120, retryAfter: 60 }, 429))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    let error: unknown
    try {
      await apiListDocs(cfg)
    } catch (err) {
      error = err
    }
    expect((error as CliError).code).toBe('rate_limited')
    expect((error as CliError).details).toMatchObject({ status: 429, scope: 'minute', retryAfter: 60, limit: 120 })
  })

  it('A8 429 몸통이 HTML · 빈 몸통 — bad_response 가 아니다', async () => {
    const htmlFetch = fakeFetch(() => rawResponse('<html>waf</html>', 429))
    const htmlCfg = baseCfg(htmlFetch as unknown as typeof fetch)
    let htmlErr: unknown
    try {
      await apiListDocs(htmlCfg)
    } catch (err) {
      htmlErr = err
    }
    expect((htmlErr as CliError).code).toBe('rate_limited')
    expect((htmlErr as CliError).details.scope).toBe('minute')
    expect((htmlErr as CliError).details.retryAfter).toBe(60)

    const emptyFetch = fakeFetch(() => rawResponse(null, 429))
    const emptyCfg = baseCfg(emptyFetch as unknown as typeof fetch)
    let emptyErr: unknown
    try {
      await apiListDocs(emptyCfg)
    } catch (err) {
      emptyErr = err
    }
    expect((emptyErr as CliError).code).toBe('rate_limited')
    expect((emptyErr as CliError).details.retryAfter).toBe(60)

    const headerFetch = fakeFetch(() => rawResponse('<html>waf</html>', 429, { 'Retry-After': '17' }))
    const headerCfg = baseCfg(headerFetch as unknown as typeof fetch)
    let headerErr: unknown
    try {
      await apiListDocs(headerCfg)
    } catch (err) {
      headerErr = err
    }
    expect((headerErr as CliError).details.retryAfter).toBe(17)
  })

  it('A9 429 retryAfter 우선순위', async () => {
    const bodyOverHeaderFetch = (async () =>
      new Response(JSON.stringify({ retryAfter: 30 }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '90' },
      })) as unknown as typeof fetch
    const cfg1 = baseCfg(bodyOverHeaderFetch)
    let err1: unknown
    try {
      await apiListDocs(cfg1)
    } catch (err) {
      err1 = err
    }
    expect((err1 as CliError).details.retryAfter).toBe(30)

    const httpDateFetch = (async () =>
      new Response(null, { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } })) as unknown as typeof fetch
    const cfg2 = baseCfg(httpDateFetch)
    let err2: unknown
    try {
      await apiListDocs(cfg2)
    } catch (err) {
      err2 = err
    }
    expect((err2 as CliError).details.retryAfter).toBe(60)

    const zeroFetch = fakeFetch(() => jsonResponse({ retryAfter: 0 }, 429))
    const cfg3 = baseCfg(zeroFetch as unknown as typeof fetch)
    let err3: unknown
    try {
      await apiListDocs(cfg3)
    } catch (err) {
      err3 = err
    }
    expect((err3 as CliError).details.retryAfter).toBe(1)

    const dayFetch = fakeFetch(() => jsonResponse({ scope: 'day' }, 429))
    const cfg4 = baseCfg(dayFetch as unknown as typeof fetch)
    let err4: unknown
    try {
      await apiListDocs(cfg4)
    } catch (err) {
      err4 = err
    }
    expect((err4 as CliError).details.scope).toBe('day')

    const hourFetch = fakeFetch(() => jsonResponse({ scope: 'hour' }, 429))
    const cfg5 = baseCfg(hourFetch as unknown as typeof fetch)
    let err5: unknown
    try {
      await apiListDocs(cfg5)
    } catch (err) {
      err5 = err
    }
    expect((err5 as CliError).details.scope).toBe('minute')
  })

  it('A10 413 가르기', async () => {
    const bytesFetch = fakeFetch(() => jsonResponse({ error: 'doc_quota_exceeded', resource: 'bytes', used: 1, limit: 2 }, 413))
    const cfg1 = baseCfg(bytesFetch as unknown as typeof fetch)
    let err1: unknown
    try {
      await apiListDocs(cfg1)
    } catch (err) {
      err1 = err
    }
    expect((err1 as CliError).code).toBe('doc_quota_exceeded')
    expect((err1 as CliError).details).toMatchObject({ resource: 'bytes', used: 1, limit: 2 })

    const tooLargeFetch = fakeFetch(() => jsonResponse({ error: 'too_large', limit: 1000000 }, 413))
    const cfg2 = baseCfg(tooLargeFetch as unknown as typeof fetch)
    let err2: unknown
    try {
      await apiListDocs(cfg2)
    } catch (err) {
      err2 = err
    }
    expect((err2 as CliError).code).toBe('too_large')

    const unknownResourceFetch = fakeFetch(() => jsonResponse({ error: 'doc_quota_exceeded', resource: 'x' }, 413))
    const cfg3 = baseCfg(unknownResourceFetch as unknown as typeof fetch)
    let err3: unknown
    try {
      await apiListDocs(cfg3)
    } catch (err) {
      err3 = err
    }
    expect((err3 as CliError).code).toBe('doc_quota_exceeded')
    expect('resource' in (err3 as CliError).details).toBe(false)
  })

  it('A11 403 가르기', async () => {
    const blockedFetch = fakeFetch(() => jsonResponse({ error: 'account_blocked' }, 403))
    const cfg1 = baseCfg(blockedFetch as unknown as typeof fetch)
    let err1: unknown
    try {
      await apiListDocs(cfg1)
    } catch (err) {
      err1 = err
    }
    expect((err1 as CliError).code).toBe('account_blocked')

    const forbiddenFetch = fakeFetch(() => jsonResponse({ error: 'forbidden' }, 403))
    const cfg2 = baseCfg(forbiddenFetch as unknown as typeof fetch)
    let err2: unknown
    try {
      await apiListDocs(cfg2)
    } catch (err) {
      err2 = err
    }
    expect((err2 as CliError).code).toBe('forbidden')
  })

  it('A12 재시도 없음 — 새 분기도 fetchImpl 1회', async () => {
    const cases = [
      () => jsonResponse({ error: 'rate_limited', scope: 'minute', retryAfter: 60 }, 429),
      () => jsonResponse({ error: 'doc_quota_exceeded', resource: 'bytes', used: 1, limit: 2 }, 413),
      () => jsonResponse({ error: 'account_blocked' }, 403),
    ]
    for (const handler of cases) {
      const fetchImpl = fakeFetch(handler)
      const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
      try {
        await apiListDocs(cfg)
      } catch {
        // 오류는 기대한 것
      }
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })
})
