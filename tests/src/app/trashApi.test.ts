import { describe, it, expect, beforeEach, vi } from 'vitest'
import { announceMissingDoc, emptyTrash, listTrash, probeGoneDoc, purgeTrashDoc, restoreTrashDoc, TrashApiError } from '../../../src/app/trashApi'

type FakeRes = { status: number; ok: boolean; json: () => Promise<unknown> }
const res = (status: number, body?: unknown): FakeRes => ({ status, ok: status >= 200 && status < 300, json: async () => body })

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('F-2145 U6 trashApi', () => {
  it('listTrash 는 GET /api/trash 의 본문을 그대로 돌려준다', async () => {
    const items = [{ id: 'a', title: 'A', deletedAt: 1, deletedBy: 'app', path: null, purgeAt: 2 }]
    const f = vi.fn().mockResolvedValue(res(200, items))
    vi.stubGlobal('fetch', f)
    expect(await listTrash()).toEqual(items)
    expect(f).toHaveBeenCalledWith('/api/trash', { credentials: 'same-origin' })
  })

  it('listTrash 는 네트워크·401·5xx·그 밖을 종류로 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    await expect(listTrash()).rejects.toBeInstanceOf(TrashApiError)
    await expect(listTrash()).rejects.toMatchObject({ kind: 'network' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(401)))
    await expect(listTrash()).rejects.toMatchObject({ kind: 'unauthorized' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500)))
    await expect(listTrash()).rejects.toMatchObject({ kind: 'server_error' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(403)))
    await expect(listTrash()).rejects.toMatchObject({ kind: 'other' })
  })

  it('restoreTrashDoc 는 POST /api/trash/:id/restore, 200 은 folderId, 404 는 gone, 그 밖은 failed', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { id: 'a b', folderId: 'f1' }))
    vi.stubGlobal('fetch', f)
    expect(await restoreTrashDoc('a b')).toEqual({ status: 'ok', folderId: 'f1' })
    expect(f).toHaveBeenCalledWith('/api/trash/a%20b/restore', { credentials: 'same-origin', method: 'POST' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)))
    expect(await restoreTrashDoc('a')).toEqual({ status: 'gone' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500)))
    expect(await restoreTrashDoc('a')).toEqual({ status: 'failed' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await restoreTrashDoc('a')).toEqual({ status: 'failed' })
  })

  it('purgeTrashDoc 는 DELETE /api/trash/:id, 204 ok · 404 gone · 그 밖 failed', async () => {
    const f = vi.fn().mockResolvedValue(res(204))
    vi.stubGlobal('fetch', f)
    expect(await purgeTrashDoc('a')).toBe('ok')
    expect(f).toHaveBeenCalledWith('/api/trash/a', { credentials: 'same-origin', method: 'DELETE' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(404)))
    expect(await purgeTrashDoc('a')).toBe('gone')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(429)))
    expect(await purgeTrashDoc('a')).toBe('failed')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await purgeTrashDoc('a')).toBe('failed')
  })

  it('emptyTrash 는 DELETE /api/trash, 200 의 docs · 그 밖 failed', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { docs: 3 }))
    vi.stubGlobal('fetch', f)
    expect(await emptyTrash()).toEqual({ status: 'ok', docs: 3 })
    expect(f).toHaveBeenCalledWith('/api/trash', { credentials: 'same-origin', method: 'DELETE' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(500)))
    expect(await emptyTrash()).toEqual({ status: 'failed' })
  })
})

describe('F-2145 U7·U8 probeGoneDoc', () => {
  function route(handlers: Record<string, FakeRes>) {
    const f = vi.fn(async (url: string) => handlers[url] ?? res(500))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('404 deleted + 휴지통에 id 가 있으면 trashed', async () => {
    route({ '/api/docs/a': res(404, { error: 'deleted' }), '/api/trash': res(200, [{ id: 'a' }, { id: 'b' }]) })
    expect(await probeGoneDoc('a')).toBe('trashed')
  })

  it('404 deleted + 휴지통에 없으면 deleted', async () => {
    route({ '/api/docs/a': res(404, { error: 'deleted' }), '/api/trash': res(200, [{ id: 'b' }]) })
    expect(await probeGoneDoc('a')).toBe('deleted')
  })

  it('본문이 없는 404·다른 상태·네트워크 실패·휴지통 목록 실패는 not_found', async () => {
    route({ '/api/docs/a': res(404, { error: 'not_found' }) })
    expect(await probeGoneDoc('a')).toBe('not_found')
    route({ '/api/docs/a': res(200, {}) })
    expect(await probeGoneDoc('a')).toBe('not_found')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    expect(await probeGoneDoc('a')).toBe('not_found')
    route({ '/api/docs/a': res(404, { error: 'deleted' }), '/api/trash': res(500) })
    expect(await probeGoneDoc('a')).toBe('not_found')
  })
})

describe('F-2145 U8 announceMissingDoc', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('서버 저장소·온라인·휴지통 문서면 휴지통 열기 버튼이 달린 알림', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url === '/api/trash' ? res(200, [{ id: 'a' }]) : res(404, { error: 'deleted' }))))
    const shown: { message: string; action?: { label: string } }[] = []
    announceMissingDoc('a', true, (n) => shown.push(n as never))
    await flush()
    expect(shown).toHaveLength(1)
    expect(shown[0].message).toBe('휴지통에 있는 문서입니다. 복원하면 열 수 있습니다.')
    expect(shown[0].action?.label).toBe('휴지통 열기')
  })

  it('서버 저장소가 아니거나 오프라인이면 응답을 기다리지 않고 지금 문구', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const shown: { message: string }[] = []
    vi.stubGlobal('navigator', { onLine: true })
    announceMissingDoc('a', false, (n) => shown.push(n as never))
    vi.stubGlobal('navigator', { onLine: false })
    announceMissingDoc('a', true, (n) => shown.push(n as never))
    expect(shown.map((n) => n.message)).toEqual(['문서를 찾을 수 없습니다.', '문서를 찾을 수 없습니다.'])
    expect(f).not.toHaveBeenCalled()
  })
})
