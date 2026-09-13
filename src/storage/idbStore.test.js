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

  it('생성한 문서는 pinnedAt 이 null 이다', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    expect(doc.pinnedAt).toBeNull()
  })

  describe('상단 고정 (F-132)', () => {
    it('setPinned(id, true) 는 pinnedAt 을 지금 시각으로, updatedAt 은 그대로 둔다', async () => {
      const store = await freshStore()
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      vi.spyOn(Date, 'now').mockReturnValue(doc.updatedAt + 1000)
      const pinned = await store.setPinned(doc.id, true)
      vi.restoreAllMocks()

      expect(pinned.pinnedAt).not.toBeNull()
      expect(pinned.updatedAt).toBe(doc.updatedAt)
    })

    it('setPinned(id, false) 는 pinnedAt 을 null 로 되돌린다', async () => {
      const store = await freshStore()
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      await store.setPinned(doc.id, true)
      const unpinned = await store.setPinned(doc.id, false)
      expect(unpinned.pinnedAt).toBeNull()
    })

    it('없는 id 를 setPinned 하면 reject 한다', async () => {
      const store = await freshStore()
      await expect(store.setPinned('없는-id', true)).rejects.toThrow()
    })

    it('list 결과에 pinnedAt 이 포함된다', async () => {
      const store = await freshStore()
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      await store.setPinned(doc.id, true)
      const list = await store.list()
      expect(list[0].pinnedAt).not.toBeNull()
    })

    it('pinnedAt 필드가 없는 옛 문서는 null 로 취급한다', async () => {
      const dbName = freshDbName()
      const v1db = await openDB(dbName, 1, {
        upgrade(database) {
          database.createObjectStore('docs', { keyPath: 'id' })
          database.createObjectStore('meta', { keyPath: 'key' })
        },
      })
      await v1db.put('docs', {
        id: 'legacy-doc',
        title: '옛 문서',
        content: '내용',
        lineEnding: 'crlf',
        createdAt: 1,
        updatedAt: 1,
      })
      await v1db.put('meta', { key: 'schema', version: 1 })
      v1db.close()

      const store = await createIdbStore(dbName)
      const doc = await store.get('legacy-doc')
      expect(doc.pinnedAt).toBeNull()

      const pinned = await store.setPinned('legacy-doc', true)
      expect(pinned.pinnedAt).not.toBeNull()
    })
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

  describe('folderId 검사 (F-136.md 3.1·3.2)', () => {
    it('create 는 folderId 가 문자열이 아니면(예: 클릭 이벤트 객체) reject 하고 문서를 만들지 않는다', async () => {
      const store = await freshStore()
      await expect(
        store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: { type: 'click' } }),
      ).rejects.toThrow()
      expect(await store.list()).toEqual([])
    })

    it('create 는 존재하지 않는 폴더 id 면 reject 하고 문서를 만들지 않는다', async () => {
      const store = await freshStore()
      await expect(
        store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: '없는-폴더' }),
      ).rejects.toThrow()
      expect(await store.list()).toEqual([])
    })

    it('moveDoc 은 존재하지 않는 폴더 id 면 reject 하고 문서를 그대로 둔다(다른 문서 위에 놓는 경우 포함)', async () => {
      const store = await freshStore()
      const other = await store.create({ title: 'B', content: '', lineEnding: 'crlf' })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })

      // 다른 문서 행에 놓으면 그 문서 id 가 folderId 자리로 들어오는데, 문서 id 는 폴더가
      // 아니므로 거부해야 한다 (F-136.md 3.2)
      await expect(store.moveDoc(doc.id, other.id)).rejects.toThrow()

      const unchanged = await store.get(doc.id)
      expect(unchanged.folderId).toBeNull()
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

  describe('IndexedDB 업그레이드가 다른 창에 막힐 때 (F-136.md 3.3)', () => {
    it('v1 연결이 열려 있는 채로 v2 를 열면 새 연결의 onBlocked 가 불린다', async () => {
      const dbName = freshDbName()

      // "다른 창"이 옛 스키마(F-126 이전, 버전 1)로 연결을 쥐고 있는 상태를 흉내낸다.
      // blocking 콜백을 달지 않아 스스로 닫지 않으므로, 새 연결 쪽에서 blocked 가
      // 반드시 불린다(fake-indexeddb 는 versionchange 이벤트 처리 뒤에도 연결이 열려
      // 있어야만 blocked 를 큐에 넣는다)
      const v1db = await openDB(dbName, 1, {
        upgrade(database) {
          database.createObjectStore('docs', { keyPath: 'id' })
          database.createObjectStore('meta', { keyPath: 'key' })
        },
      })

      // onBlocked 콜백 안에서 옛 연결을 닫아 새 버전 열기가 진행되게 한다 — 실제 앱에서는
      // 사용자가 옛 창을 닫거나 새로고침해야 풀리는 대기 상태를 흉내낸다 (F-136.md 3.3)
      const onBlocked = vi.fn(() => {
        v1db.close()
      })
      // createIdbStore 는 항상 DB_VERSION(2)으로 연다 — v1 이 열려 있으므로 이 열기는
      // v1 이 닫힐 때까지 막힌다(blocked)
      const store = await createIdbStore(dbName, { onBlocked })

      expect(onBlocked).toHaveBeenCalled()
      expect(store.kind).toBe('idb')
    })

    it('이 창이 옛 버전이 되면(더 높은 버전이 열리면) 정리 콜백을 기다린 뒤 연결을 닫고 onClosed 를 부른다', async () => {
      const dbName = freshDbName()
      const order = []
      const onBlocking = vi.fn(async () => {
        order.push('blocking')
      })
      const onClosed = vi.fn(() => {
        order.push('closed')
      })

      // 이 창의 연결(F-136 코드 기준 버전 2)
      await createIdbStore(dbName, { onBlocking, onClosed })

      // "새 버전 창" 이 더 높은 버전(3)을 열려고 하면 위 연결의 blocking 이 불린다
      const v3db = await openDB(dbName, 3, {
        upgrade(database, oldVersion) {
          if (oldVersion < 1) {
            database.createObjectStore('docs', { keyPath: 'id' })
            database.createObjectStore('meta', { keyPath: 'key' })
          }
          if (oldVersion < 2) {
            database.createObjectStore('folders', { keyPath: 'id' })
          }
        },
      })

      expect(onBlocking).toHaveBeenCalled()
      expect(onClosed).toHaveBeenCalled()
      // 정리(flush 시늉)가 끝난 뒤에 닫힘 콜백이 불려야 한다 (F-136.md 3.3 순서)
      expect(order).toEqual(['blocking', 'closed'])

      v3db.close()
    })
  })
})
