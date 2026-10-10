// F-2021 U8 (specs/features/F-2021.md 13.1, 4.2). ls 필터는 4.2 명령별 규칙
import { describe, expect, it, vi } from 'vitest'
import { find, info, ls, lsShared, moveDoc, putDoc, removeDoc, removeFolder, replace, search } from '../../../cli/src/commands'
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

describe('search', () => {
  const F1 = '00000000-0000-4000-8000-000000000001'
  const folderList = [{ id: F1, name: '수업', parentId: null, createdAt: 0, updatedAt: 0 }]
  const hit = (id: string, folderId: string | null) => ({ id, title: 't', folderId, version: 1, updatedAt: 0, lines: [], matchedLines: 0 })
  const result = { docs: [hit('d1', null), hit('d2', F1), hit('d3', 'gone')], truncated: false, e2eeSkipped: 1 }

  function routed(searchStatus = 200) {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      const u = new URL(url)
      urls.push(`${u.pathname}${u.search}`)
      if (u.pathname === '/v1/search') return searchStatus === 200 ? jsonResponse(result) : jsonResponse({ error: 'not_found' }, searchStatus)
      if (u.pathname === '/v1/folders') return jsonResponse(folderList)
      return jsonResponse({}, 404)
    })
    return { urls, cfg: baseCfg(fetchImpl as unknown as typeof fetch) }
  }

  it('검색어를 인코딩해 보내고, 폴더 경로를 붙인다', async () => {
    const { cfg, urls } = routed()
    const out = await search(cfg, '회의 & 메모', null)
    expect(urls.sort()).toEqual(['/v1/folders', `/v1/search?q=${encodeURIComponent('회의 & 메모')}`])
    expect(out).toEqual({ ...result, docs: [{ ...result.docs[0], folderPath: [] }, { ...result.docs[1], folderPath: ['수업'] }, { ...result.docs[2], folderPath: null }] })
  })

  it('받아 둔 폴더 목록이 있으면 검색 요청 1회, folder 를 함께 보낸다', async () => {
    const { cfg, urls } = routed()
    await search(cfg, 'x', { id: F1, value: '수업' }, folderList)
    expect(urls).toEqual([`/v1/search?q=x&folder=${F1}`])
  })

  it('폴더를 준 검색이 404 면 folder_not_found', async () => {
    await expect(search(routed(404).cfg, 'x', { id: F1, value: F1 })).rejects.toMatchObject({ code: 'folder_not_found', details: { folder: F1 } })
    await expect(search(routed(404).cfg, 'x', null)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('replace', () => {
  const hit = (id: string) => ({ id, title: `t-${id}`, folderId: null, version: 1, updatedAt: 0, lines: [], matchedLines: 1 })
  const doc = (id: string, content: string, version = 3) => ({
    id, title: `t-${id}`, content, version, lineEnding: 'lf', folderId: null, pinnedAt: null, createdAt: 0, updatedAt: 0,
  })

  // PUT 응답은 문서마다 차례로 꺼내 쓴다. 비면 성공(판 +1)
  function server(opts: { hits: string[]; docs: Record<string, string>; puts?: Record<string, Response[]>; truncated?: boolean }) {
    const calls: string[] = []
    const bodies: Record<string, unknown[]> = {}
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      const u = new URL(url)
      calls.push(`${init.method} ${u.pathname}`)
      if (u.pathname === '/v1/search') {
        return jsonResponse({ docs: opts.hits.map(hit), truncated: opts.truncated ?? false, e2eeSkipped: 2 })
      }
      if (u.pathname === '/v1/folders') return jsonResponse([])
      const id = decodeURIComponent(u.pathname.replace('/v1/docs/', ''))
      if (init.method === 'GET') return jsonResponse(doc(id, opts.docs[id]))
      ;(bodies[id] ??= []).push(JSON.parse(init.body as string))
      return opts.puts?.[id]?.shift() ?? jsonResponse(doc(id, '', 4))
    })
    return { calls, bodies, cfg: baseCfg(fetchImpl as unknown as typeof fetch) }
  }

  function hooks() {
    const waits: number[] = []
    const notices: number[] = []
    return { waits, notices, sleep: async (ms: number) => void waits.push(ms), onWait: (s: number) => void notices.push(s) }
  }

  const rateLimited = (scope: 'minute' | 'day', retryAfter: number) => jsonResponse({ error: 'rate_limited', scope, limit: 120, retryAfter }, 429)

  it('미리 보기는 PUT 하지 않고, 대소문자만 다른 문서는 빠진다', async () => {
    const s = server({ hits: ['d1', 'd2'], docs: { d1: 'foo\nx foo', d2: 'FOO only' } })
    const out = await replace(s.cfg, { find: 'foo', replacement: 'bar', folder: null, apply: false }, hooks())
    expect(s.calls.filter((c) => c.startsWith('PUT'))).toEqual([])
    expect(out).toMatchObject({ applied: false, e2eeSkipped: 2, stopped: null })
    expect(out.docs).toHaveLength(1)
    expect(out.docs[0]).toMatchObject({ id: 'd1', title: 't-d1', folderPath: [], count: 2, status: 'preview', changedLines: 2 })
  })

  it('--yes: GET 의 판 번호로 PUT, 409 는 충돌로 두고 다음 문서를 계속한다', async () => {
    const s = server({
      hits: ['d1', 'd2', 'd3'],
      docs: { d1: 'foo', d2: 'foo foo', d3: 'a foo' },
      puts: { d1: [jsonResponse({ error: 'conflict', doc: doc('d1', 'x', 9) }, 409)], d2: [jsonResponse({ error: 'too_large', limit: 1 }, 413)] },
    })
    const out = await replace(s.cfg, { find: 'foo', replacement: 'bar', folder: null, apply: true }, hooks())
    expect(s.bodies.d1).toEqual([{ content: 'bar', baseVersion: 3 }])
    expect(s.bodies.d3).toEqual([{ content: 'a bar', baseVersion: 3 }])
    expect(out.applied).toBe(true)
    expect(out.docs.map((d) => [d.id, d.status, d.count, d.version])).toEqual([
      ['d1', 'conflict', 1, undefined],
      ['d2', 'too_large', 2, undefined],
      ['d3', 'updated', 1, 4],
    ])
  })

  it('분당 429 는 retryAfter 만큼 기다렸다가 같은 문서를 다시 쓴다', async () => {
    const s = server({ hits: ['d1', 'd2'], docs: { d1: 'foo', d2: 'foo' }, puts: { d1: [rateLimited('minute', 7)] } })
    const h = hooks()
    const out = await replace(s.cfg, { find: 'foo', replacement: 'bar', folder: null, apply: true }, h)
    expect(h.notices).toEqual([7])
    expect(h.waits).toEqual([7000])
    expect(s.bodies.d1).toHaveLength(2)
    expect(out.docs.map((d) => d.status)).toEqual(['updated', 'updated'])
  })

  it('하루 한도 429 는 멈추고 남은 문서를 미처리로 둔다', async () => {
    const s = server({ hits: ['d1', 'd2', 'd3'], docs: { d1: 'foo', d2: 'foo', d3: 'foo' }, puts: { d2: [rateLimited('day', 3600)] } })
    const h = hooks()
    const out = await replace(s.cfg, { find: 'foo', replacement: 'bar', folder: null, apply: true }, h)
    expect(h.waits).toEqual([])
    expect(s.calls).not.toContain('GET /v1/docs/d3')
    expect(out.docs.map((d) => [d.id, d.status, d.count])).toEqual([
      ['d1', 'updated', 1],
      ['d2', 'skipped', 1],
      ['d3', 'skipped', null],
    ])
    expect(out.stopped).toMatchObject({ code: 'rate_limited', details: { scope: 'day' } })
  })

  it('바꾼 본문이 원문과 같으면 PUT 하지 않는다', async () => {
    const s = server({ hits: ['d1'], docs: { d1: 'foo' } })
    const out = await replace(s.cfg, { find: 'foo', replacement: 'foo', folder: null, apply: true }, hooks())
    expect(s.calls.filter((c) => c.startsWith('PUT'))).toEqual([])
    expect(out.docs).toEqual([])
  })

  it('검색이 200개를 넘으면 아무것도 읽거나 쓰지 않고 too_many_docs', async () => {
    const s = server({ hits: ['d1'], docs: { d1: 'foo' }, truncated: true })
    await expect(replace(s.cfg, { find: 'foo', replacement: 'bar', folder: null, apply: true }, hooks())).rejects.toMatchObject({
      code: 'too_many_docs',
      details: { limit: 200 },
    })
    expect(s.calls.filter((c) => c.includes('/v1/docs/'))).toEqual([])
  })
})
