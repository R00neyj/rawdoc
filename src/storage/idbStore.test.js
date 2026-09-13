import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { openDB } from 'idb'
import { createIdbStore } from './idbStore.js'

// 테스트마다 새 DB 이름을 써서 격리한다 (fake-indexeddb 는 전역 indexedDB 를 공유)
let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-md-docs-${Date.now()}-${dbCounter}`
}
function freshStore() {
  return createIdbStore(freshDbName())
}

describe('idbStore', () => {
  it('kind 는 idb', async () => {
    const store = await freshStore()
    expect(store.kind).toBe('idb')
  })

  it('생성한 문서가 목록에 나타나고 updatedAt 내림차순으로 정렬된다', async () => {
    const store = await freshStore()
    const a = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    vi.spyOn(Date, 'now').mockReturnValue(a.updatedAt + 1000)
    const b = await store.create({ title: 'B', content: '', lineEnding: 'crlf' })
    vi.restoreAllMocks()

    const list = await store.list()
    expect(list.map((d) => d.id)).toEqual([b.id, a.id])
  })

  it('get 으로 단건을 읽는다. 없으면 null', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '내용', lineEnding: 'lf' })
    expect(await store.get(doc.id)).toEqual(doc)
    expect(await store.get('없는-id')).toBeNull()
  })

  it('update 는 updatedAt 을 갱신하고 patch 필드만 바꾼다', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '원본', lineEnding: 'crlf' })
    vi.spyOn(Date, 'now').mockReturnValue(doc.updatedAt + 1000)
    const updated = await store.update(doc.id, { content: '수정됨' })
    vi.restoreAllMocks()

    expect(updated.title).toBe('A')
    expect(updated.content).toBe('수정됨')
    expect(updated.updatedAt).toBeGreaterThan(doc.updatedAt)
  })

  it('없는 id 를 update 하면 reject 한다', async () => {
    const store = await freshStore()
    await expect(store.update('없는-id', { title: 'x' })).rejects.toThrow()
  })

  it('remove 하면 목록·조회에서 사라진다', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    await store.remove(doc.id)
    expect(await store.get(doc.id)).toBeNull()
    expect(await store.list()).toEqual([])
  })

  it('folderId 를 생략하면 null 로 생성된다', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    expect(doc.folderId).toBeNull()
  })

  describe('폴더 (F-126)', () => {
    it('createFolder 로 만들고 listFolders 로 읽는다', async () => {
      const store = await freshStore()
      const folder = await store.createFolder({ name: '기획', parentId: null })
      expect(folder.parentId).toBeNull()
      expect(await store.listFolders()).toEqual([folder])
    })

    it('빈 이름은 "새 폴더" 로 만든다', async () => {
      const store = await freshStore()
      const folder = await store.createFolder({ name: '', parentId: null })
      expect(folder.name).toBe('새 폴더')
    })

    it('최상위 폴더 안에는 하위 폴더를 만들 수 있다', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      expect(sub.parentId).toBe(top.id)
    })

    it('하위 폴더 안에는 폴더를 만들 수 없다(reject)', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      await expect(store.createFolder({ name: '더 아래', parentId: sub.id })).rejects.toThrow()
    })

    it('renameFolder 는 updatedAt 을 갱신한다', async () => {
      const store = await freshStore()
      const folder = await store.createFolder({ name: '기획', parentId: null })
      vi.spyOn(Date, 'now').mockReturnValue(folder.updatedAt + 1000)
      const renamed = await store.renameFolder(folder.id, '새 이름')
      vi.restoreAllMocks()
      expect(renamed.name).toBe('새 이름')
      expect(renamed.updatedAt).toBeGreaterThan(folder.updatedAt)
    })

    it('없는 폴더를 renameFolder 하면 reject 한다', async () => {
      const store = await freshStore()
      await expect(store.renameFolder('없는-id', '이름')).rejects.toThrow()
    })

    it('moveFolder 로 최상위 폴더 사이를 옮길 수 있다', async () => {
      const store = await freshStore()
      const a = await store.createFolder({ name: 'A', parentId: null })
      const b = await store.createFolder({ name: 'B', parentId: null })
      const moved = await store.moveFolder(a.id, b.id)
      expect(moved.parentId).toBe(b.id)
    })

    it('moveFolder 는 2단계를 넘으면 reject 한다', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const other = await store.createFolder({ name: '다른', parentId: null })
      await expect(store.moveFolder(other.id, sub.id)).rejects.toThrow()
    })

    it('moveFolder 는 자기 자신 안으로는 못 간다(reject)', async () => {
      const store = await freshStore()
      const a = await store.createFolder({ name: 'A', parentId: null })
      await expect(store.moveFolder(a.id, a.id)).rejects.toThrow()
    })

    it('moveDoc 은 folderId 만 바꾸고 updatedAt 은 그대로다', async () => {
      const store = await freshStore()
      const folder = await store.createFolder({ name: '기획', parentId: null })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      const moved = await store.moveDoc(doc.id, folder.id)
      expect(moved.folderId).toBe(folder.id)
      expect(moved.updatedAt).toBe(doc.updatedAt)
    })

    it('없는 문서를 moveDoc 하면 reject 한다', async () => {
      const store = await freshStore()
      await expect(store.moveDoc('없는-id', null)).rejects.toThrow()
    })

    it('removeFolder 는 안의 문서·하위 폴더를 한 단계 위로 옮기고 폴더를 지운다', async () => {
      const store = await freshStore()
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

    it('없는 폴더를 removeFolder 하면 reject 한다', async () => {
      const store = await freshStore()
      await expect(store.removeFolder('없는-id')).rejects.toThrow()
    })
  })

  describe('버전 1 → 2 마이그레이션 (F-126, A2·A8)', () => {
    it('버전 1 DB 에 넣은 문서가 버전 2 로 열어도 그대로 남는다', async () => {
      const dbName = freshDbName()

      // 버전 1 스키마(F-126 이전)를 직접 만들어 "기존 사용자" 상태를 흉내낸다
      const v1db = await openDB(dbName, 1, {
        upgrade(database) {
          database.createObjectStore('docs', { keyPath: 'id' })
          database.createObjectStore('meta', { keyPath: 'key' })
        },
      })
      const existingDoc = {
        id: 'legacy-doc',
        title: '옛 문서',
        content: '내용',
        lineEnding: 'crlf',
        createdAt: 1,
        updatedAt: 1,
      }
      await v1db.put('docs', existingDoc)
      await v1db.put('meta', { key: 'schema', version: 1 })
      v1db.close()

      // F-126 이 반영된 새 코드로 같은 DB 를 버전 2 로 연다
      const store = await createIdbStore(dbName)

      expect(store.kind).toBe('idb')
      const list = await store.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('legacy-doc')
      expect(list[0].title).toBe('옛 문서')
      // 옛 문서는 folderId 가 없었다 — 읽을 때 null 로 취급한다 (일괄로 다시 쓰지 않음)
      expect(list[0].folderId).toBeNull()

      // folders 스토어가 새로 생겼고 비어 있다
      expect(await store.listFolders()).toEqual([])

      // 새 폴더도 정상 동작한다
      const folder = await store.createFolder({ name: '새 폴더', parentId: null })
      expect(folder.parentId).toBeNull()
    })
  })
})
