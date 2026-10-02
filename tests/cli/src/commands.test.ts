// F-2021 U8 (specs/features/F-2021.md 13.1, 4.2). ls 필터는 4.2 명령별 규칙
import { describe, expect, it, vi } from 'vitest'
import { find, info, ls, lsShared, moveDoc, putDoc, removeDoc, removeFolder } from '../../../cli/src/commands'
import type { ClientConfig } from '../../../cli/src/client'

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

describe('F-2050 5.4 commands.ts — 새 명령 함수', () => {
  it('lsShared 는 GET /v1/shared 를 그대로 돌려준다', async () => {
    const shared = [{ id: 'd1', role: 'edit' }]
    const fetchImpl = fakeFetch(() => jsonResponse(shared))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await lsShared(cfg)
    expect(result).toEqual(shared)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/shared')
  })

  it('moveDoc 은 apiMoveDoc 을 부른다', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', folderId: 'f1' }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await moveDoc(cfg, { id: 'd1', folderId: 'f1' })
    expect(result.folderId).toBe('f1')
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/docs/d1/folder')
  })

  it('removeDoc 은 apiDeleteDoc 을 부른다', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'd1', title: 't' }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await removeDoc(cfg, 'd1')
    expect(result).toEqual({ id: 'd1', title: 't' })
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE')
  })

  it('removeFolder 는 all 이 delete-all 로, 아니면 move-up 으로', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ id: 'f1', contents: 'delete-all', parentId: null, docs: 0, folders: 0 }))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    await removeFolder(cfg, { id: 'f1', all: true })
    expect(fetchImpl.mock.calls[0][0]).toBe('https://rawdoc.app/v1/folders/f1?contents=delete-all')

    const fetchImpl2 = fakeFetch(() => jsonResponse({ id: 'f1', contents: 'move-up', parentId: null, docs: 0, folders: 0 }))
    const cfg2 = baseCfg(fetchImpl2 as unknown as typeof fetch)
    await removeFolder(cfg2, { id: 'f1', all: false })
    expect(fetchImpl2.mock.calls[0][0]).toBe('https://rawdoc.app/v1/folders/f1?contents=move-up')
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
    const result = await ls(cfg, { kind: 'folder', id: 'f1' }, false)
    expect(result.map((d) => d.id)).toEqual(['d1', 'd3'])
  })

  it('folder 가 null 이면 전부', async () => {
    const docs = [{ id: 'd1', folderId: 'f1' }]
    const fetchImpl = vi.fn(async () => jsonResponse(docs))
    const cfg = baseCfg(fetchImpl as unknown as typeof fetch)
    const result = await ls(cfg, { kind: 'all' }, false)
    expect(result.length).toBe(1)
  })
})

describe('F-2119 A6~A8 ls --root, find, info', () => {
  const mk = (id: string, folderId: string | null, title: string, extra: object = {}) => ({
    id, title, folderId, lineEnding: 'lf', pinnedAt: null, version: 2, createdAt: 1, updatedAt: 2, ...extra,
  })
  const docs = [mk('d1', null, '바이브 회의록'), mk('d2', 'f1', '회의록 2'), mk('d3', 'f1', '', { e2ee: true }), mk('d4', 'f2', '기타')]
  const folderList = [
    { id: 'f1', name: '수업', parentId: null, createdAt: 0, updatedAt: 0 },
    { id: 'f2', name: '하위', parentId: 'f1', createdAt: 0, updatedAt: 0 },
  ]
  const shared = [{ ...mk('s1', 'other', '공유'), role: 'view', ownerEmail: 'o@x.com' }]

  function routed(failFolders = false) {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(new URL(url).pathname)
      if (url.endsWith('/v1/docs')) return jsonResponse(docs)
      if (url.endsWith('/v1/folders')) return failFolders ? jsonResponse({ error: 'x' }, 500) : jsonResponse(folderList)
      if (url.endsWith('/v1/shared')) return jsonResponse(shared)
      return jsonResponse({}, 404)
    })
    return { urls, cfg: baseCfg(fetchImpl as unknown as typeof fetch) }
  }

  it('A6 --root 는 folderId null 만', async () => {
    const { cfg, urls } = routed()
    expect((await ls(cfg, { kind: 'root' }, false)).map((d) => d.id)).toEqual(['d1'])
    expect(urls).toEqual(['/v1/docs'])
  })

  it('ls withPath 는 folderPath 를 더하고 요청 2회', async () => {
    const { cfg, urls } = routed()
    const out = await ls(cfg, { kind: 'all' }, true)
    expect(out.map((d) => (d as { folderPath: unknown }).folderPath)).toEqual([[], ['수업'], ['수업'], ['수업', '하위']])
    expect(urls.sort()).toEqual(['/v1/docs', '/v1/folders'])
  })

  it('A7 find 는 제목으로 거르고 금고 문서는 안 나온다, 요청 1회', async () => {
    const { cfg, urls } = routed()
    expect((await find(cfg, '회의록', { kind: 'all' }, false)).map((d) => d.id)).toEqual(['d1', 'd2'])
    expect(urls).toEqual(['/v1/docs'])
    expect((await find(cfg, '회의록', { kind: 'root' }, false)).map((d) => d.id)).toEqual(['d1'])
    expect((await find(cfg, '회의록', { kind: 'folder', id: 'f1' }, false)).map((d) => d.id)).toEqual(['d2'])
    expect(await find(cfg, '금고', { kind: 'all' }, false)).toEqual([])
  })

  it('A8 info: 내 문서 2회, 금고 문서 메타, 공유 3회, 없으면 not_found', async () => {
    const a = routed()
    expect(await info(a.cfg, 'd2')).toMatchObject({ id: 'd2', folderPath: ['수업'] })
    expect(a.urls.sort()).toEqual(['/v1/docs', '/v1/folders'])
    expect(await info(routed().cfg, 'd3')).toMatchObject({ id: 'd3', e2ee: true })
    const b = routed()
    expect(await info(b.cfg, 's1')).toMatchObject({ id: 's1', role: 'view', folderPath: null })
    expect(b.urls.sort()).toEqual(['/v1/docs', '/v1/folders', '/v1/shared'])
    await expect(info(routed().cfg, 'zzz')).rejects.toMatchObject({ code: 'not_found', details: { id: 'zzz' } })
    await expect(info(routed(true).cfg, 'd1')).rejects.toMatchObject({ code: 'server_error' })
  })
})
