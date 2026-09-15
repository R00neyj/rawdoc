import 'fake-indexeddb/auto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServerStore } from './serverStore'

let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-md-remote-${Date.now()}-${dbCounter}`
}

async function tick(n = 15) {
  for (let i = 0; i < n; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

type FakeDoc = {
  id: string
  title: string
  content: string
  lineEnding: string
  folderId: string | null
  pinnedAt: number | null
  version: number
  createdAt: number
  updatedAt: number
}

// 최소 F-206 흉내 — GET/POST /api/docs, GET/PUT/DELETE /api/docs/:id (specs/features/F-207.md 2.3)
function makeFakeServer() {
  const docs = new Map<string, FakeDoc>()
  let networkDown = false
  let serverError = false

  function jsonResponse(status: number, data?: unknown): Response {
    return new Response(data === undefined ? null : JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async function fetchImpl(url: string, init: RequestInit = {}): Promise<Response> {
    if (networkDown) throw new TypeError('network down')
    if (serverError) return jsonResponse(500, { error: 'internal' })

    const method = init.method ?? 'GET'
    const path = new URL(String(url), 'http://local.test').pathname

    if (path === '/api/docs' && method === 'GET') {
      return jsonResponse(200, [...docs.values()].map((d) => ({ ...d, content: undefined })))
    }
    if (path === '/api/docs' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as Partial<FakeDoc>
      if (body.id && docs.has(body.id)) return jsonResponse(200, docs.get(body.id))
      const now = Date.now()
      const doc: FakeDoc = {
        id: body.id ?? crypto.randomUUID(),
        title: body.title ?? '',
        content: body.content ?? '',
        lineEnding: body.lineEnding ?? 'lf',
        folderId: body.folderId ?? null,
        pinnedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }
      docs.set(doc.id, doc)
      return jsonResponse(201, doc)
    }

    const docMatch = /^\/api\/docs\/([^/]+)$/.exec(path)
    if (docMatch) {
      const doc = docs.get(docMatch[1])
      if (method === 'GET') {
        return doc ? jsonResponse(200, doc) : jsonResponse(404, { error: 'not_found' })
      }
      if (method === 'PUT') {
        if (!doc) return jsonResponse(404, { error: 'not_found' })
        const body = JSON.parse(String(init.body)) as { title?: string; content?: string; baseVersion: number }
        if (typeof body.content === 'string' && new TextEncoder().encode(body.content).length > 1_000_000) {
          return jsonResponse(413, { error: 'too_large', limit: 1_000_000 })
        }
        if (body.baseVersion !== doc.version) {
          return jsonResponse(409, { error: 'conflict', doc })
        }
        if (body.title !== undefined) doc.title = body.title
        if (body.content !== undefined) doc.content = body.content
        doc.version += 1
        doc.updatedAt = Date.now()
        return jsonResponse(200, doc)
      }
      if (method === 'DELETE') {
        docs.delete(docMatch[1])
        return jsonResponse(204)
      }
    }

    const folderLinkMatch = /^\/api\/docs\/([^/]+)\/folder$/.exec(path)
    if (folderLinkMatch && method === 'PUT') {
      const doc = docs.get(folderLinkMatch[1])
      if (!doc) return jsonResponse(404, { error: 'not_found' })
      const body = JSON.parse(String(init.body)) as { folderId: string | null }
      doc.folderId = body.folderId
      return jsonResponse(200, doc)
    }

    const pinMatch = /^\/api\/docs\/([^/]+)\/pin$/.exec(path)
    if (pinMatch && method === 'PUT') {
      const doc = docs.get(pinMatch[1])
      if (!doc) return jsonResponse(404, { error: 'not_found' })
      const body = JSON.parse(String(init.body)) as { pinned: boolean }
      doc.pinnedAt = body.pinned ? Date.now() : null
      return jsonResponse(200, doc)
    }

    if (path === '/api/folders' && method === 'GET') return jsonResponse(200, [])

    return jsonResponse(404, { error: 'not_found' })
  }

  return {
    docs,
    setNetworkDown: (v: boolean) => {
      networkDown = v
    },
    setServerError: (v: boolean) => {
      serverError = v
    },
    bumpVersion: (id: string) => {
      const d = docs.get(id)
      if (d) {
        d.version += 1
        d.updatedAt = Date.now()
      }
    },
    fetchImpl,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('serverStore', () => {
  it('kind 는 server', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    expect(store.kind).toBe('server')
  })

  it('생성 → 보내기: 캐시에 즉시 반영되고, 서버에도 반영된다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const doc = await store.create({ title: '제목', content: '내용', lineEnding: 'lf' })
    // 캐시에 먼저 쓰고 즉시 resolve (2.3)
    expect(doc.title).toBe('제목')

    await tick()
    expect(server.docs.get(doc.id)?.content).toBe('내용')
    expect(store.syncState?.pending).toBe(0)
    const got = await store.get(doc.id)
    expect(got?.content).toBe('내용')
  })

  it('update 합치기: 보내기 전 여러 update 는 마지막 title·content 만 서버로 간다', async () => {
    const server = makeFakeServer()
    let releaseCreate = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseCreate = resolve
    })
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url, 'http://local.test').pathname
      if (init.method === 'POST' && path === '/api/docs') await gate
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await store.update(doc.id, { content: 'b' })
    await store.update(doc.id, { content: 'c' })
    releaseCreate()
    await tick(30)

    expect(server.docs.get(doc.id)?.content).toBe('c')
    const putCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'PUT')
    expect(putCalls.length).toBe(1)
  })

  it('409 충돌: 사본 문서를 만들고 원본 캐시는 서버 값으로 바꾼다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const conflicts: Array<{ docId: string; copyId: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), onConflict: (e) => conflicts.push(e) })

    const doc = await store.create({ title: '원본', content: 'a', lineEnding: 'lf' })
    await tick()
    server.bumpVersion(doc.id) // 다른 곳에서 먼저 바뀜

    await store.update(doc.id, { content: '내 편집' })
    await tick(30)

    expect(conflicts.length).toBe(1)
    expect(conflicts[0].docId).toBe(doc.id)

    const orig = await store.get(doc.id)
    expect(orig?.content).toBe('a') // 서버 내용으로 — 내 편집을 밀어 넣지 않는다(불변조건)

    const copy = await store.get(conflicts[0].copyId)
    expect(copy?.content).toBe('내 편집')
    expect(copy?.title).toBe('원본 (충돌 사본)')

    await tick(30) // 사본 create 도 전송된다
    expect(server.docs.get(conflicts[0].copyId)?.content).toBe('내 편집')
  })

  it('413: 목록에서 빼고 캐시는 남기고 알림을 띄운다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), onNotice: (n) => notices.push(n) })

    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick()
    const big = 'x'.repeat(1_000_001)
    await store.update(doc.id, { content: big })
    await tick(30)

    expect(store.syncState?.pending).toBe(0)
    expect(notices.some((n) => n.type === 'error')).toBe(true)
    expect(server.docs.get(doc.id)?.content).toBe('a')
    const cached = await store.get(doc.id)
    expect(cached?.content).toBe(big) // 캐시는 남는다
  })

  it('네트워크 실패: 목록에 남고 다음 쓰기 때 다시 보낸다', async () => {
    const server = makeFakeServer()
    server.setNetworkDown(true)
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick(20)
    expect(store.syncState?.pending).toBe(1)
    expect(store.syncState?.online).toBe(false)
    expect(server.docs.has(doc.id)).toBe(false)

    server.setNetworkDown(false)
    await store.create({ title: 'T2', content: 'b', lineEnding: 'lf' }) // 다음 쓰기 — 재시도 트리거
    await tick(30)

    expect(server.docs.get(doc.id)?.content).toBe('a')
    expect(store.syncState?.pending).toBe(0)
    expect(store.syncState?.online).toBe(true)
  })

  it('404 정리: update 대상이 서버에서 지워졌으면 목록·캐시에서 뺀다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick()
    server.docs.delete(doc.id) // 서버에서 지워짐

    await store.update(doc.id, { content: 'b' })
    await tick(30)

    expect(store.syncState?.pending).toBe(0)
    expect(await store.get(doc.id)).toBeNull()
  })
})
