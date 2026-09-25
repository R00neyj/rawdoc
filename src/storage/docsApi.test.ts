// F-2030 3.1 — 429·413 doc_quota_exceeded·403 account_blocked 분류 규칙 (U1~U5)
import { describe, it, expect, afterEach, vi } from 'vitest'
import { ApiError, createDoc, updateDoc, removeDoc, createFolder } from './docsApi'

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
