// 로컬 휴지통 — S-10 소스·부팅 30일 정리 (small 2026-10-16)
import { describe, expect, it, vi, afterEach } from 'vitest'
import { localTrashSource, purgeExpiredTrash } from '../../../src/app/localTrash'
import { createMemoryStore } from '../../../src/storage/memoryStore'
import type { Store, TrashedDoc } from '../../../src/types'

const DAY = 24 * 60 * 60 * 1000

async function trashedAt(store: Store, title: string, deletedAt: number, folderId: string | null = null) {
  const doc = await store.create({ title, content: '', lineEnding: 'lf', folderId })
  vi.spyOn(Date, 'now').mockReturnValue(deletedAt)
  await store.remove(doc.id)
  vi.restoreAllMocks()
  return doc.id
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('purgeExpiredTrash — 앱을 열 때 30일 지난 휴지통 문서 정리', () => {
  it('딱 30일째는 남기고 그보다 1ms 지난 것만 영구 삭제한다, 살아 있는 문서는 그대로', async () => {
    const store = createMemoryStore()
    const now = 100 * DAY
    const live = await store.create({ title: '살아 있음', content: '', lineEnding: 'lf' })
    const edge = await trashedAt(store, '딱 30일', now - 30 * DAY)
    const over = await trashedAt(store, '30일 넘음', now - 30 * DAY - 1)
    const fresh = await trashedAt(store, '어제', now - DAY)

    expect(await purgeExpiredTrash(store, now)).toBe(1)
    expect((await store.listTrash!()).map((d) => d.id).sort()).toEqual([edge, fresh].sort())
    expect(await store.restoreTrash!(over)).toBeNull()
    expect(await store.get(live.id)).not.toBeNull()
  })

  it('지난 것이 없으면 0', async () => {
    const store = createMemoryStore()
    await trashedAt(store, 'a', 10 * DAY)
    expect(await purgeExpiredTrash(store, 10 * DAY)).toBe(0)
  })
})

describe('localTrashSource — S-10 이 쓰는 로컬 휴지통', () => {
  it('list 는 지운 때 최근순 TrashItem — 경로·남은 기한, 지운 주체 없음, 금고 문서는 제목을 비운다', async () => {
    const rows: TrashedDoc[] = [
      { id: 'old', title: '옛', content: '', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null, deletedAt: 1_000, deletedPath: null },
      { id: 'v', title: 'env', content: 'env', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: 'f', pinnedAt: null, e2eeKey: 'K', deletedAt: 3_000, deletedPath: '금고' },
      { id: 'mid', title: '회의 메모', content: '', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: 'g', pinnedAt: null, deletedAt: 2_000, deletedPath: '업무' },
    ]
    const source = localTrashSource({ listTrash: async () => rows, restoreTrash: vi.fn(), purgeTrash: vi.fn() })
    expect(await source.list()).toEqual([
      { id: 'v', title: '', e2ee: true, deletedAt: 3_000, path: '금고', purgeAt: 3_000 + 30 * DAY },
      { id: 'mid', title: '회의 메모', deletedAt: 2_000, path: '업무', purgeAt: 2_000 + 30 * DAY },
      { id: 'old', title: '옛', deletedAt: 1_000, path: null, purgeAt: 1_000 + 30 * DAY },
    ])
  })

  it('restore·purge·empty 를 서버 소스와 같은 결과 모양으로 — 없으면 gone, 던지면 failed', async () => {
    const store = createMemoryStore()
    const folder = await store.createFolder({ name: 'F' })
    const a = await trashedAt(store, 'a', 1_000, folder.id)
    const b = await trashedAt(store, 'b', 2_000)
    const c = await trashedAt(store, 'c', 3_000)
    const source = localTrashSource(store)

    expect(await source.restore(a)).toEqual({ status: 'ok', folderId: folder.id })
    expect(await source.restore(a)).toEqual({ status: 'gone' })
    expect(await source.purge(b)).toBe('ok')
    expect(await source.purge(b)).toBe('gone')
    expect(await source.empty()).toEqual({ status: 'ok', docs: 1 })
    expect(await store.listTrash!()).toEqual([])
    expect(await store.get(c)).toBeNull()

    const broken = localTrashSource({
      listTrash: async () => { throw new Error('x') },
      restoreTrash: async () => { throw new Error('x') },
      purgeTrash: async () => { throw new Error('x') },
    })
    await expect(broken.list()).rejects.toThrow()
    expect(await broken.restore('a')).toEqual({ status: 'failed' })
    expect(await broken.purge('a')).toBe('failed')
    expect(await broken.empty()).toEqual({ status: 'failed' })
  })
})
