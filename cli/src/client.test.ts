// F-2021 U4 (specs/features/F-2021.md 13.1, 4.1)
import { describe, expect, it, vi } from 'vitest'
import {
  apiCreateDoc,
  apiCreateFolder,
  apiCreateLink,
  apiDeleteDoc,
  apiDeleteFolder,
  apiGetDoc,
  apiListDocs,
  apiListShared,
  apiMe,
  apiMoveDoc,
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

describe('F-2050 5.3 client.ts — 요청 모양', () => {
  it('GET /v1/shared', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse([]))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiListShared(cfg)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/shared')
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
  })

  it('PUT /v1/docs/:id/folder — folderId 명시(null 포함)', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', folderId: null }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiMoveDoc(cfg, 'd', null)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/d/folder')
    const init = fetchImpl.mock.calls[0][1]
    expect(init.method).toBe('PUT')
    expect(init.body).toBe('{"folderId":null}')
  })

  it('PUT /v1/docs/:id/folder — folderId 문자열, encodeURIComponent', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', folderId: 'f1' }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiMoveDoc(cfg, 'a b', 'f1')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/a%20b/folder')
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({ folderId: 'f1' })
  })

  it('DELETE /v1/docs/:id', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', title: 't' }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiDeleteDoc(cfg, 'a b')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/a%20b')
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE')
  })

  it('DELETE /v1/folders/:id — contents 는 늘 명시(move-up 도)', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'f1', contents: 'move-up', parentId: null, docs: 0, folders: 0 }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await apiDeleteFolder(cfg, 'f1', 'move-up')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/folders/f1?contents=move-up')

    const fetchImpl2 = fakeFetch(() => jsonResponse({ id: 'f1', contents: 'delete-all', parentId: null, docs: 0, folders: 0 }))
    const cfg2 = baseCfg(fetchImpl2 as unknown as typeof fetch)
    await apiDeleteFolder(cfg2, 'f1', 'delete-all')
    expect(fetchImpl2.mock.calls[0][0]).toBe('https://rawdoc.app/v1/folders/f1?contents=delete-all')
  })
})

describe('F-2050 6.1 client.ts — 금고 분류', () => {
  it('403 e2ee_doc·e2ee_folder, 그 밖 forbidden, account_blocked 그대로', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ error: 'e2ee_doc' }, 'e2ee_doc'],
      [{ error: 'e2ee_folder' }, 'e2ee_folder'],
      [{ error: 'x' }, 'forbidden'],
      [{ error: 'account_blocked' }, 'account_blocked'],
    ]
    for (const [body, code] of cases) {
      const fetchImpl = fakeFetch(() => jsonResponse(body, 403))
      const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
      let error: unknown
      try {
        await apiListDocs(cfg)
      } catch (err) {
        error = err
      }
      expect((error as CliError).code, JSON.stringify(body)).toBe(code)
    }
  })

  it('409 e2ee_doc·e2ee_folder(conflict 아님), 그 밖 conflict', async () => {
    const doc = fakeFetch(() => jsonResponse({ error: 'e2ee_doc' }, 409))
    const cfgDoc = baseCfg(doc as unknown as typeof fetch)
    let e1: unknown
    try {
      await apiListDocs(cfgDoc)
    } catch (err) {
      e1 = err
    }
    expect((e1 as CliError).code).toBe('e2ee_doc')

    const folder = fakeFetch(() => jsonResponse({ error: 'e2ee_folder' }, 409))
    const cfgFolder = baseCfg(folder as unknown as typeof fetch)
    let e2: unknown
    try {
      await apiListDocs(cfgFolder)
    } catch (err) {
      e2 = err
    }
    expect((e2 as CliError).code).toBe('e2ee_folder')

    const conflict = fakeFetch(() => jsonResponse({ error: 'conflict', doc: { version: 3 } }, 409))
    const cfgConflict = baseCfg(conflict as unknown as typeof fetch)
    let e3: unknown
    try {
      await apiListDocs(cfgConflict)
    } catch (err) {
      e3 = err
    }
    expect((e3 as CliError).code).toBe('conflict')
    expect((e3 as CliError).details.currentVersion).toBe(3)
  })

  it('404 id — apiDeleteDoc·apiDeleteFolder', async () => {
    const docFetch = fakeFetch(() => jsonResponse({ error: 'not_found' }, 404))
    const cfgDoc = baseCfg(docFetch as unknown as typeof fetch)
    let e1: unknown
    try {
      await apiDeleteDoc(cfgDoc, 'd9')
    } catch (err) {
      e1 = err
    }
    expect((e1 as CliError).details.id).toBe('d9')

    const folderFetch = fakeFetch(() => jsonResponse({ error: 'not_found' }, 404))
    const cfgFolder = baseCfg(folderFetch as unknown as typeof fetch)
    let e2: unknown
    try {
      await apiDeleteFolder(cfgFolder, 'f9', 'move-up')
    } catch (err) {
      e2 = err
    }
    expect((e2 as CliError).details.id).toBe('f9')
  })

  it('429 — apiDeleteDoc 도 rate_limited, fetchImpl 1회', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 32400 }, 429))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    let error: unknown
    try {
      await apiDeleteDoc(cfg, 'd1')
    } catch (err) {
      error = err
    }
    expect((error as CliError).code).toBe('rate_limited')
    expect((error as CliError).details.scope).toBe('day')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
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

// 리뷰 C4 — try 가 fetch 만 감싸서 헤더를 받은 뒤 본문 읽기 실패가 CliError 가 아닌 날 오류로 샜다
describe('응답 본문 읽기 실패 (리뷰 C4)', () => {
  function bodyFails(err: Error): Response {
    const res = new Response('{}', { status: 200 })
    Object.defineProperty(res, 'text', { value: () => Promise.reject(err) })
    return res
  }

  it('본문 읽다 연결이 끊기면 network', async () => {
    const cfg = baseCfg(fakeFetch(() => bodyFails(new TypeError('terminated'))) as unknown as typeof fetch)
    await expect(apiListDocs(cfg)).rejects.toMatchObject({ code: 'network' })
  })

  it('본문 읽다 시간 제한에 걸리면 timeout', async () => {
    const cfg = baseCfg(
      fakeFetch(() => bodyFails(new DOMException('The operation timed out.', 'TimeoutError'))) as unknown as typeof fetch,
    )
    await expect(apiListDocs(cfg)).rejects.toMatchObject({ code: 'timeout' })
  })
})
