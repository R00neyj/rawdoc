import 'fake-indexeddb/auto'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServerStore, QuotaExceededError, E2EE_SERVER_SAVE_INTERVAL_MS, PendingSyncError, BODY_FETCH_CONCURRENCY } from './serverStore'
import { createRemoteCache } from './remoteCache'
import { descendantFolderIds } from '../lib/folderTree'

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
  e2eeKey?: string
  attachmentRefs?: string[]
}

type FakeFolder = {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
  e2ee?: true
}

// 최소 F-206 흉내 — GET/POST /api/docs, GET/PUT/DELETE /api/docs/:id (specs/features/F-207.md 2.3)
function makeFakeServer() {
  const docs = new Map<string, FakeDoc>()
  const folders = new Map<string, FakeFolder>()
  // F-2042 U1 — GET /api/shared 흉내 (F-212.md 2.4). 문서 그대로 담아 두고 content 는 뺀다
  let shared: Array<Omit<FakeDoc, 'content'> & { role: 'edit' | 'view'; ownerEmail?: string; viaFolder?: unknown }> = []
  let networkDown = false
  let serverError = false
  let usage = { used: 0, limit: 314_572_800 }
  let forceUploadQuota = false
  let forceIdTaken = false
  // 금고 판정 흉내 (F-405 S1~S8) — worker/docs.ts·folders.ts 와 같은 409 몸통
  let hasVault = true
  const deleteFolderCalls: Array<{ id: string; contents: string | null }> = []
  // F-406 S1~S3 — 금고 첨부 PUT 요청 URL 기록, GET 응답을 조종한다
  const attachmentPutUrls: string[] = []
  const attachmentGetResponses = new Map<string, { contentType: string; bytes: number[] }>()

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
      if (forceIdTaken) return jsonResponse(409, { error: 'id_taken' })
      const body = JSON.parse(String(init.body)) as Partial<FakeDoc>
      if (body.id && docs.has(body.id)) return jsonResponse(200, docs.get(body.id))
      if (typeof body.folderId === 'string' && !body.e2eeKey && folders.get(body.folderId)?.e2ee) return jsonResponse(409, { error: 'e2ee_folder' })
      if (body.e2eeKey && !hasVault) return jsonResponse(409, { error: 'no_vault' })
      const now = Date.now()
      const doc: FakeDoc = {
        id: body.id ?? crypto.randomUUID(),
        title: body.title ?? '',
        content: body.content ?? '',
        lineEnding: body.lineEnding ?? 'lf',
        folderId: body.folderId ?? null,
        pinnedAt: typeof body.pinnedAt === 'number' ? body.pinnedAt : null,
        version: 1,
        createdAt: typeof body.createdAt === 'number' ? body.createdAt : now,
        updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : now,
        ...(body.e2eeKey ? { e2eeKey: body.e2eeKey, attachmentRefs: body.attachmentRefs ?? [] } : {}),
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
        const body = JSON.parse(String(init.body)) as { title?: string; content?: string; baseVersion: number; e2ee?: boolean; attachmentRefs?: string[] }
        if (typeof body.content === 'string' && new TextEncoder().encode(body.content).length > 1_000_000) {
          return jsonResponse(413, { error: 'too_large', limit: 1_000_000 })
        }
        if (doc.e2eeKey && body.e2ee !== true) return jsonResponse(409, { error: 'e2ee_doc' })
        if (!doc.e2eeKey && body.e2ee === true) return jsonResponse(409, { error: 'not_e2ee' })
        if (body.attachmentRefs !== undefined) doc.attachmentRefs = body.attachmentRefs
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
      if (body.folderId && folders.get(body.folderId)?.e2ee && !doc.e2eeKey) return jsonResponse(409, { error: 'e2ee_folder' })
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

    if (path === '/api/folders' && method === 'GET') {
      return jsonResponse(200, [...folders.values()])
    }
    if (path === '/api/folders' && method === 'POST') {
      const body = JSON.parse(String(init.body)) as Partial<FakeFolder>
      if (body.id && folders.has(body.id)) return jsonResponse(200, folders.get(body.id))
      if (body.parentId && folders.get(body.parentId)?.e2ee && body.e2ee !== true) return jsonResponse(409, { error: 'e2ee_folder' })
      const now = Date.now()
      const folder: FakeFolder = {
        id: body.id ?? crypto.randomUUID(),
        name: body.name ?? '',
        parentId: body.parentId ?? null,
        createdAt: now,
        updatedAt: now,
        ...(body.e2ee === true ? { e2ee: true as const } : {}),
      }
      folders.set(folder.id, folder)
      return jsonResponse(201, folder)
    }

    const folderMatch = /^\/api\/folders\/([^/]+)$/.exec(path)
    if (folderMatch) {
      const folder = folders.get(folderMatch[1])
      if (method === 'PUT') {
        if (!folder) return jsonResponse(404, { error: 'not_found' })
        const body = JSON.parse(String(init.body)) as { name?: string; parentId?: string | null }
        if (body.parentId && folders.get(body.parentId)?.e2ee && !folder.e2ee) return jsonResponse(409, { error: 'e2ee_folder' })
        if (body.name !== undefined) folder.name = body.name
        if (body.parentId !== undefined) folder.parentId = body.parentId
        folder.updatedAt = Date.now()
        return jsonResponse(200, folder)
      }
      if (method === 'DELETE') {
        deleteFolderCalls.push({ id: folderMatch[1], contents: new URL(String(url), 'http://local.test').searchParams.get('contents') })
        // F-242.md 3.4 — delete-all 은 하위 폴더·그 안 문서까지 서버에서 지운다
        if (new URL(String(url), 'http://local.test').searchParams.get('contents') === 'delete-all') {
          const ids = descendantFolderIds(
            [...folders.values()].map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
            folderMatch[1],
          )
          for (const [id, d] of docs) if (d.folderId && ids.includes(d.folderId)) docs.delete(id)
          for (const id of ids) folders.delete(id)
        } else {
          folders.delete(folderMatch[1])
        }
        return jsonResponse(204)
      }
    }

    if (path === '/api/shared' && method === 'GET') return jsonResponse(200, shared)

    if (path === '/api/usage' && method === 'GET') return jsonResponse(200, usage)

    // F-221 흉내: PUT /api/attachments/:idext — forceUploadQuota 면 507 (fakeServer.js 와 같은 형식)
    const attMatch = /^\/api\/attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)$/.exec(path)
    if (attMatch && method === 'PUT') {
      attachmentPutUrls.push(String(url))
      if (forceUploadQuota) return jsonResponse(507, { error: 'quota_exceeded', used: usage.used, limit: usage.limit })
      const [, id, ext] = attMatch
      return jsonResponse(201, { id, ext, mime: 'image/png', size: 1, width: 1, height: 1 })
    }
    // F-406 S2·S3 — GET /api/attachments/:idext, 응답은 attachmentGetResponses 로 미리 정한다
    if (attMatch && method === 'GET') {
      const key = `${attMatch[1]}.${attMatch[2]}`
      const rec = attachmentGetResponses.get(key)
      if (!rec) return jsonResponse(404, { error: 'not_found' })
      return new Response(new Uint8Array(rec.bytes), { status: 200, headers: { 'Content-Type': rec.contentType } })
    }

    return jsonResponse(404, { error: 'not_found' })
  }

  return {
    docs,
    folders,
    deleteFolderCalls,
    setNetworkDown: (v: boolean) => {
      networkDown = v
    },
    setServerError: (v: boolean) => {
      serverError = v
    },
    setUsage: (v: { used: number; limit: number }) => {
      usage = v
    },
    setForceUploadQuota: (v: boolean) => {
      forceUploadQuota = v
    },
    setForceIdTaken: (v: boolean) => {
      forceIdTaken = v
    },
    setHasVault: (v: boolean) => {
      hasVault = v
    },
    setShared: (list: typeof shared) => {
      shared = list
    },
    bumpVersion: (id: string) => {
      const d = docs.get(id)
      if (d) {
        d.version += 1
        d.updatedAt = Date.now()
      }
    },
    attachmentPutUrls,
    setAttachmentGetResponse: (idExt: string, contentType: string, bytes: number[]) => {
      attachmentGetResponses.set(idExt, { contentType, bytes })
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

  it('F-221 A2: used+미전송+새 크기가 한도를 넘으면 던지고 캐시에 쓰지 않는다', async () => {
    const server = makeFakeServer()
    server.setUsage({ used: 314_572_800 - 10, limit: 314_572_800 })
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const blob = new Blob([new Uint8Array(1000)])
    await expect(
      store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1 }),
    ).rejects.toBeInstanceOf(QuotaExceededError)

    expect(await store.listAttachments()).toEqual([])
  })

  it('F-221 A2: 사용량 조회 실패(오프라인)면 검사를 건너뛰고 그대로 저장한다', async () => {
    const server = makeFakeServer()
    server.setNetworkDown(true)
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const blob = new Blob([new Uint8Array(1000)])
    const result = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1 })
    expect(result.id).toBeTruthy()
    const list = await store.listAttachments()
    expect(list.map((a) => a.id)).toEqual([result.id])
  })

  it('F-221 A2: 보낼 목록에서 507 이면 항목을 빼고 알림을 띄운다(원문·캐시는 그대로)', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), onNotice: (n) => notices.push(n) })

    server.setForceUploadQuota(true)
    const blob = new Blob([new Uint8Array(1000)])
    const result = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1 })
    await tick(50)

    expect(store.syncState?.pending).toBe(0)
    expect(notices.some((n) => n.type === 'error' && n.message.includes('300MB'))).toBe(true)
    const list = await store.listAttachments()
    expect(list.map((a) => a.id)).toEqual([result.id]) // 캐시는 남는다
  })

  it('listFolders: 캐시가 비어도 서버 폴더 목록을 받아 캐시에 채운다 (다른 기기 첫 로그인)', async () => {
    const server = makeFakeServer()
    const now = Date.now()
    server.folders.set('f1', { id: 'f1', name: '업무', parentId: null, createdAt: now, updatedAt: now })
    server.folders.set('f2', { id: 'f2', name: '메모', parentId: 'f1', createdAt: now, updatedAt: now })
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const folders = await store.listFolders()
    expect(folders.map((f) => f.id).sort()).toEqual(['f1', 'f2'])
    expect(folders.find((f) => f.id === 'f2')?.parentId).toBe('f1')
  })

  it('listFolders: 서버에서 사라진 폴더는 캐시에서도 빠진다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const dbName = freshDbName()
    const store = await createServerStore('u1', { dbName })

    const folder = await store.createFolder({ name: '업무' })
    await tick()
    expect(server.folders.has(folder.id)).toBe(true)

    server.folders.delete(folder.id)
    expect(await store.listFolders()).toEqual([])
  })

  it('listFolders: 아직 못 보낸 폴더는 서버 목록에 없어도 캐시에서 지우지 않는다', async () => {
    const server = makeFakeServer()
    server.setNetworkDown(true)
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const folder = await store.createFolder({ name: '오프라인 폴더' })
    server.setNetworkDown(false)
    // 보내기 전에 목록을 받아도 대기 중인 폴더는 남아야 한다
    const folders = await store.listFolders()
    expect(folders.map((f) => f.id)).toEqual([folder.id])
  })

  it('listFolders: 오프라인이면 캐시 폴더를 그대로 돌려준다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const folder = await store.createFolder({ name: '업무' })
    await tick()

    server.setNetworkDown(true)
    const folders = await store.listFolders()
    expect(folders.map((f) => f.id)).toEqual([folder.id])
    expect(store.syncState?.online).toBe(false)
  })

  it('폴더 안 문서를 만들면 다른 기기에서도 그 폴더에 들어 있다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const folder = await store.createFolder({ name: '업무' })
    await store.create({ title: '문서', content: '내용', lineEnding: 'lf', folderId: folder.id })
    await tick()

    const other = await createServerStore('u1', { dbName: freshDbName() })
    const folders = await other.listFolders()
    const docs = await other.list()
    expect(folders.map((f) => f.id)).toEqual([folder.id])
    expect(docs[0].folderId).toBe(folder.id)
  })

  describe('폴더 삭제 모드 (F-242)', () => {
    it('delete-all: 캐시에서 하위 트리가 사라지고, 서버에 contents=delete-all 로 한 번 요청이 간다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const docInSub = await store.create({ title: '문서', content: '내용', lineEnding: 'lf', folderId: sub.id })
      await tick(20)

      await store.removeFolder(top.id, 'delete-all')
      await tick(30)

      const folders = await store.listFolders()
      expect(folders).toEqual([])
      expect(await store.get(docInSub.id)).toBeNull()

      expect(server.folders.has(top.id)).toBe(false)
      expect(server.folders.has(sub.id)).toBe(false)
      expect(server.docs.has(docInSub.id)).toBe(false)
      expect(server.deleteFolderCalls).toEqual([{ id: top.id, contents: 'delete-all' }])
    })

    it('mode 를 생략하면 move-up 요청이 간다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      await tick()

      await store.removeFolder(top.id)
      await tick(20)

      expect(server.deleteFolderCalls).toEqual([{ id: top.id, contents: 'move-up' }])
    })

    it('삭제 되살아남 (F-247) A1·A2: DELETE 가 서버에 닿기 전 재조정이 하위 폴더·그 안 문서를 되살리지 않는다', async () => {
      const server = makeFakeServer()
      let releaseDelete = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
      const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        const path = new URL(String(url), 'http://local.test').pathname
        if (method === 'DELETE' && /^\/api\/folders\//.test(path)) await gate
        return server.fetchImpl(url, init)
      })
      vi.stubGlobal('fetch', fetchSpy)
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const docInSub = await store.create({ title: '문서', content: '내용', lineEnding: 'lf', folderId: sub.id })
      await tick(20)

      await store.removeFolder(top.id, 'delete-all')
      // DELETE 가 아직 서버에 도달하지 않았다 — 서버 목록엔 위·아래가 그대로 있다
      const folders = await store.listFolders()
      const docs = await store.list()

      expect(folders.map((f) => f.id)).not.toContain(sub.id)
      expect(docs.map((d) => d.id)).not.toContain(docInSub.id)

      releaseDelete()
      await tick(30)
    })

    it('F-247 A3: move-up 뒤 재조정이 서버의 옛 parentId 로 덮지 않는다', async () => {
      const server = makeFakeServer()
      let releaseDelete = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
      const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        const path = new URL(String(url), 'http://local.test').pathname
        if (method === 'DELETE' && /^\/api\/folders\//.test(path)) await gate
        return server.fetchImpl(url, init)
      })
      vi.stubGlobal('fetch', fetchSpy)
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      await tick(20)

      await store.removeFolder(top.id, 'move-up')
      // 서버는 아직 옛 parentId(위) 를 답한다
      const folders = await store.listFolders()
      const subFolder = folders.find((f) => f.id === sub.id)
      expect(subFolder?.parentId).toBe(null) // 위로 올라간 값 — 지워진 폴더를 가리키지 않는다

      releaseDelete()
      await tick(30)
    })

    it('F-247 A4: outbox 가 빈 다음 재조정은 서버·캐시가 같아지고, 무관한 폴더는 지워지지 않는다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      await store.createFolder({ name: '아래', parentId: top.id })
      const other = await store.createFolder({ name: '무관' })
      await tick(20)

      await store.removeFolder(top.id, 'delete-all')
      await tick(30) // outbox 플러시 완료

      const folders = await store.listFolders()
      expect(folders.map((f) => f.id)).toEqual([other.id])
    })

    it('F-247 A6: 남의 삭제(outbox 의 removeFolder)는 무관한 새 폴더가 들어오는 것을 막지 않는다', async () => {
      const server = makeFakeServer()
      let releaseDelete = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseDelete = resolve
      })
      const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        const path = new URL(String(url), 'http://local.test').pathname
        if (method === 'DELETE' && /^\/api\/folders\//.test(path)) await gate
        return server.fetchImpl(url, init)
      })
      vi.stubGlobal('fetch', fetchSpy)
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      await tick(20)

      await store.removeFolder(top.id, 'delete-all')

      const now = Date.now()
      server.folders.set('b1', { id: 'b1', name: '무관', parentId: null, createdAt: now, updatedAt: now })

      const folders = await store.listFolders()
      expect(folders.map((f) => f.id)).toContain('b1')

      releaseDelete()
      await tick(30)
    })

    it('F-247 A5: 캐시에 없는 폴더를 지우려 하면 예외를 던지지 않는다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      await expect(store.removeFolder('00000000-0000-0000-0000-000000000000', 'delete-all')).resolves.toBeUndefined()
    })

    it('오프라인에서 폴더 안 문서를 고친 뒤 delete-all 하면 그 문서의 보낼 목록 항목이 남지 않는다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const top = await store.createFolder({ name: '위' })
      const doc = await store.create({ title: '문서', content: '내용', lineEnding: 'lf', folderId: top.id })
      await tick(20)

      server.setNetworkDown(true)
      await store.update(doc.id, { content: '오프라인 수정' })
      await tick(10)
      expect(store.syncState?.pending).toBe(1)

      await store.removeFolder(top.id, 'delete-all')
      server.setNetworkDown(false)
      await tick(30)

      expect(store.syncState?.pending).toBe(0)
      expect(await store.get(doc.id)).toBeNull()
    })
  })

  describe('가져오기 선택 필드 (F-282.md 3.11·3.14)', () => {
    it('create 에 id·createdAt·updatedAt·pinnedAt 을 주면 캐시·서버 모두에 그대로 실리고, 이미 있는 id 면 던진다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const doc = await store.create({ title: 'A', content: '내용', lineEnding: 'lf', id: 'fixed-id', createdAt: 111, updatedAt: 222, pinnedAt: 333 })
      expect(doc.id).toBe('fixed-id')
      expect(doc.createdAt).toBe(111)
      expect(doc.updatedAt).toBe(222)
      expect(doc.pinnedAt).toBe(333)

      await tick()
      expect(server.docs.get('fixed-id')?.createdAt).toBe(111)
      expect(server.docs.get('fixed-id')?.updatedAt).toBe(222)
      expect(server.docs.get('fixed-id')?.pinnedAt).toBe(333)

      await expect(store.create({ title: 'B', content: '', lineEnding: 'lf', id: 'fixed-id' })).rejects.toThrow()
    })

    it('createFolder 에 id 를 주면 그대로 쓰고, 이미 있는 id 면 던진다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const folder = await store.createFolder({ name: 'A', id: 'fixed-folder' })
      expect(folder.id).toBe('fixed-folder')

      await expect(store.createFolder({ name: 'B', id: 'fixed-folder' })).rejects.toThrow()
    })

    it('putAttachment 에 id 를 주면 WebP 변환을 건너뛰고, 이미 있으면 다시 올리지 않고 그대로 돌려준다', async () => {
      const server = makeFakeServer()
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const store = await createServerStore('u1', { dbName: freshDbName() })

      const blob = new Blob([new Uint8Array([1, 2, 3, 4])])
      const first = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1, id: 'fixedattachid01' })
      expect(first).toEqual({ id: 'fixedattachid01', ext: 'png' }) // webp 로 안 바뀐다

      const dup = await store.putAttachment({ blob: new Blob([new Uint8Array([9])]), mime: 'image/png', ext: 'png', width: 1, height: 1, id: 'fixedattachid01' })
      expect(dup).toEqual({ id: 'fixedattachid01', ext: 'png' })
    })

    it('id_taken 이면 전용 문구를 알린다', async () => {
      const server = makeFakeServer()
      server.setForceIdTaken(true)
      vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
      const notices: Array<{ type: string; message: string }> = []
      const store = await createServerStore('u1', { dbName: freshDbName(), onNotice: (n) => notices.push(n) })

      await store.create({ title: 'T', content: 'a', lineEnding: 'lf', id: 'clashing-id' })
      await tick(20)

      expect(notices.some((n) => n.message.includes('번호가 겹쳐'))).toBe(true)
    })
  })
})

describe('F-305 U20 hasPendingChanges', () => {
  it('createDoc·updateDoc 이 남아 있으면 참, setPinned·moveDoc 만 있거나 다른 문서 것이면 거짓', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const sent = await store.create({ title: '보낸 문서', content: 'a', lineEnding: 'lf' })
    const other = await store.create({ title: '다른 문서', content: 'b', lineEnding: 'lf' })
    await tick()
    expect(await store.hasPendingChanges(sent.id)).toBe(false)

    server.setNetworkDown(true)
    await store.setPinned(sent.id, true)
    await store.moveDoc(sent.id, null)
    await tick()
    expect(await store.hasPendingChanges(sent.id)).toBe(false)

    await store.update(other.id, { content: '다른 문서 편집' })
    await tick()
    expect(await store.hasPendingChanges(sent.id)).toBe(false)
    expect(await store.hasPendingChanges(other.id)).toBe(true)

    await store.update(sent.id, { title: '제목만' })
    await tick()
    expect(await store.hasPendingChanges(sent.id)).toBe(true)

    const created = await store.create({ title: '새 문서', content: '', lineEnding: 'lf' })
    await tick()
    expect(await store.hasPendingChanges(created.id)).toBe(true)
  })
})

describe('F-306 U26 첨부 uploaded·userId', () => {
  it('막 넣은 첨부는 uploaded false, 올린 뒤 true. userId 가 생성 인자와 같다', async () => {
    const server = makeFakeServer()
    server.setNetworkDown(true)
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u-306', { dbName: freshDbName() })
    expect(store.userId).toBe('u-306')

    const blob = new Blob([new Uint8Array(100)])
    const result = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1 })
    await tick(20)
    expect(await store.listAttachments()).toEqual([expect.objectContaining({ id: result.id, uploaded: false })])

    server.setNetworkDown(false)
    await store.create({ title: 'T', content: 'a', lineEnding: 'lf' }) // 다음 쓰기 — 재시도 트리거
    await tick(50)
    expect(await store.listAttachments()).toEqual([expect.objectContaining({ id: result.id, uploaded: true })])
  })
})

// F-2030 4장 — 429·413·403 을 받아도 outbox 항목을 지우지 않는다 (U7~U14)
describe('F-2030 한도·차단 outbox (U7~U14)', () => {
  // fakeServer.js 의 failWrites 를 흉내낸 로컬 주입기 — GET 아닌 요청만 가로챈다
  function makeInjector(server: ReturnType<typeof makeFakeServer>) {
    type Rule = { status: number; body?: unknown; headers?: Record<string, string>; times?: number; match?: (r: { method: string; path: string }) => boolean }
    let rule: Rule | null = null
    const writes: Array<{ method: string; path: string }> = []
    async function fetchImpl(url: string, init: RequestInit = {}): Promise<Response> {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (method !== 'GET') writes.push({ method, path })
      if (rule && method !== 'GET' && (!rule.match || rule.match({ method, path }))) {
        if (rule.times === undefined || rule.times > 0) {
          if (rule.times !== undefined) rule.times -= 1
          return new Response(rule.body === undefined ? null : JSON.stringify(rule.body), {
            status: rule.status,
            headers: { 'Content-Type': 'application/json', ...(rule.headers ?? {}) },
          })
        }
      }
      return server.fetchImpl(url, init)
    }
    return {
      fetchImpl,
      setRule: (r: Rule | null) => {
        rule = r
      },
      writes,
    }
  }

  it('U7·U8: 429 — 재개 시각까지 outbox 전체를 멈추고 L1 을 한 번만, 지나면 순서대로 나간다', async () => {
    const server = makeFakeServer()
    const injector = makeInjector(server)
    vi.stubGlobal('fetch', vi.fn(injector.fetchImpl))
    let fakeNow = Date.now()
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), now: () => fakeNow, onNotice: (n) => notices.push(n) })

    injector.setRule({ status: 429, headers: { 'Retry-After': '30' }, times: 1 })
    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick(20)

    expect(store.syncState?.pending).toBe(1)
    expect(notices.filter((n) => n.type === 'info').length).toBe(1)

    const writesBefore = injector.writes.length
    fakeNow += 29_000
    await store.create({ title: 'T2', content: 'b', lineEnding: 'lf' })
    await tick(20)
    expect(injector.writes.length).toBe(writesBefore) // 재개 시각 전엔 새 쓰기도 안 보낸다

    fakeNow += 2_000 // 총 31초 — 재개 시각을 지났다
    await store.update(doc.id, { content: 'later' })
    await tick(30)

    expect(server.docs.has(doc.id)).toBe(true) // 막혔던 항목부터 순서대로 나간다
    expect(store.syncState?.pending).toBe(0)
    expect(notices.filter((n) => n.type === 'info').length).toBe(1) // 다시 안 뜬다
  })

  it('U9: 429 day — error 알림이 rateLimitedDayMessage 와 같고 항목이 남는다', async () => {
    const server = makeFakeServer()
    const injector = makeInjector(server)
    vi.stubGlobal('fetch', vi.fn(injector.fetchImpl))
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), onNotice: (n) => notices.push(n) })

    injector.setRule({
      status: 429,
      headers: { 'Retry-After': '3600' },
      body: { error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 3600 },
      times: 1,
    })
    await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick(20)

    expect(notices.some((n) => n.type === 'error' && n.message.includes('하루 5,000번'))).toBe(true)
    expect(store.syncState?.pending).toBe(1)
  })

  it('U10·U11: 413 bytes — 그 문서만(뒤 항목 포함) 붙잡고 나머지는 보낸다, 30초 뒤 다시 나간다', async () => {
    const server = makeFakeServer()
    const injector = makeInjector(server)
    vi.stubGlobal('fetch', vi.fn(injector.fetchImpl))
    let fakeNow = Date.now()
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), now: () => fakeNow, onNotice: (n) => notices.push(n) })

    const docA = await store.create({ title: 'A', content: 'a', lineEnding: 'lf' })
    const docB = await store.create({ title: 'B', content: 'b', lineEnding: 'lf' })
    const docC = await store.create({ title: 'C', content: 'c', lineEnding: 'lf' })
    await tick(20)

    injector.setRule({
      status: 413,
      body: { error: 'doc_quota_exceeded', resource: 'bytes', used: 104857600, limit: 104857600 },
      match: ({ method, path }) => method === 'PUT' && path === `/api/docs/${docA.id}`,
    })
    await store.update(docA.id, { content: 'A 편집' })
    await store.setPinned(docA.id, true) // 뒤 항목, 같은 문서 — 함께 붙잡힌다
    await store.update(docB.id, { content: 'B 편집' })
    await store.remove(docC.id)
    await tick(30)

    expect(server.docs.get(docB.id)?.content).toBe('B 편집')
    expect(server.docs.has(docC.id)).toBe(false)
    expect(server.docs.get(docA.id)?.content).toBe('a') // A 는 서버에 반영 안 됨
    const cachedA = await store.get(docA.id)
    expect(cachedA?.content).toBe('A 편집') // 캐시는 내 편집 그대로
    expect(notices.filter((n) => n.type === 'error' && n.message.includes('100MB')).length).toBe(1)
    expect(store.syncState?.pending).toBeGreaterThanOrEqual(2)

    // U11 앞부분 — 30초 안에 다시 편집해도 요청이 늘지 않는다
    const writesBefore = injector.writes.filter((w) => w.path === `/api/docs/${docA.id}` && w.method === 'PUT').length
    await store.update(docA.id, { content: 'A 다시' })
    await tick(20)
    const writesAfter = injector.writes.filter((w) => w.path === `/api/docs/${docA.id}` && w.method === 'PUT').length
    expect(writesAfter).toBe(writesBefore)

    // U11 뒷부분 — 30초 지나고 서버가 받아주면 나간다
    injector.setRule(null)
    fakeNow += 31_000
    await store.setPinned(docB.id, false) // 다른 쓰기로 kickSend 를 다시 건다
    await tick(30)
    expect(server.docs.get(docA.id)?.content).toBe('A 다시')
  })

  it('U12: 413 docs — outbox 의 모든 createDoc 을 붙잡아 Y 는 시도조차 안 한다', async () => {
    const server = makeFakeServer()
    const injector = makeInjector(server)
    vi.stubGlobal('fetch', vi.fn(injector.fetchImpl))
    let fakeNow = Date.now()
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), now: () => fakeNow, onNotice: (n) => notices.push(n) })

    const docZ = await store.create({ title: 'Z', content: 'z', lineEnding: 'lf' })
    await tick(20)

    // 네 항목이 outbox 에 모두 쌓인 뒤에 한 회차로 처리되도록, 쌓는 동안은 429 로 전체를 멈춰 둔다(재시도 왕복 없이)
    injector.setRule({ status: 429, headers: { 'Retry-After': '30' }, times: 1 })
    const docX = await store.create({ title: 'X', content: 'x', lineEnding: 'lf' })
    await tick(20)
    await store.update(docX.id, { content: 'x2' })
    const docY = await store.create({ title: 'Y', content: 'y', lineEnding: 'lf' })
    await store.remove(docZ.id)
    await tick(20)

    const marker = injector.writes.length
    injector.setRule({
      status: 413,
      body: { error: 'doc_quota_exceeded', resource: 'docs', used: 10000, limit: 10000 },
      match: ({ method, path }) => method === 'POST' && path === '/api/docs',
    })
    fakeNow += 31_000 // 429 재개 시각을 지난다
    await store.setPinned(docY.id, true) // 다른 쓰기로 kickSend 를 다시 건다
    await tick(30)

    const postCount = injector.writes.slice(marker).filter((w) => w.method === 'POST' && w.path === '/api/docs').length
    expect(postCount).toBe(1) // X 만 시도, Y 는 시도조차 안 한다
    expect(server.docs.has(docX.id)).toBe(false) // 만들기 전에 PUT 이 안 나가 404 가 안 난다
    expect(await store.get(docX.id)).not.toBeNull() // 캐시엔 X 가 남는다
    expect(await store.get(docY.id)).not.toBeNull()
    expect(server.docs.has(docZ.id)).toBe(false) // 무관한 삭제는 나간다
    expect(notices.filter((n) => n.type === 'error' && n.message.includes('10,000개')).length).toBe(1)
  })

  it('U13·U14: 403 account_blocked — 차단 멈춤, 재개 뒤 그 문서만 영구히 건너뛰고 나머지는 나간다', async () => {
    const server = makeFakeServer()
    const injector = makeInjector(server)
    vi.stubGlobal('fetch', vi.fn(injector.fetchImpl))
    const notices: Array<{ type: string; message: string }> = []
    const forbiddenIds: string[] = []
    let blockedCalls = 0
    const store = await createServerStore('u1', {
      dbName: freshDbName(),
      onNotice: (n) => notices.push(n),
      onForbidden: (id) => forbiddenIds.push(id),
      onAccountBlocked: () => {
        blockedCalls++
      },
    })

    const docA = await store.create({ title: 'A', content: 'a', lineEnding: 'lf' })
    const docB = await store.create({ title: 'B', content: 'b', lineEnding: 'lf' })
    await tick(20)

    injector.setRule({ status: 403, body: { error: 'account_blocked' } })
    await store.update(docA.id, { content: 'A 편집' })
    await tick(20)
    expect(blockedCalls).toBe(1)

    const writesBefore = injector.writes.length
    await store.update(docB.id, { content: 'B 시도' })
    await tick(20)
    expect(injector.writes.length).toBe(writesBefore) // U13 — 추가 요청 0

    store.setAccountBlocked(true)
    await tick(10)
    expect(injector.writes.length).toBe(writesBefore) // setAccountBlocked(true) 뒤에도 0

    injector.setRule(null) // 이제 서버는 정상 처리
    store.setAccountBlocked(false)
    await tick(30)

    expect(forbiddenIds).toEqual([docA.id]) // U14
    expect(notices.some((n) => n.type === 'error' && n.message === '이 문서를 편집할 권한이 없어졌습니다.')).toBe(true)
    expect(server.docs.get(docB.id)?.content).toBe('B 시도') // 다른 문서는 나간다
    expect(server.docs.get(docA.id)?.content).toBe('a') // A 는 다시 보내지 않는다
  })
})

// ----- F-405 S1~S8 금고 문서 보내기 (specs/features/F-405.md 5장, 9.1) -----
const VAULT_KEY = 'K'.repeat(56)
const E21 = '다른 곳에서 먼저 바뀐 금고 문서가 있습니다. 금고를 열면 이 기기의 편집을 충돌 사본으로 저장합니다.'
const E22 = '다른 곳에서 이 문서를 금고로 옮겨, 이 기기에서 아직 올리지 못한 편집은 저장하지 않았습니다.'
const E23 = '금고 폴더로 바뀐 폴더에 만든 문서·폴더를 맨 위로 옮겨 저장했습니다.'
const E24 = '금고가 초기화되어 이 기기에서 만든 금고 문서를 올리지 못했습니다.'

type FetchMock = ReturnType<typeof vi.fn>

function requestsOf(fetchMock: FetchMock, method: string, path: string | RegExp): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url, init]) => {
      const m = ((init as RequestInit | undefined)?.method ?? 'GET') === method
      const p = new URL(String(url), 'http://local.test').pathname
      return m && (typeof path === 'string' ? p === path : path.test(p))
    })
    .map(([, init]) => ((init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : {}))
}

function seedDoc(server: ReturnType<typeof makeFakeServer>, id: string, extra: Partial<FakeDoc> = {}) {
  server.docs.set(id, {
    id,
    title: `${id}-t`,
    content: `${id}-c`,
    lineEnding: 'lf',
    folderId: null,
    pinnedAt: null,
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  })
}

describe('F-405 S1 금고 표지', () => {
  it('금고 캐시 행 update 는 outbox e2ee:true, PUT 몸통 e2ee·attachmentRefs. 일반 PUT 에는 e2ee 키가 없다', async () => {
    const server = makeFakeServer()
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const dbName = freshDbName()
    let fakeNow = 0
    const store = await createServerStore('u1', { dbName, now: () => fakeNow })

    const vault = await store.create({ title: 'env-t', content: 'env-c', lineEnding: 'lf', e2eeKey: VAULT_KEY, attachmentRefs: [] })
    const plain = await store.create({ title: 'P', content: 'p', lineEnding: 'lf' })
    await tick(30)
    const posts = requestsOf(fetchMock, 'POST', '/api/docs')
    expect(posts.find((b) => b.id === vault.id)).toMatchObject({ e2eeKey: VAULT_KEY, attachmentRefs: [] })
    expect('e2eeKey' in posts.find((b) => b.id === plain.id)!).toBe(false)

    fakeNow = 20_000
    server.setNetworkDown(true)
    await store.update(vault.id, { content: 'env-c2', attachmentRefs: ['00000000000000aa'] })
    await tick()
    const cache = await createRemoteCache(dbName)
    const item = (await cache.getOutbox('u1')).find((e) => e.type === 'updateDoc' && e.docId === vault.id)
    expect(item).toMatchObject({ e2ee: true })

    server.setNetworkDown(false)
    await store.update(plain.id, { content: 'p2' })
    await tick(30)
    const vaultPut = requestsOf(fetchMock, 'PUT', `/api/docs/${vault.id}`).at(-1)!
    expect(vaultPut).toMatchObject({ e2ee: true, attachmentRefs: ['00000000000000aa'], content: 'env-c2' })
    const plainPut = requestsOf(fetchMock, 'PUT', `/api/docs/${plain.id}`).at(-1)!
    expect('e2ee' in plainPut).toBe(false)
    expect('attachmentRefs' in plainPut).toBe(false)
  })
})

describe('F-405 S2 10초 간격 (주입 시계)', () => {
  it('응답 뒤 10,000ms 전에는 그 문서 PUT 을 보내지 않고 합친다. 다른 문서는 나간다', async () => {
    expect(E2EE_SERVER_SAVE_INTERVAL_MS).toBe(10_000)
    const server = makeFakeServer()
    seedDoc(server, 'v', { e2eeKey: VAULT_KEY, attachmentRefs: [] })
    seedDoc(server, 'p')
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    let fakeNow = 0
    const store = await createServerStore('u1', { dbName: freshDbName(), now: () => fakeNow })
    await store.list()
    const putsOf = (id: string) => requestsOf(fetchMock, 'PUT', `/api/docs/${id}`)

    await store.update('v', { content: 'c0' })
    await tick(30)
    expect(putsOf('v').length).toBe(1)

    fakeNow = 1_000
    await store.update('v', { content: 'c1' })
    await tick(30)
    fakeNow = 5_000
    await store.update('v', { content: 'c5' })
    await store.update('p', { content: 'p5' })
    await tick(30)
    expect(putsOf('v').length).toBe(1)
    expect(putsOf('p').length).toBe(1)
    expect(store.syncState?.pending).toBe(1)

    fakeNow = 9_999
    await store.update('p', { content: 'p9' })
    await tick(30)
    expect(putsOf('v').length).toBe(1)

    fakeNow = 10_000
    await store.update('p', { content: 'p10' })
    await tick(30)
    expect(putsOf('v').length).toBe(2)
    expect(putsOf('v').at(-1)).toMatchObject({ content: 'c5', e2ee: true })
  })
})

describe('F-405 S3 금고 409 — 사본 함수가 값을 준다', () => {
  it('주입 함수의 봉투로 createDoc, onConflict 한 번, 원본 캐시는 서버 값', async () => {
    const server = makeFakeServer()
    seedDoc(server, 'v', { e2eeKey: VAULT_KEY, attachmentRefs: [], folderId: 'F' })
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const conflicts: Array<{ docId: string; copyId: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), onConflict: (e) => conflicts.push(e) })
    await store.list()
    const copyResult = { title: 'CT', content: 'CC', e2eeKey: 'N'.repeat(56), attachmentRefs: ['00000000000000aa'] }
    const maker = vi.fn(async () => copyResult)
    store.setE2eeCopyMaker(maker)

    server.bumpVersion('v')
    await store.update('v', { content: 'mine' })
    await tick(40)

    expect(maker).toHaveBeenCalledTimes(1)
    expect((maker.mock.calls[0] as unknown[])[0]).toEqual({ id: 'v', title: 'v-t', content: 'mine', e2eeKey: VAULT_KEY })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].docId).toBe('v')
    expect((maker.mock.calls[0] as unknown[])[1]).toBe(conflicts[0].copyId)
    const copyPost = requestsOf(fetchMock, 'POST', '/api/docs').find((b) => b.id === conflicts[0].copyId)
    expect(copyPost).toMatchObject({ title: 'CT', content: 'CC', e2eeKey: 'N'.repeat(56), attachmentRefs: ['00000000000000aa'], folderId: 'F' })
    expect((await store.get('v'))?.content).toBe('v-c')
  })
})

describe('F-405 S4 금고 409 — 잠겨 있어 사본 함수가 null', () => {
  it('항목을 두고 그 문서만 멈춘다, E21 한 번, 풀리면 S3 과 같다', async () => {
    const server = makeFakeServer()
    seedDoc(server, 'v', { e2eeKey: VAULT_KEY, attachmentRefs: [] })
    seedDoc(server, 'p')
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const conflicts: Array<{ docId: string; copyId: string }> = []
    const notices: Array<{ type: string; message: string }> = []
    let fakeNow = 0
    const store = await createServerStore('u1', {
      dbName: freshDbName(),
      now: () => fakeNow,
      onConflict: (e) => conflicts.push(e),
      onNotice: (n) => notices.push(n),
    })
    await store.list()
    let give = false
    const maker = vi.fn(async () => (give ? { title: 'CT', content: 'CC', e2eeKey: 'N'.repeat(56), attachmentRefs: [] } : null))
    store.setE2eeCopyMaker(maker)

    server.bumpVersion('v')
    await store.update('v', { content: 'mine' })
    await tick(30)
    expect(requestsOf(fetchMock, 'POST', '/api/docs')).toHaveLength(0)
    expect(conflicts).toHaveLength(0)
    expect(notices.filter((n) => n.message === E21)).toHaveLength(1)
    expect(store.syncState?.pending).toBe(1)

    fakeNow = 30_000
    await store.update('v', { content: 'mine2' })
    await store.update('p', { content: 'p1' })
    await tick(30)
    expect(requestsOf(fetchMock, 'PUT', '/api/docs/v')).toHaveLength(1)
    expect(requestsOf(fetchMock, 'PUT', '/api/docs/p')).toHaveLength(1)
    await store.update('p', { content: 'p2' })
    await tick(30)
    expect(notices.filter((n) => n.message === E21)).toHaveLength(1)

    give = true
    fakeNow = 60_000
    store.resumeE2eeConflicts()
    await tick(40)
    expect(conflicts).toHaveLength(1)
    expect((maker.mock.calls.at(-1) as unknown[])[0]).toMatchObject({ id: 'v', content: 'mine2' })
    expect(requestsOf(fetchMock, 'POST', '/api/docs').find((b) => b.id === conflicts[0].copyId)).toMatchObject({ title: 'CT', e2eeKey: 'N'.repeat(56) })
  })

  it('not_e2ee 409 도 같은 길 — 서버 값은 GET 으로', async () => {
    const server = makeFakeServer()
    seedDoc(server, 'w')
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const dbName = freshDbName()
    const conflicts: Array<{ docId: string; copyId: string }> = []
    const store = await createServerStore('u1', { dbName, onConflict: (e) => conflicts.push(e) })
    const cache = await createRemoteCache(dbName)
    await cache.putDoc('u1', { ...server.docs.get('w')!, lineEnding: 'lf', e2eeKey: VAULT_KEY, attachmentRefs: [] })
    store.setE2eeCopyMaker(async () => ({ title: 'CT', content: 'CC', e2eeKey: 'N'.repeat(56), attachmentRefs: [] }))

    await store.update('w', { content: 'env' })
    await tick(40)
    expect(conflicts).toHaveLength(1)
    expect(requestsOf(fetchMock, 'GET', '/api/docs/w').length).toBeGreaterThan(0)
    const orig = await cache.getDoc('u1', 'w')
    expect(orig?.content).toBe('w-c')
    expect(orig?.e2eeKey).toBeUndefined()
  })
})

describe('F-405 S5 일반 updateDoc 이 409 e2ee_doc', () => {
  it('사본 없이 그 문서 항목을 모두 빼고 캐시는 GET 값, E22', async () => {
    const server = makeFakeServer()
    seedDoc(server, 'x', { e2eeKey: VAULT_KEY, attachmentRefs: [] })
    seedDoc(server, 'p')
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const dbName = freshDbName()
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName, onNotice: (n) => notices.push(n) })
    await store.list()
    const cache = await createRemoteCache(dbName)
    const { e2eeKey: _k, attachmentRefs: _r, ...plainRow } = (await cache.getDoc('u1', 'x'))!
    await cache.putDoc('u1', plainRow)

    server.setNetworkDown(true)
    await store.update('x', { content: '옛 평문 편집' })
    await store.setPinned('x', true)
    await tick()
    server.setNetworkDown(false)
    await store.update('p', { content: 'p1' })
    await tick(40)

    expect(requestsOf(fetchMock, 'POST', '/api/docs')).toHaveLength(0)
    expect(requestsOf(fetchMock, 'PUT', '/api/docs/x/pin')).toHaveLength(0)
    expect(store.syncState?.pending).toBe(0)
    expect((await cache.getDoc('u1', 'x'))?.e2eeKey).toBe(VAULT_KEY)
    expect(server.docs.get('x')?.content).toBe('x-c')
    expect(notices.filter((n) => n.message === E22)).toHaveLength(1)
  })
})

describe('F-405 S6 createDoc 409', () => {
  it('e2ee_folder — folderId 를 null 로 바꿔 다시 보낸다, E23', async () => {
    const server = makeFakeServer()
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName: freshDbName(), onNotice: (n) => notices.push(n) })
    server.folders.set('F', { id: 'F', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 })
    await store.listFolders()
    server.folders.get('F')!.e2ee = true

    const doc = await store.create({ title: 'N', content: '', lineEnding: 'lf', folderId: 'F' })
    await tick(40)
    const posts = requestsOf(fetchMock, 'POST', '/api/docs').filter((b) => b.id === doc.id)
    expect(posts).toHaveLength(2)
    expect(posts[1].folderId).toBeNull()
    expect(server.docs.get(doc.id)?.folderId).toBeNull()
    expect((await store.get(doc.id))?.folderId).toBeNull()
    expect(notices.filter((n) => n.message === E23 && n.type === 'info')).toHaveLength(1)
  })

  it('no_vault — 캐시 행·항목이 사라지고 E24', async () => {
    const server = makeFakeServer()
    server.setHasVault(false)
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const dbName = freshDbName()
    const notices: Array<{ type: string; message: string }> = []
    const store = await createServerStore('u1', { dbName, onNotice: (n) => notices.push(n) })

    const doc = await store.create({ title: 'env', content: 'env', lineEnding: 'lf', e2eeKey: VAULT_KEY, attachmentRefs: [] })
    await tick(40)
    const cache = await createRemoteCache(dbName)
    expect(await cache.getDoc('u1', doc.id)).toBeNull()
    expect(store.syncState?.pending).toBe(0)
    expect(notices.filter((n) => n.message === E24 && n.type === 'error')).toHaveLength(1)
  })
})

describe('F-405 S7 importLocal 은 금고를 건너뛴다', () => {
  it('일반 것만 outbox 에, importedCount 도 일반 것만', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const base = { lineEnding: 'lf' as const, pinnedAt: null, createdAt: 1, updatedAt: 1 }
    const result = await store.importLocal({
      folders: [
        { id: 'f1', name: 'F1', parentId: null, createdAt: 1, updatedAt: 1 },
        { id: 'fv', name: 'FV', parentId: null, createdAt: 1, updatedAt: 1, e2ee: true },
      ],
      docs: [
        { id: 'd1', title: 'D1', content: '보통', folderId: 'f1', ...base },
        { id: 'dv', title: 'env', content: 'env', folderId: 'fv', e2eeKey: VAULT_KEY, attachmentRefs: [], ...base },
      ],
    })
    expect(result.importedCount).toBe(1)
    await tick(40)
    expect(server.docs.has('d1')).toBe(true)
    expect(server.docs.has('dv')).toBe(false)
    expect(server.folders.has('f1')).toBe(true)
    expect(server.folders.has('fv')).toBe(false)
  })
})

describe('F-405 S8 createFolder e2ee·flushOutbox', () => {
  it('POST 몸통 e2ee:true', async () => {
    const server = makeFakeServer()
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const folder = await store.createFolder({ name: 'V', e2ee: true })
    await tick(30)
    expect(requestsOf(fetchMock, 'POST', '/api/folders').at(-1)).toMatchObject({ id: folder.id, e2ee: true })
    expect(server.folders.get(folder.id)?.e2ee).toBe(true)
  })

  it('remove 두 개 뒤 flushOutbox 가 끝나면 DELETE 두 번이 이미 나갔다', async () => {
    const server = makeFakeServer()
    let deletesDone = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (init.method === 'DELETE') {
          await new Promise((resolve) => setTimeout(resolve, 20))
          const res = await server.fetchImpl(url, init)
          deletesDone += 1
          return res
        }
        return server.fetchImpl(url, init)
      }),
    )
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const a = await store.create({ title: 'A', content: '', lineEnding: 'lf' })
    const b = await store.create({ title: 'B', content: '', lineEnding: 'lf' })
    await tick(30)
    await store.remove(a.id)
    await store.remove(b.id)
    expect(deletesDone).toBe(0)
    await store.flushOutbox()
    expect(deletesDone).toBe(2)
  })
})

describe('F-406 S1 putAttachment e2ee', () => {
  it('캐시 행 e2ee:true, 변환 없이 같은 바이트, 요청 URL 에 e2ee=1&w=640&h=480. 일반 putAttachment 는 쿼리 없음', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const envelopeBytes = new Uint8Array([1, 2, 3, 4, 5])
    const blob = new Blob([envelopeBytes])
    const id = 'aaaaaaaaaaaaaaaa'
    const result = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 640, height: 480, id, e2ee: true })
    expect(result).toEqual({ id, ext: 'png' })

    const record = await store.getAttachment(id)
    expect(record!.e2ee).toBe(true)
    expect(new Uint8Array(await record!.blob.arrayBuffer())).toEqual(envelopeBytes)

    await tick(30)
    expect(server.attachmentPutUrls.at(-1)).toBe(`/api/attachments/${id}.png?e2ee=1&w=640&h=480`)

    const plain = await store.putAttachment({ blob: new Blob([new Uint8Array([9])]), mime: 'image/png', ext: 'png', width: 1, height: 1 })
    await tick(30)
    const plainUrl = server.attachmentPutUrls.find((u) => u.includes(plain.id))
    expect(plainUrl).toBe(`/api/attachments/${plain.id}.png`)
  })
})

describe('F-406 S2·S3 getAttachment(id, hint) — 다른 기기 금고 이미지', () => {
  it('캐시·문서 어디에도 없는 id — application/octet-stream 은 봉투, 이미지 mime 은 지금 그대로, 힌트 없으면 요청 없이 null', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store1 = await createServerStore('u1', { dbName: freshDbName() })
    const id1 = 'bbbbbbbbbbbbbbbb'
    server.setAttachmentGetResponse(`${id1}.webp`, 'application/octet-stream', [1, 2, 3, 4, 5])
    const got1 = await store1.getAttachment(id1, { ext: 'webp' })
    expect(got1).toMatchObject({ e2ee: true, mime: 'image/webp', width: 0, height: 0 })

    const store2 = await createServerStore('u2', { dbName: freshDbName() })
    const id2 = 'cccccccccccccccc'
    server.setAttachmentGetResponse(`${id2}.png`, 'image/png', [1, 2, 3])
    const got2 = await store2.getAttachment(id2, { ext: 'png' })
    expect(got2).not.toBeNull()
    expect('e2ee' in got2!).toBe(false)

    const store3 = await createServerStore('u3', { dbName: freshDbName() })
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockClear()
    expect(await store3.getAttachment('dddddddddddddddd')).toBeNull()
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('dddddddddddddddd'))).toBe(false)
  })

  it('캐시 문서 본문에 참조가 있으면 힌트를 줘도 ?doc= 로 받는다(본문이 힌트보다 앞)', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const id = 'eeeeeeeeeeeeeeee'
    await store.create({ title: 'D', content: `![](attachments/${id}.png)`, lineEnding: 'lf' })
    await tick(30)
    server.setAttachmentGetResponse(`${id}.png`, 'image/png', [1, 2, 3])

    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    await store.getAttachment(id, { ext: 'webp' })
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes(`${id}.png`))
    expect(String(call![0])).toContain(`?doc=`)
  })
})

describe('F-406 S7 진행 중인 같은 id 요청 합치기', () => {
  it('동시에 두 번 부르면 fetch 는 한 번, 끝난 뒤 다시 부르면 캐시에서(추가 fetch 없이)', async () => {
    const server = makeFakeServer()
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const id = '1111111111111111'
    server.setAttachmentGetResponse(`${id}.png`, 'image/png', [1, 2, 3])
    fetchMock.mockClear()

    const [a, b] = await Promise.all([store.getAttachment(id, { ext: 'png' }), store.getAttachment(id, { ext: 'png' })])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const attCallsFirst = fetchMock.mock.calls.filter((c) => String(c[0]).includes(`${id}.png`))
    expect(attCallsFirst).toHaveLength(1)

    fetchMock.mockClear()
    const c = await store.getAttachment(id, { ext: 'png' })
    expect(c).not.toBeNull()
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes(`${id}.png`))).toHaveLength(0)
  })

  it('실패해도 Map 에서 빠져, 다음 호출은 새로 시도한다', async () => {
    const server = makeFakeServer()
    const fetchMock = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchMock)
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const id = '2222222222222222'
    fetchMock.mockClear()

    const first = await store.getAttachment(id, { ext: 'png' }) // 응답 준비 전 — 404 로 실패
    expect(first).toBeNull()

    server.setAttachmentGetResponse(`${id}.png`, 'image/png', [1, 2, 3])
    const second = await store.getAttachment(id, { ext: 'png' })
    expect(second).not.toBeNull()
  })
})

describe('F-406 S4 금고 올리기 400 invalid·409 e2ee_mismatch', () => {
  it('둘 다 outbox 에서 항목이 빠지고 알림이 한 번', async () => {
    for (const failure of [
      { status: 400, body: { error: 'invalid', field: 'body' } },
      { status: 409, body: { error: 'e2ee_mismatch' } },
    ]) {
      const server = makeFakeServer()
      const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(String(url), 'http://local.test').pathname
        if (/^\/api\/attachments\//.test(path) && init.method === 'PUT') {
          return new Response(JSON.stringify(failure.body), { status: failure.status, headers: { 'Content-Type': 'application/json' } })
        }
        return server.fetchImpl(url, init)
      })
      vi.stubGlobal('fetch', fetchMock)
      const notices: Array<{ type: string; message: string }> = []
      const store = await createServerStore('u1', { dbName: freshDbName(), onNotice: (n) => notices.push(n) })

      const id = 'ffffffffffffffff'
      await store.putAttachment({ blob: new Blob([new Uint8Array([1, 2, 3])]), mime: 'image/png', ext: 'png', width: 1, height: 1, id, e2ee: true })
      await tick(30)

      expect(store.syncState?.pending).toBe(0)
      expect(notices.filter((n) => n.message === '이미지를 서버에 올리지 못했습니다.').length).toBe(1)
    }
  })
})

// ----- F-407 S3~S8 (specs/features/F-407.md 5.2, 9.1) — 옮기기 라우트·폴더 표지·곧바로 올리기·첨부 지우기 -----

type ConvertLog = { method: string; path: string; search: string; body?: unknown }

// makeFakeServer 위에 옮기기 라우트·폴더 e2ee·첨부 DELETE 를 더한다 (F-401 3.4 판정 중 이 테스트가 쓰는 것만)
function withConvertRoutes(server: ReturnType<typeof makeFakeServer>) {
  const log: ConvertLog[] = []
  const deleteStatus = new Map<string, number>()
  let putRateLimited = false
  let holdE2ee: Promise<void> | null = null
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET'
    const u = new URL(String(url), 'http://local.test')
    let body: unknown
    try {
      body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    } catch {
      body = undefined
    }
    log.push({ method, path: u.pathname, search: u.search, body })
    const e2eeMatch = /^\/api\/docs\/([^/]+)\/e2ee$/.exec(u.pathname)
    if (e2eeMatch && method === 'PUT') {
      if (holdE2ee) await holdE2ee
      const doc = server.docs.get(e2eeMatch[1])
      if (!doc) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
      const b = body as { e2eeKey: string | null; title: string; content: string; attachmentRefs: string[] | null; baseVersion: number }
      if (b.baseVersion !== doc.version) return new Response(JSON.stringify({ error: 'conflict', doc }), { status: 409 })
      doc.title = b.title
      doc.content = b.content
      doc.version += 1
      if (b.e2eeKey) {
        doc.e2eeKey = b.e2eeKey
        doc.attachmentRefs = b.attachmentRefs ?? []
      } else {
        delete doc.e2eeKey
        delete doc.attachmentRefs
      }
      return new Response(JSON.stringify({ ...doc, purged: false }), { status: 200 })
    }
    const folderMatch = /^\/api\/folders\/([^/]+)$/.exec(u.pathname)
    if (folderMatch && method === 'PUT' && body && typeof (body as { e2ee?: unknown }).e2ee === 'boolean') {
      const folder = server.folders.get(folderMatch[1])
      if (!folder) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })
      if ((body as { e2ee: boolean }).e2ee) folder.e2ee = true
      else delete folder.e2ee
      return new Response(JSON.stringify(folder), { status: 200 })
    }
    const attMatch = /^\/api\/attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)$/.exec(u.pathname)
    if (attMatch && method === 'DELETE') {
      const status = deleteStatus.get(attMatch[1]) ?? 204
      if (status === 409) return new Response(JSON.stringify({ error: 'in_use' }), { status })
      return new Response(status === 204 ? null : JSON.stringify({ error: 'not_found' }), { status })
    }
    if (attMatch && method === 'PUT' && putRateLimited) {
      return new Response(JSON.stringify({ error: 'rate_limited', scope: 'minute', limit: 120, retryAfter: 60 }), { status: 429, headers: { 'Retry-After': '60' } })
    }
    return server.fetchImpl(url, init)
  }
  return {
    log,
    fetchImpl,
    setDeleteStatus: (id: string, status: number) => deleteStatus.set(id, status),
    setPutRateLimited: (v: boolean) => {
      putRateLimited = v
    },
    hold: () => {
      let release = () => {}
      holdE2ee = new Promise<void>((resolve) => {
        release = () => {
          holdE2ee = null
          resolve()
        }
      })
      return release
    },
  }
}

async function convertSetup() {
  const server = makeFakeServer()
  const routes = withConvertRoutes(server)
  vi.stubGlobal('fetch', vi.fn(routes.fetchImpl))
  const dbName = freshDbName()
  const store = await createServerStore('u1', { dbName })
  const cache = await createRemoteCache(dbName)
  return { server, routes, store, cache }
}

describe('F-407 S3 setDocE2ee 성공', () => {
  it('PUT 한 번(baseVersion = 캐시 version), 그 문서 updateDoc 둘이 사라지고 캐시 = 응답, purged 그대로', async () => {
    const { server, routes, store, cache } = await convertSetup()
    const doc = await store.create({ title: 't', content: 'c', lineEnding: 'lf' })
    await tick()
    expect(server.docs.get(doc.id)?.version).toBe(1)
    await cache.addOutbox('u1', { type: 'updateDoc', docId: doc.id, patch: { content: 'x' } })
    await cache.addOutbox('u1', { type: 'updateDoc', docId: doc.id, patch: { content: 'y' } })

    const res = await store.setDocE2ee!(doc.id, { e2ee: true, title: 'ENV-T', content: 'ENV-C', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })
    const puts = routes.log.filter((r) => r.method === 'PUT' && r.path === `/api/docs/${doc.id}/e2ee`)
    expect(puts).toHaveLength(1)
    expect(puts[0].body).toEqual({ e2eeKey: 'K'.repeat(56), title: 'ENV-T', content: 'ENV-C', attachmentRefs: [], baseVersion: 1 })
    expect(res.purged).toBe(false)
    expect(res.doc.e2eeKey).toBe('K'.repeat(56))
    expect((await cache.getOutbox('u1')).filter((e) => e.type === 'updateDoc' && e.docId === doc.id)).toHaveLength(0)
    const row = await cache.getDoc('u1', doc.id)
    expect(row).toMatchObject({ title: 'ENV-T', content: 'ENV-C', version: 2, e2eeKey: 'K'.repeat(56) })
    expect(row && 'purged' in row).toBe(false)
    expect(routes.log.filter((r) => r.method === 'PUT' && r.path === `/api/docs/${doc.id}`)).toHaveLength(0)
  })
})

describe('F-407 S4 옮기는 중 건너뛰기', () => {
  it('PUT /e2ee 가 붙잡힌 동안 그 문서의 PUT 은 나가지 않고, 다른 문서는 나간다', async () => {
    const { routes, store } = await convertSetup()
    const a = await store.create({ title: 'a', content: 'a', lineEnding: 'lf' })
    const b = await store.create({ title: 'b', content: 'b', lineEnding: 'lf' })
    await tick()
    const release = routes.hold()
    const moving = store.setDocE2ee!(a.id, { e2ee: true, title: 'E', content: 'E', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })
    await tick()
    await store.update(a.id, { content: 'a2' })
    await store.update(b.id, { content: 'b2' })
    await tick(30)
    expect(routes.log.filter((r) => r.method === 'PUT' && r.path === `/api/docs/${a.id}`)).toHaveLength(0)
    expect(routes.log.filter((r) => r.method === 'PUT' && r.path === `/api/docs/${b.id}`)).toHaveLength(1)
    release()
    await moving
  })
})

describe('F-407 S5 서버에 아직 없는 문서', () => {
  it('createDoc 이 남아 있으면 PendingSyncError, PUT 0번', async () => {
    const { server, routes, store } = await convertSetup()
    server.setNetworkDown(true)
    const doc = await store.create({ title: 't', content: 'c', lineEnding: 'lf' })
    await tick()
    await expect(store.setDocE2ee!(doc.id, { e2ee: true, title: 'E', content: 'E', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })).rejects.toBeInstanceOf(PendingSyncError)
    expect(routes.log.filter((r) => r.path.endsWith('/e2ee'))).toHaveLength(0)
  })
})

describe('F-407 S6 putAttachmentNow', () => {
  it('outbox upload 없이 곧바로 PUT 한 번(금고면 쿼리), 캐시 행 uploaded', async () => {
    const { routes, store, cache } = await convertSetup()
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    const plain = await store.putAttachmentNow!({ blob, mime: 'image/png', ext: 'png', width: 4, height: 3 })
    const vault = await store.putAttachmentNow!({ blob, mime: 'image/png', ext: 'png', width: 4, height: 3, id: '00000000000000ee', e2ee: true })
    expect(plain.ext).toBe('png')
    expect(vault).toEqual({ id: '00000000000000ee', ext: 'png' })
    const puts = routes.log.filter((r) => r.method === 'PUT' && r.path.startsWith('/api/attachments/'))
    expect(puts.map((r) => `${r.path}${r.search}`)).toEqual([`/api/attachments/${plain.id}.png`, '/api/attachments/00000000000000ee.png?e2ee=1&w=4&h=3'])
    expect((await cache.getOutbox('u1')).filter((e) => e.type === 'upload')).toHaveLength(0)
    expect((await cache.getAttachment('u1', plain.id))?.uploaded).toBe(true)
    expect((await cache.getAttachment('u1', '00000000000000ee'))?.e2ee).toBe(true)

    await store.putAttachmentNow!({ blob, mime: 'image/png', ext: 'png', width: 4, height: 3, id: '00000000000000ee', e2ee: true })
    expect(routes.log.filter((r) => r.method === 'PUT' && r.path.startsWith('/api/attachments/'))).toHaveLength(2)
  })

  it('429 는 AttachmentApiError rate_limited 로 던지고 캐시 행이 없다', async () => {
    const { routes, store, cache } = await convertSetup()
    routes.setPutRateLimited(true)
    await expect(
      store.putAttachmentNow!({ blob: new Blob([new Uint8Array([1])]), mime: 'image/png', ext: 'png', width: 1, height: 1, id: '00000000000000dd' }),
    ).rejects.toMatchObject({ kind: 'rate_limited' })
    expect(await cache.getAttachment('u1', '00000000000000dd')).toBeNull()
  })
})

describe('F-407 S7 discardAttachment', () => {
  it('204·404 는 캐시 행이 사라지고 in_use 는 남는다. 남은 upload 는 DELETE 전에 지운다', async () => {
    const { server, routes, store, cache } = await convertSetup()
    const blob = new Blob([new Uint8Array([1, 2])])
    server.setNetworkDown(true)
    const pending = await store.putAttachment({ blob, mime: 'image/gif', ext: 'gif', width: 1, height: 1 })
    await tick()
    server.setNetworkDown(false)
    expect((await cache.getOutbox('u1')).filter((e) => e.type === 'upload')).toHaveLength(1)
    const logBefore = routes.log.length
    expect(await store.discardAttachment!(pending.id, 'gif')).toBe('deleted')
    expect((await cache.getOutbox('u1')).filter((e) => e.type === 'upload')).toHaveLength(0)
    expect(routes.log.slice(logBefore).map((r) => r.method)).toEqual(['DELETE'])
    expect(await cache.getAttachment('u1', pending.id)).toBeNull()

    const gone = await store.putAttachmentNow!({ blob, mime: 'image/gif', ext: 'gif', width: 1, height: 1 })
    routes.setDeleteStatus(gone.id, 404)
    expect(await store.discardAttachment!(gone.id, 'gif')).toBe('not_found')
    expect(await cache.getAttachment('u1', gone.id)).toBeNull()

    const used = await store.putAttachmentNow!({ blob, mime: 'image/gif', ext: 'gif', width: 1, height: 1 })
    routes.setDeleteStatus(used.id, 409)
    expect(await store.discardAttachment!(used.id, 'gif')).toBe('in_use')
    expect(await cache.getAttachment('u1', used.id)).not.toBeNull()
  })
})

describe('F-407 S8 setFolderE2ee', () => {
  it('PUT /api/folders/{id} 몸통 {"e2ee":true}, 캐시 폴더 행 e2ee', async () => {
    const { routes, store, cache } = await convertSetup()
    const folder = await store.createFolder({ name: 'F' })
    await tick()
    const res = await store.setFolderE2ee!(folder.id, true)
    expect(res.e2ee).toBe(true)
    const put = routes.log.find((r) => r.method === 'PUT' && r.path === `/api/folders/${folder.id}`)
    expect(put?.body).toEqual({ e2ee: true })
    expect((await cache.getFolder('u1', folder.id))?.e2ee).toBe(true)
    const off = await store.setFolderE2ee!(folder.id, false)
    expect('e2ee' in off).toBe(false)
    expect((await cache.getFolder('u1', folder.id))?.e2ee).toBeUndefined()
  })
})

// ----- F-408 S1~S4 importLocalE2ee (specs/features/F-408.md 3.4, 7.1) -----

describe('F-408 S1 importLocalE2ee — 캐시 행과 보낼 목록', () => {
  it('폴더·첨부·문서를 캐시에 쓰고, 보낼 목록이 createFolder → upload → createDoc 순', async () => {
    const { server, store, cache } = await convertSetup()
    server.setNetworkDown(true) // 실제로 보내지 않고 캐시·보낼 목록만 본다 — 백그라운드 보내기가 이 뒤 검사를 흔들지 않게
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    const result = await store.importLocalE2ee({
      folders: [{ id: 'vf', name: 'VF', parentId: null, createdAt: 1, updatedAt: 2, e2ee: true }],
      attachments: [
        { id: '00000000000000aa', mime: 'application/octet-stream', ext: 'png', size: 3, width: 1, height: 1, createdAt: 1, e2ee: true, blob },
      ],
      docs: [
        {
          id: 'vd',
          title: 'T',
          content: 'C',
          lineEnding: 'lf',
          createdAt: 1,
          updatedAt: 2,
          folderId: null,
          pinnedAt: null,
          e2eeKey: VAULT_KEY,
          attachmentRefs: ['00000000000000aa'],
        },
      ],
    })
    expect(result).toEqual({ folders: 1, docs: 1, attachments: 1 })

    expect(await cache.getFolder('u1', 'vf')).toMatchObject({ id: 'vf', name: 'VF', parentId: null, e2ee: true })
    expect(await cache.getAttachment('u1', '00000000000000aa')).toMatchObject({ id: '00000000000000aa', e2ee: true, uploaded: false })
    expect(await cache.getDoc('u1', 'vd')).toMatchObject({
      id: 'vd',
      title: 'T',
      content: 'C',
      version: 0,
      e2eeKey: VAULT_KEY,
      attachmentRefs: ['00000000000000aa'],
    })

    const outbox = await cache.getOutbox('u1')
    expect(outbox.map((e) => e.type)).toEqual(['createFolder', 'upload', 'createDoc'])
  })
})

describe('F-408 S2 보내기', () => {
  it('가짜 서버에 폴더 e2ee, 첨부 e2ee=1&w&h, 문서 e2eeKey·attachmentRefs·원래 시각', async () => {
    const { store, routes } = await convertSetup()
    const blob = new Blob([new Uint8Array([9, 9])])
    await store.importLocalE2ee({
      folders: [{ id: 'vf2', name: 'VF2', parentId: null, createdAt: 1, updatedAt: 2, e2ee: true }],
      attachments: [
        { id: '00000000000000bb', mime: 'application/octet-stream', ext: 'png', size: 2, width: 10, height: 20, createdAt: 1, e2ee: true, blob },
      ],
      docs: [
        {
          id: 'vd2',
          title: 'T2',
          content: 'C2',
          lineEnding: 'lf',
          createdAt: 100,
          updatedAt: 200,
          pinnedAt: 300,
          folderId: null,
          e2eeKey: VAULT_KEY,
          attachmentRefs: ['00000000000000bb'],
        },
      ],
    })
    await tick(30)

    const folderReq = routes.log.find((r) => r.method === 'POST' && r.path === '/api/folders')
    expect((folderReq?.body as { e2ee?: boolean } | undefined)?.e2ee).toBe(true)

    const attReq = routes.log.find((r) => r.method === 'PUT' && r.path === '/api/attachments/00000000000000bb.png')
    expect(attReq?.search).toBe('?e2ee=1&w=10&h=20')

    const docReq = routes.log.find((r) => r.method === 'POST' && r.path === '/api/docs')
    expect(docReq?.body).toMatchObject({
      id: 'vd2',
      title: 'T2',
      content: 'C2',
      e2eeKey: VAULT_KEY,
      attachmentRefs: ['00000000000000bb'],
      createdAt: 100,
      updatedAt: 200,
      pinnedAt: 300,
    })
  })
})

describe('F-408 S3 캐시에 같은 id 가 있으면 건너뛴다', () => {
  it('그 항목은 쓰지 않고 반환 개수에 들지 않는다, 보낼 목록이 늘지 않는다', async () => {
    const { server, store, cache } = await convertSetup()
    server.setNetworkDown(true) // 백그라운드 보내기가 outbox 를 먼저 비우지 않게
    await store.importLocalE2ee({ docs: [{ id: 'vd3', title: 'T', content: 'C', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, e2eeKey: VAULT_KEY, attachmentRefs: [] }] })
    const beforeOutboxLen = (await cache.getOutbox('u1')).length

    const result = await store.importLocalE2ee({
      docs: [{ id: 'vd3', title: '다른제목', content: '다른내용', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, e2eeKey: VAULT_KEY, attachmentRefs: [] }],
    })
    expect(result).toEqual({ folders: 0, docs: 0, attachments: 0 })
    expect((await cache.getDoc('u1', 'vd3'))?.title).toBe('T')
    expect((await cache.getOutbox('u1')).length).toBe(beforeOutboxLen)
  })
})

describe('F-408 S4 표지 없는 값', () => {
  it('e2eeKey 없는 문서·e2ee 없는 첨부·e2ee 없는 폴더가 섞이면 아무것도 쓰지 않고 던진다', async () => {
    const { store, cache } = await convertSetup()

    const plainDoc = { id: 'plain1', title: 'T', content: 'C', lineEnding: 'lf' as const, createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null }
    await expect(store.importLocalE2ee({ docs: [plainDoc] })).rejects.toThrow('not_e2ee')
    expect(await cache.getDoc('u1', 'plain1')).toBeNull()

    const blob = new Blob([new Uint8Array([1])])
    const plainAttachment = { id: '00000000000000cc', mime: 'image/png', ext: 'png' as const, size: 1, width: 1, height: 1, createdAt: 1, blob }
    await expect(store.importLocalE2ee({ attachments: [plainAttachment] })).rejects.toThrow('not_e2ee')
    expect(await cache.getAttachment('u1', '00000000000000cc')).toBeNull()

    const plainFolder = { id: 'plainf1', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 }
    await expect(store.importLocalE2ee({ folders: [plainFolder] })).rejects.toThrow('not_e2ee')
    expect(await cache.getFolder('u1', 'plainf1')).toBeNull()

    // 섞인 다른 항목도 쓰지 않는다 — 유효한 문서 옆에 표지 없는 폴더가 있으면 문서도 쓰지 않는다
    const validDoc = { id: 'vd4', title: 'T', content: 'C', lineEnding: 'lf' as const, createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, e2eeKey: VAULT_KEY, attachmentRefs: [] }
    await expect(store.importLocalE2ee({ folders: [plainFolder], docs: [validDoc] })).rejects.toThrow('not_e2ee')
    expect(await cache.getDoc('u1', 'vd4')).toBeNull()
  })
})

// F-2042 7.1 U1~U6 — 부팅 목록 읽기 병렬화·캐시 먼저 셸의 저장소 계약
describe('F-2042 U1~U6 부팅 목록 읽기 — 병렬화·캐시 먼저 셸', () => {
  it('U1 /api/shared 는 /api/docs 와 동시에 시작한다', async () => {
    const server = makeFakeServer()
    server.setShared([
      { id: 'sh1', title: '공유문서', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 1, updatedAt: 1, role: 'view' },
    ])
    let releaseDocs = () => {}
    const gate = new Promise<void>((resolve) => {
      releaseDocs = resolve
    })
    const seen: string[] = []
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (method === 'GET' && path === '/api/shared') seen.push('shared')
      if (method === 'GET' && path === '/api/docs') {
        seen.push('docs-start')
        await gate
      }
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)
    const store = await createServerStore('u1', { dbName: freshDbName() })

    const listPromise = store.list()
    await tick(10)
    // /api/docs 가 아직 붙잡혀 있는데도 /api/shared 는 이미 나가 있다
    expect(seen).toContain('shared')
    expect(seen).toContain('docs-start')

    releaseDocs()
    const result = await listPromise
    expect(result.some((d) => d.id === 'sh1')).toBe(true)
  })

  it('U2 본문은 최대 6개씩 동시에 받고, 끝나면 20개 모두 캐시에 새 본문', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const ids: string[] = []
    for (let i = 0; i < 20; i++) {
      const doc = await store.create({ title: `T${i}`, content: `c${i}`, lineEnding: 'lf' })
      ids.push(doc.id)
    }
    await tick(30)
    ids.forEach((id, i) => {
      const d = server.docs.get(id)!
      d.content = `new${i}`
      d.version += 1
      d.updatedAt = Date.now()
    })

    let inFlight = 0
    let maxInFlight = 0
    const pending: Array<() => void> = []
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (method === 'GET' && /^\/api\/docs\/[^/]+$/.test(path)) {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise<void>((resolve) => pending.push(resolve))
        inFlight--
      }
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const listPromise = store.list()
    await tick(10)
    expect(inFlight).toBe(BODY_FETCH_CONCURRENCY)
    expect(maxInFlight).toBe(BODY_FETCH_CONCURRENCY)

    for (let guard = 0; guard < 100 && (pending.length > 0 || inFlight > 0); guard++) {
      const release = pending.shift()
      release?.()
      await tick(5)
    }
    await listPromise

    expect(maxInFlight).toBe(BODY_FETCH_CONCURRENCY)
    for (let i = 0; i < 20; i++) {
      const got = await store.get(ids[i])
      expect(got?.content).toBe(`new${i}`)
    }
  })

  it('U3 list() 를 동시에 두 번 불러도 바뀐 문서의 본문은 한 번만 받는다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick(20)
    server.docs.get(doc.id)!.content = 'b'
    server.docs.get(doc.id)!.version += 1

    let bodyGetCount = 0
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (method === 'GET' && path === `/api/docs/${doc.id}`) bodyGetCount++
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)

    await Promise.all([store.list(), store.list()])
    expect(bodyGetCount).toBe(1)
    expect((await store.get(doc.id))?.content).toBe('b')
  })

  it('U4 본문을 받는 사이 편집하면 받은 서버 본문이 캐시를 덮지 않는다(3.4)', async () => {
    const dbName = freshDbName()
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName })
    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick(20)
    server.docs.get(doc.id)!.content = 'server-new'
    server.docs.get(doc.id)!.version += 1

    let releaseBody = () => {}
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve
    })
    const putGate = new Promise<void>(() => {}) // 이 테스트 동안은 절대 풀리지 않는다 — updateDoc 이 안 나간 상태를 흉내낸다
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (path === `/api/docs/${doc.id}` && method === 'GET') await bodyGate
      if (path === `/api/docs/${doc.id}` && method === 'PUT') await putGate
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const listPromise = store.list()
    await tick(10)
    await store.update(doc.id, { content: '내 편집' })
    await tick(10)

    releaseBody()
    await listPromise
    await tick(10)

    const got = await store.get(doc.id)
    expect(got?.content).toBe('내 편집')

    const cache = await createRemoteCache(dbName)
    const outbox = await cache.getOutbox('u1')
    expect(outbox.some((e) => e.type === 'updateDoc' && e.docId === doc.id)).toBe(true)
  })

  it('U5 진행 중인 list() 가 있으면 get(X) 는 서버의 새 본문을 기다렸다가 돌려준다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const doc = await store.create({ title: 'T', content: 'a', lineEnding: 'lf' })
    await tick(20)
    server.docs.get(doc.id)!.content = 'server-new'
    server.docs.get(doc.id)!.version += 1

    let releaseBody = () => {}
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve
    })
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (path === `/api/docs/${doc.id}` && method === 'GET') await bodyGate
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const listPromise = store.list()
    await tick(10)
    const getPromise = store.get(doc.id)
    await tick(10)
    releaseBody()

    const got = await getPromise
    expect(got?.content).toBe('server-new')
    await listPromise
  })

  // 실제 3초를 기다린다 — fake-indexeddb 가 내부 스케줄링에 쓰는 setImmediate 가 vi.useFakeTimers() 와 함께 쓰면 멈춰 죽는다(구현이 정하는 시계, 7.1 U5)
  it('U5 GET_WAIT_FOR_LIST_MS 를 넘기면 get() 은 기다리지 않고 캐시 본문을 돌려준다', async () => {
    const server = makeFakeServer()
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    const doc = await store.create({ title: 'T', content: 'cached', lineEnding: 'lf' })
    await tick(20)

    const listGate = new Promise<void>(() => {}) // 이 테스트 동안 절대 풀리지 않는다
    const fetchSpy = vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const path = new URL(String(url), 'http://local.test').pathname
      if (method === 'GET' && path === '/api/docs') await listGate
      return server.fetchImpl(url, init)
    })
    vi.stubGlobal('fetch', fetchSpy)

    void store.list().catch(() => {})
    const got = await store.get(doc.id)
    expect(got?.content).toBe('cached')
  }, 8000)

  it('U6 listCached 는 네트워크 없이 캐시 문서·폴더만 읽는다 — 공유받은 문서는 없다', async () => {
    const server = makeFakeServer()
    server.setShared([
      { id: 'sh1', title: '공유', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 1, updatedAt: 1, role: 'view' },
    ])
    vi.stubGlobal('fetch', vi.fn(server.fetchImpl))
    const store = await createServerStore('u1', { dbName: freshDbName() })
    await store.create({ title: 'A', content: 'a', lineEnding: 'lf', createdAt: 1, updatedAt: 1 })
    await store.create({ title: 'B', content: 'b', lineEnding: 'lf', createdAt: 2, updatedAt: 2 })
    await tick(20)
    await store.list()
    await tick(10)

    const fetchSpy = vi.fn(server.fetchImpl)
    vi.stubGlobal('fetch', fetchSpy)
    const result = await store.listCached()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.docs.map((d) => d.title)).toEqual(['B', 'A'])
    expect(result.docs.every((d) => d.role === 'owner')).toBe(true)
    expect(result.docs.some((d) => d.id === 'sh1')).toBe(false)
    expect(result.folders).toEqual([])
  })
})
