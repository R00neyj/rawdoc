import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMemoryStore } from './memoryStore.js'

describe('memoryStore', () => {
  let store

  beforeEach(() => {
    store = createMemoryStore()
  })

  it('kind 는 memory', () => {
    expect(store.kind).toBe('memory')
  })

  it('생성한 문서가 목록에 나타나고 updatedAt 내림차순으로 정렬된다', async () => {
    const a = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    vi.spyOn(Date, 'now').mockReturnValue(a.updatedAt + 1000)
    const b = await store.create({ title: 'B', content: '', lineEnding: 'crlf' })
    vi.restoreAllMocks()

    const list = await store.list()
    expect(list.map((d) => d.id)).toEqual([b.id, a.id])
  })

  it('반환 객체는 복사본이라 외부에서 고쳐도 저장값이 안 바뀐다', async () => {
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    doc.title = '외부에서 변경'
    const fromStore = await store.get(doc.id)
    expect(fromStore.title).toBe('A')
  })

  it('수정하면 updatedAt 이 늘어난다', async () => {
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    vi.spyOn(Date, 'now').mockReturnValue(doc.updatedAt + 1000)
    const updated = await store.update(doc.id, { title: 'B' })
    vi.restoreAllMocks()

    expect(updated.updatedAt).toBeGreaterThan(doc.updatedAt)
    expect(updated.title).toBe('B')
  })

  it('삭제하면 목록·조회에서 사라진다', async () => {
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    await store.remove(doc.id)
    expect(await store.get(doc.id)).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('없는 id 를 수정하면 reject 한다', async () => {
    await expect(store.update('없는-id', { title: 'x' })).rejects.toThrow()
  })

  it('folderId 를 생략하면 null', async () => {
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    expect(doc.folderId).toBeNull()
  })

  describe('폴더 (F-126)', () => {
    it('createFolder 로 만들고 listFolders 로 읽는다', async () => {
      const folder = await store.createFolder({ name: '기획', parentId: null })
      expect(folder.parentId).toBeNull()
      expect(await store.listFolders()).toEqual([folder])
    })

    it('빈 이름은 "새 폴더" 로 만든다', async () => {
      const folder = await store.createFolder({ name: '', parentId: null })
      expect(folder.name).toBe('새 폴더')
    })

    it('최상위 폴더 안에는 하위 폴더를 만들 수 있다', async () => {
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      expect(sub.parentId).toBe(top.id)
    })

    it('하위 폴더 안에는 폴더를 만들 수 없다(reject)', async () => {
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      await expect(store.createFolder({ name: '더 아래', parentId: sub.id })).rejects.toThrow()
    })

    it('renameFolder 는 updatedAt 을 갱신한다', async () => {
      const folder = await store.createFolder({ name: '기획', parentId: null })
      vi.spyOn(Date, 'now').mockReturnValue(folder.updatedAt + 1000)
      const renamed = await store.renameFolder(folder.id, '새 이름')
      vi.restoreAllMocks()
      expect(renamed.name).toBe('새 이름')
      expect(renamed.updatedAt).toBeGreaterThan(folder.updatedAt)
    })

    it('moveFolder 로 최상위 폴더 사이를 옮길 수 있다', async () => {
      const a = await store.createFolder({ name: 'A', parentId: null })
      const b = await store.createFolder({ name: 'B', parentId: null })
      const moved = await store.moveFolder(a.id, b.id)
      expect(moved.parentId).toBe(b.id)
    })

    it('moveFolder 는 2단계를 넘으면 reject 한다', async () => {
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const other = await store.createFolder({ name: '다른', parentId: null })
      await expect(store.moveFolder(other.id, sub.id)).rejects.toThrow()
    })

    it('moveDoc 은 folderId 만 바꾸고 updatedAt 은 그대로다', async () => {
      const folder = await store.createFolder({ name: '기획', parentId: null })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      const moved = await store.moveDoc(doc.id, folder.id)
      expect(moved.folderId).toBe(folder.id)
      expect(moved.updatedAt).toBe(doc.updatedAt)
    })

    it('removeFolder 는 안의 문서·하위 폴더를 한 단계 위로 옮기고 폴더를 지운다', async () => {
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: top.id })

      await store.removeFolder(top.id)

      const folders = await store.listFolders()
      expect(folders.find((f) => f.id === top.id)).toBeUndefined()
      expect(folders.find((f) => f.id === sub.id).parentId).toBeNull()

      const updatedDoc = await store.get(doc.id)
      expect(updatedDoc.folderId).toBeNull()
    })
  })
})
