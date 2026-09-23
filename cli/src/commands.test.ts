// F-2021 U8 (specs/features/F-2021.md 13.1, 4.2). ls 필터는 4.2 명령별 규칙
import { describe, expect, it, vi } from 'vitest'
import { ls, putDoc } from './commands'
import type { ClientConfig } from './client'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function baseCfg(fetchImpl: typeof fetch): ClientConfig {
  return { origin: 'https://rawdoc.app', token: 'rd_' + 'a'.repeat(43), fetchImpl, userAgent: 'rawdoc/0.1.0 node/v22' }
}

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)))
}

describe('F-2021 U8 putDoc', () => {
  it('--force 는 GET 뒤 그 version 으로 PUT(요청 2회)', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`)
      if (init.method === 'GET') return jsonResponse({ id: 'd1', version: 5, content: 'c', title: 't', lineEnding: 'lf', folderId: null, pinnedAt: null, createdAt: 0, updatedAt: 0 })
      return jsonResponse({ id: 'd1', version: 6 })
    })
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await putDoc(cfg, { id: 'd1', content: 'new', baseVersion: null, force: true })
    expect(calls).toEqual(['GET https://rawdoc.app/v1/docs/d1', 'PUT https://rawdoc.app/v1/docs/d1'])
    const putBody = JSON.parse((fetchImpl.mock.calls[1][1] as RequestInit).body as string)
    expect(putBody.baseVersion).toBe(5)
    expect(result.version).toBe(6)
  })

  it('--base-version 3 은 PUT 1회에 baseVersion: 3', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', version: 4 }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await putDoc(cfg, { id: 'd1', content: 'new', baseVersion: 3, force: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(body).toEqual({ content: 'new', baseVersion: 3 })
  })

  it('--title 만이면 몸통에 content 없음', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', version: 2 }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await putDoc(cfg, { id: 'd1', title: '새 제목', baseVersion: 1, force: false })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect('content' in body).toBe(false)
    expect(body.title).toBe('새 제목')
  })

  it('409 → CliError conflict', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'conflict', doc: { version: 9 } }, 409))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await expect(putDoc(cfg, { id: 'd1', content: 'c', baseVersion: 1, force: false })).rejects.toMatchObject({
      code: 'conflict',
      details: { currentVersion: 9 },
    })
  })
})

describe('F-2021 U8 ls --folder', () => {
  it('folderId 가 같은 것만 남긴다', async () => {
    const docs = [
      { id: 'd1', folderId: 'f1' },
      { id: 'd2', folderId: 'f2' },
      { id: 'd3', folderId: 'f1' },
    ]
    const fetchImpl = vi.fn(async () => jsonResponse(docs))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await ls(cfg, 'f1')
    expect(result.map((d) => d.id)).toEqual(['d1', 'd3'])
  })

  it('folder 가 null 이면 전부', async () => {
    const docs = [{ id: 'd1', folderId: 'f1' }]
    const fetchImpl = vi.fn(async () => jsonResponse(docs))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await ls(cfg, null)
    expect(result.length).toBe(1)
  })
})
