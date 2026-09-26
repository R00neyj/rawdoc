// F-2030 3.1 — 429·413 doc_quota_exceeded·403 account_blocked 분류 규칙 (U1~U5)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { ApiError, createDoc, updateDoc, removeDoc, createFolder, setDocE2ee, updateFolder, importDocComments, fetchCommentCount } from './docsApi'

function jsonResponse(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('U1: 429 + scope day + retryAfter + limit', () => {
  const body = { error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 3600 }

  it.each([
    ['createDoc', () => createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })],
    ['updateDoc', () => updateDoc('a', { content: 'x', baseVersion: 0 })],
    ['removeDoc', () => removeDoc('a')],
    ['createFolder', () => createFolder({ id: 'f', name: 'F', parentId: null })],
  ])('%s', async (_name, call) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, body, { 'Retry-After': '3600' })))
    await expect(call()).rejects.toMatchObject({
      kind: 'rate_limited',
      scope: 'day',
      retryAfter: 3600,
      limit: 5000,
    })
  })
})

describe('U2: 429, 몸통 없음·헤더 없음', () => {
  it('scope minute, retryAfter 60, limit 없음', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 429 })))
    try {
      await createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })
      expect.unreachable()
    } catch (err) {
      const e = err as ApiError
      expect(e.kind).toBe('rate_limited')
      expect(e.scope).toBe('minute')
      expect(e.retryAfter).toBe(60)
      expect(e.limit).toBeUndefined()
    }
  })
})

describe('U3: 413 doc_quota_exceeded', () => {
  it('resource docs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(413, { error: 'doc_quota_exceeded', resource: 'docs', used: 10000, limit: 10000 })),
    )
    await expect(createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })).rejects.toMatchObject({
      kind: 'doc_quota_exceeded',
      resource: 'docs',
      used: 10000,
      limit: 10000,
    })
  })

  it('resource bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(413, { error: 'doc_quota_exceeded', resource: 'bytes', used: 104857600, limit: 104857600 })),
    )
    await expect(updateDoc('a', { content: 'x', baseVersion: 0 })).rejects.toMatchObject({
      kind: 'doc_quota_exceeded',
      resource: 'bytes',
      used: 104857600,
      limit: 104857600,
    })
  })
})

describe('U4: 413 그 밖은 too_large (지금 그대로)', () => {
  it('too_large 몸통', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(413, { error: 'too_large', limit: 1000000 })))
    await expect(createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })).rejects.toMatchObject({
      kind: 'too_large',
    })
  })

  it('몸통 없음', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 413 })))
    await expect(createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })).rejects.toMatchObject({
      kind: 'too_large',
    })
  })
})

describe('U5: 403 account_blocked vs forbidden', () => {
  it('account_blocked 몸통이면 account_blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'account_blocked' })))
    await expect(createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })).rejects.toMatchObject({
      kind: 'account_blocked',
    })
  })

  it('setPinned 도 account_blocked', async () => {
    const { setPinned } = await import('./docsApi')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'account_blocked' })))
    await expect(setPinned('a', true)).rejects.toMatchObject({ kind: 'account_blocked' })
  })

  it('updateDoc 이 forbidden 몸통을 받으면 지금처럼 forbidden', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' })))
    await expect(updateDoc('a', { content: 'x', baseVersion: 0 })).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

describe('기존 회귀 — 401·5xx·network 는 그대로', () => {
  it('401 unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))
    await expect(createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })).rejects.toMatchObject({
      kind: 'unauthorized',
    })
  })

  it('500 server_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })).rejects.toMatchObject({
      kind: 'server_error',
    })
  })
})

// F-405 S9 — 409 몸통의 error 로 금고 갈래를 가른다. 몸통이 JSON 이 아니면 지금 분류 (specs/features/F-405.md 5.1)
describe('F-405 S9 409 분류', () => {
  async function kindOf(call: () => Promise<unknown>, response: Response): Promise<string | undefined> {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    try {
      await call()
    } catch (err) {
      return (err as ApiError).kind
    }
    return undefined
  }
  const text409 = () => new Response('not json', { status: 409 })
  const create = () => createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null })
  const update = () => updateDoc('a', { content: 'x', baseVersion: 0 })
  const folder = () => createFolder({ id: 'f', name: 'F', parentId: null })

  it('createDoc', async () => {
    expect(await kindOf(create, jsonResponse(409, { error: 'e2ee_folder' }))).toBe('e2ee_folder')
    expect(await kindOf(create, jsonResponse(409, { error: 'no_vault' }))).toBe('no_vault')
    expect(await kindOf(create, jsonResponse(409, { error: 'id_taken' }))).toBe('id_taken')
    expect(await kindOf(create, text409())).toBe('id_taken')
  })

  it('updateDoc', async () => {
    expect(await kindOf(update, jsonResponse(409, { error: 'e2ee_doc' }))).toBe('e2ee_doc')
    expect(await kindOf(update, jsonResponse(409, { error: 'not_e2ee' }))).toBe('not_e2ee')
    const doc = { id: 'a', title: 'T', content: 'c', version: 3 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: 'conflict', doc })))
    await expect(update()).rejects.toMatchObject({ kind: 'conflict', doc })
    expect(await kindOf(update, text409())).toBe('conflict')
  })

  it('moveDocFolder', async () => {
    const { moveDocFolder } = await import('./docsApi')
    expect(await kindOf(() => moveDocFolder('a', 'f'), jsonResponse(409, { error: 'e2ee_folder' }))).toBe('e2ee_folder')
    expect(await kindOf(() => moveDocFolder('a', 'f'), text409())).toBe('other')
  })

  it('createFolder', async () => {
    expect(await kindOf(folder, jsonResponse(409, { error: 'e2ee_folder' }))).toBe('e2ee_folder')
    expect(await kindOf(folder, jsonResponse(409, { error: 'id_taken' }))).toBe('id_taken')
    expect(await kindOf(folder, text409())).toBe('id_taken')
  })

  it('updateFolder', async () => {
    const { updateFolder } = await import('./docsApi')
    expect(await kindOf(() => updateFolder('f', { parentId: 'g' }), jsonResponse(409, { error: 'e2ee_folder' }))).toBe('e2ee_folder')
    expect(await kindOf(() => updateFolder('f', { parentId: 'g' }), text409())).toBe('other')
  })

  it('몸통 필드 — 있을 때만 싣는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}))
    vi.stubGlobal('fetch', fetchMock)
    await createDoc({ id: 'a', title: 'T', content: '', lineEnding: 'lf', folderId: null, e2eeKey: 'K', attachmentRefs: [] })
    await updateDoc('a', { content: 'x', baseVersion: 1, e2ee: true, attachmentRefs: ['00000000000000aa'] })
    await createFolder({ id: 'f', name: 'F', parentId: null, e2ee: true })
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
    expect(bodies[0]).toMatchObject({ e2eeKey: 'K', attachmentRefs: [] })
    expect(bodies[1]).toMatchObject({ e2ee: true, attachmentRefs: ['00000000000000aa'] })
    expect(bodies[2]).toMatchObject({ e2ee: true })
  })
})

// ----- F-407 S1·S2 (specs/features/F-407.md 3.2, 9.1) -----

describe('F-407 S1 setDocE2ee 분류', () => {
  it('요청 PUT /api/docs/{id}/e2ee, 몸통 다섯 필드, X-Lock-Session 없음, purged 없으면 true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'a', title: 't', content: 'c', version: 3 }))
    vi.stubGlobal('fetch', fetchMock)
    const body = { e2eeKey: 'K'.repeat(56), title: 't', content: 'c', attachmentRefs: ['00000000000000aa'], baseVersion: 2 }
    const res = await setDocE2ee('a b', body)
    expect(res.purged).toBe(true)
    expect(res.version).toBe(3)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/docs/a%20b/e2ee')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual(body)
    expect(new Headers(init.headers).has('X-Lock-Session')).toBe(false)
  })

  it('200 purged false 는 그대로', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { id: 'a', version: 3, purged: false })))
    expect((await setDocE2ee('a', { e2eeKey: null, title: '', content: '', attachmentRefs: null, baseVersion: 1 })).purged).toBe(false)
  })

  const call = () => setDocE2ee('a', { e2eeKey: null, title: '', content: '', attachmentRefs: null, baseVersion: 1 })

  it.each([
    [409, { error: 'e2ee_doc' }, 'e2ee_doc'],
    [409, { error: 'not_e2ee' }, 'not_e2ee'],
    [409, { error: 'e2ee_folder' }, 'e2ee_folder'],
    [409, { error: 'no_vault' }, 'no_vault'],
    [400, { error: 'invalid', field: 'title' }, 'invalid'],
    [413, { error: 'too_large' }, 'too_large'],
    [404, { error: 'not_found' }, 'not_found'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [403, { error: 'account_blocked' }, 'account_blocked'],
    [401, { error: 'unauthenticated' }, 'unauthorized'],
    [500, { error: 'internal' }, 'server_error'],
  ])('%s %j → %s', async (status, data, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, data)))
    await expect(call()).rejects.toMatchObject({ kind })
  })

  it('409 conflict 는 몸통 doc 을 싣는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { error: 'conflict', doc: { id: 'a', version: 9 } })))
    await expect(call()).rejects.toMatchObject({ kind: 'conflict', doc: { id: 'a', version: 9 } })
  })

  it('413 doc_quota_exceeded, 429 rate_limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(413, { error: 'doc_quota_exceeded', resource: 'bytes', used: 1, limit: 2 })))
    await expect(call()).rejects.toMatchObject({ kind: 'doc_quota_exceeded', resource: 'bytes', limit: 2 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate_limited', scope: 'minute', retryAfter: 60 }, { 'Retry-After': '60' })))
    await expect(call()).rejects.toMatchObject({ kind: 'rate_limited', scope: 'minute', retryAfter: 60 })
  })
})

describe('F-407 S2 updateFolder e2ee', () => {
  it('몸통에 e2ee:true', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'f', name: 'F', parentId: null, e2ee: true }))
    vi.stubGlobal('fetch', fetchMock)
    await updateFolder('f', { e2ee: true })
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ e2ee: true })
  })

  it.each([
    [{ error: 'e2ee_folder_not_ready', docs: 1, folders: 0 }, 'e2ee_folder_not_ready'],
    [{ error: 'e2ee_folder' }, 'e2ee_folder'],
    [{ error: 'something' }, 'other'],
  ])('409 %j → %s', async (data, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, data)))
    await expect(updateFolder('f', { e2ee: true })).rejects.toMatchObject({ kind })
  })
})

// U11 (F-508.md 3.4·11.1) — importDocComments 응답 분류
describe('U11: importDocComments', () => {
  const records = [
    {
      id: 'c1',
      parent: null,
      body: '메모',
      mentions: [],
      authorId: null,
      authorEmail: null,
      createdAt: 1,
      resolvedAt: null,
      resolvedById: null,
      resolvedBy: null,
      quote: '고양이',
      prefix: '',
      suffix: '',
      anchorFrom: 0,
      anchorLength: 3,
    },
  ]

  it('요청은 POST /api/docs/{id}/comments/import, 몸통은 { records } 키 하나', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { imported: 1, orphaned: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await importDocComments('doc a', { records })
    expect(result).toEqual({ imported: 1, orphaned: 0 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/docs/doc%20a/comments/import')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ records })
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(['records'])
  })

  it.each([
    [409, { error: 'comments_exist' }, 'comments_exist'],
    [409, { error: 'e2ee_doc' }, 'e2ee_doc'],
    [409, {}, 'other'],
    [404, { error: 'not_found' }, 'not_found'],
    [403, { error: 'forbidden' }, 'forbidden'],
    [403, { error: 'account_blocked' }, 'account_blocked'],
    [413, { error: 'too_many' }, 'too_large'],
    [400, { error: 'invalid' }, 'invalid'],
    [429, { error: 'rate_limited', scope: 'minute', retryAfter: 60 }, 'rate_limited'],
    [503, { error: 'internal' }, 'server_error'],
  ])('%s %j → %s', async (status, data, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, data)))
    await expect(importDocComments('a', { records })).rejects.toMatchObject({ kind })
  })

  it('네트워크 실패 → network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')))
    await expect(importDocComments('a', { records })).rejects.toMatchObject({ kind: 'network' })
  })

  it('200 이면 CommentImportResponse 를 그대로 돌려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { imported: 2, orphaned: 1 })))
    await expect(importDocComments('a', { records })).resolves.toEqual({ imported: 2, orphaned: 1 })
  })
})

describe('F-509 U9: fetchCommentCount', () => {
  it('200 정상 — 몸통 그대로, 경로 인코딩, 몸통 없음, signal 그대로 전달', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { total: 5, open: 1 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const result = await fetchCommentCount('a/b', { signal: controller.signal })
    expect(result).toEqual({ total: 5, open: 1 })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/docs/a%2Fb/comments/count')
    expect(init.body).toBeUndefined()
    expect(init.signal).toBe(controller.signal)
  })

  it.each([
    [200, { total: -1, open: 0 }, 'invalid'],
    [200, { total: 1.5, open: 0 }, 'invalid'],
    [200, {}, 'invalid'],
    [401, { error: 'unauthenticated' }, 'unauthorized'],
    [500, { error: 'internal' }, 'server_error'],
    [404, { error: 'not_found' }, 'not_found'],
    [409, { error: 'e2ee_doc' }, 'e2ee_doc'],
    [409, {}, 'other'],
    [400, { error: 'invalid' }, 'other'],
  ])('%s %j → %s', async (status, data, kind) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, data)))
    await expect(fetchCommentCount('a')).rejects.toMatchObject({ kind })
  })

  it('네트워크 실패 → network', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')))
    await expect(fetchCommentCount('a')).rejects.toMatchObject({ kind: 'network' })
  })
})
