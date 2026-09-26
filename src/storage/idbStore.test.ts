import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { openDB } from 'idb'
import { createIdbStore, readE2eeRow, writeE2eeRow, markLocalE2eeMigrated } from './idbStore'
import type { CommentRecord } from '../lib/docComments'

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
      expect(doc!.pinnedAt).toBeNull()

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

    it('하위 폴더 안에도 폴더를 만들 수 있다', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const deeper = await store.createFolder({ name: '더 아래', parentId: sub.id })
      expect(deeper.parentId).toBe(sub.id)
    })

    it('3단계 이상 만들기·자식 있는 폴더 옮기기는 되고, 자기 손자 안으로는 reject (F-2017 U8)', async () => {
      const store = await freshStore()
      const a = await store.createFolder({ name: 'A', parentId: null })
      const a1 = await store.createFolder({ name: 'A1', parentId: a.id })
      const a2 = await store.createFolder({ name: 'A2', parentId: a1.id })
      const a3 = await store.createFolder({ name: 'A3', parentId: a2.id })
      expect(a3.parentId).toBe(a2.id)
      const b = await store.createFolder({ name: 'B', parentId: null })
      expect((await store.moveFolder(a.id, b.id)).parentId).toBe(b.id)
      await expect(store.moveFolder(a.id, a2.id)).rejects.toThrow()
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

    it('moveFolder 로 다른 폴더를 하위 폴더 안으로 옮길 수 있다', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const other = await store.createFolder({ name: '다른', parentId: null })
      expect((await store.moveFolder(other.id, sub.id)).parentId).toBe(sub.id)
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
      expect(folders.find((f) => f.id === sub.id)!.parentId).toBeNull()

      const updatedDoc = await store.get(doc.id)
      expect(updatedDoc!.folderId).toBeNull()
    })

    it('없는 폴더를 removeFolder 하면 reject 한다', async () => {
      const store = await freshStore()
      await expect(store.removeFolder('없는-id')).rejects.toThrow()
    })

    it('removeFolder(id, "move-up") 은 인자 없을 때와 같다', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: top.id })

      await store.removeFolder(top.id, 'move-up')

      const folders = await store.listFolders()
      expect(folders.find((f) => f.id === top.id)).toBeUndefined()
      expect(folders.find((f) => f.id === sub.id)!.parentId).toBeNull()
      expect((await store.get(doc.id))!.folderId).toBeNull()
    })

    it('removeFolder(id, "delete-all") 은 대상·하위 폴더·그 안 문서를 모두 지우고, 형제 폴더·바깥 문서는 남긴다', async () => {
      const store = await freshStore()
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const sibling = await store.createFolder({ name: '형제', parentId: null })
      const docInTop = await store.create({ title: '탑문서', content: '', lineEnding: 'crlf', folderId: top.id })
      const docInSub = await store.create({ title: '서브문서', content: '', lineEnding: 'crlf', folderId: sub.id })
      const outsideDoc = await store.create({ title: '바깥문서', content: '', lineEnding: 'crlf' })

      await store.removeFolder(top.id, 'delete-all')

      const folders = await store.listFolders()
      expect(folders.map((f) => f.id).sort()).toEqual([sibling.id].sort())

      expect(await store.get(docInTop.id)).toBeNull()
      expect(await store.get(docInSub.id)).toBeNull()
      expect(await store.get(outsideDoc.id)).not.toBeNull()
    })
  })

  describe('folderId 검사 (F-136.md 3.1·3.2)', () => {
    it('create 는 folderId 가 문자열이 아니면(예: 클릭 이벤트 객체) reject 하고 문서를 만들지 않는다', async () => {
      const store = await freshStore()
      await expect(
        // 런타임 방어 검사를 테스트하려고 의도적으로 잘못된 타입을 넘긴다 (F-136.md 3.1)
        store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: { type: 'click' } as unknown as string }),
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
      expect(unchanged!.folderId).toBeNull()
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

  describe('첨부 이미지 (F-156, 버전 3)', () => {
    function blob(bytes = [1, 2, 3]) {
      return new Blob([new Uint8Array(bytes)])
    }

    it('putAttachment 은 16진수 16자 id 를 뽑고 getAttachment 으로 읽힌다', async () => {
      const store = await freshStore()
      const { id, ext } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 10, height: 20 })
      expect(id).toMatch(/^[0-9a-f]{16}$/)
      expect(ext).toBe('png')

      const record = await store.getAttachment(id)
      expect(record!.mime).toBe('image/png')
      expect(record!.width).toBe(10)
      expect(record!.height).toBe(20)
      expect(record!.size).toBe(3)
    })

    it('없는 id 는 null', async () => {
      const store = await freshStore()
      expect(await store.getAttachment('없는-id')).toBeNull()
    })

    it('listAttachments 는 blob 을 뺀 메타만 돌려준다', async () => {
      const store = await freshStore()
      const { id } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
      const list = await store.listAttachments()
      expect(list).toEqual([{ id, ext: 'png', size: 3, createdAt: expect.any(Number) }])
    })

    it('removeAttachment 으로 지운다', async () => {
      const store = await freshStore()
      const { id } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
      await store.removeAttachment(id)
      expect(await store.getAttachment(id)).toBeNull()
    })

    it('F-406 U10 e2ee 를 주면 행·응답에 e2ee: true, 안 주면 키 자체가 없다', async () => {
      const store = await freshStore()
      const { id } = await store.putAttachment({ blob: blob(), mime: 'application/octet-stream', ext: 'png', width: 10, height: 20, e2ee: true })
      const record = await store.getAttachment(id)
      expect(record!.e2ee).toBe(true)

      const { id: plainId } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
      const plainRecord = await store.getAttachment(plainId)
      expect('e2ee' in plainRecord!).toBe(false)
    })
  })

  describe('버전 2 → 3 마이그레이션 (F-156)', () => {
    it('버전 2 DB 에 넣은 문서·폴더가 버전 3 으로 열어도 그대로 남고, attachments 스토어가 새로 생긴다', async () => {
      const dbName = freshDbName()

      const v2db = await openDB(dbName, 2, {
        upgrade(database) {
          database.createObjectStore('docs', { keyPath: 'id' })
          database.createObjectStore('meta', { keyPath: 'key' })
          database.createObjectStore('folders', { keyPath: 'id' })
        },
      })
      await v2db.put('docs', {
        id: 'legacy-doc',
        title: '옛 문서',
        content: '내용',
        lineEnding: 'crlf',
        createdAt: 1,
        updatedAt: 1,
        folderId: null,
        pinnedAt: null,
      })
      await v2db.put('folders', { id: 'legacy-folder', name: '옛 폴더', parentId: null, createdAt: 1, updatedAt: 1 })
      await v2db.put('meta', { key: 'schema', version: 2 })
      v2db.close()

      const store = await createIdbStore(dbName)

      expect(store.kind).toBe('idb')
      const list = await store.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('legacy-doc')

      const folders = await store.listFolders()
      expect(folders).toHaveLength(1)
      expect(folders[0].id).toBe('legacy-folder')

      expect(await store.listAttachments()).toEqual([])
      const { id } = await store.putAttachment({
        blob: new Blob([new Uint8Array([1])]),
        mime: 'image/png',
        ext: 'png',
        width: 1,
        height: 1,
      })
      expect(await store.getAttachment(id)).not.toBeNull()
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
      // createIdbStore 는 항상 DB_VERSION(6)으로 연다 — v1 이 열려 있으므로 이 열기는
      // v1 이 닫힐 때까지 막힌다(blocked)
      const store = await createIdbStore(dbName, { onBlocked })

      expect(onBlocked).toHaveBeenCalled()
      expect(store.kind).toBe('idb')
    })

    it('이 창이 옛 버전이 되면(더 높은 버전이 열리면) 정리 콜백을 기다린 뒤 연결을 닫고 onClosed 를 부른다', async () => {
      const dbName = freshDbName()
      const order: string[] = []
      const onBlocking = vi.fn(async () => {
        order.push('blocking')
      })
      const onClosed = vi.fn(() => {
        order.push('closed')
      })

      // 이 창의 연결(F-508 코드 기준 버전 6)
      await createIdbStore(dbName, { onBlocking, onClosed })

      // "새 버전 창" 이 더 높은 버전(7)을 열려고 하면 위 연결의 blocking 이 불린다
      const v7db = await openDB(dbName, 7, {
        upgrade(database, oldVersion) {
          if (oldVersion < 1) {
            database.createObjectStore('docs', { keyPath: 'id' })
            database.createObjectStore('meta', { keyPath: 'key' })
          }
          if (oldVersion < 2) {
            database.createObjectStore('folders', { keyPath: 'id' })
          }
          if (oldVersion < 3) {
            database.createObjectStore('attachments', { keyPath: 'id' })
          }
          if (oldVersion < 4) {
            database.createObjectStore('fileHandles', { keyPath: 'docId' })
          }
          if (oldVersion < 5) {
            database.createObjectStore('e2ee', { keyPath: 'id' })
          }
          if (oldVersion < 6) {
            database.createObjectStore('comments', { keyPath: 'docId' })
          }
        },
      })

      expect(onBlocking).toHaveBeenCalled()
      expect(onClosed).toHaveBeenCalled()
      // 정리(flush 시늉)가 끝난 뒤에 닫힘 콜백이 불려야 한다 (F-136.md 3.3 순서)
      expect(order).toEqual(['blocking', 'closed'])

      v7db.close()
    })
  })

  describe('버전 4 → 5 마이그레이션, 금고 키 묶음 행 (F-404.md 5.1 U12)', () => {
    it('v4 DB 의 문서가 그대로 남고, e2ee 스토어가 생기고, writeE2eeRow 의 세 조건이 맞게 판정한다', async () => {
      const dbName = freshDbName()

      const v4db = await openDB(dbName, 4, {
        upgrade(database) {
          database.createObjectStore('docs', { keyPath: 'id' })
          database.createObjectStore('meta', { keyPath: 'key' })
          database.createObjectStore('folders', { keyPath: 'id' })
          database.createObjectStore('attachments', { keyPath: 'id' })
          database.createObjectStore('fileHandles', { keyPath: 'docId' })
        },
      })
      await v4db.put('docs', {
        id: 'legacy-doc',
        title: '옛 문서',
        content: '내용',
        lineEnding: 'lf',
        createdAt: 1,
        updatedAt: 1,
        folderId: null,
        pinnedAt: null,
      })
      await v4db.put('meta', { key: 'schema', version: 4 })
      v4db.close()

      const store = await createIdbStore(dbName)
      const list = await store.list()
      expect(list).toHaveLength(1)
      expect(list[0].id).toBe('legacy-doc')

      const raw = await openDB(dbName)
      expect([...raw.objectStoreNames]).toContain('e2ee')
      const meta = await raw.get('meta', 'schema')
      expect(meta.version).toBe(6)
      raw.close()

      expect(await writeE2eeRow({ id: 'local', bundle: 'b1', updatedAt: 1 }, null, dbName)).toBe(true)
      expect(await writeE2eeRow({ id: 'local', bundle: 'b2', updatedAt: 2 }, { absent: true }, dbName)).toBe(false)
      expect(await writeE2eeRow({ id: 'local', bundle: 'b3', updatedAt: 3 }, { bundle: 'b1' }, dbName)).toBe(true)
      expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b3', updatedAt: 3 })
    })
  })

  describe('로그인 이관 표시 (F-408.md 3.1 I1·I2)', () => {
    it('I1: markLocalE2eeMigrated', async () => {
      const dbName = freshDbName()
      expect(await markLocalE2eeMigrated('u1', 'b1', dbName)).toBe(false)

      await writeE2eeRow({ id: 'local', bundle: 'b1', updatedAt: 1 }, null, dbName)
      expect(await markLocalE2eeMigrated('u1', 'b-다른', dbName)).toBe(false)
      expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b1', updatedAt: 1 })

      expect(await markLocalE2eeMigrated('u1', 'b1', dbName)).toBe(true)
      expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b1', updatedAt: 1, migratedTo: ['u1'] })

      expect(await markLocalE2eeMigrated('u1', 'b1', dbName)).toBe(true)
      expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b1', updatedAt: 1, migratedTo: ['u1'] })

      expect(await markLocalE2eeMigrated('u2', 'b1', dbName)).toBe(true)
      expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b1', updatedAt: 1, migratedTo: ['u1', 'u2'] })
    })

    it('I2: writeE2eeRow 옮겨 싣기', async () => {
      const dbName = freshDbName()
      await writeE2eeRow({ id: 'local', bundle: 'b1', updatedAt: 1 }, null, dbName)
      await markLocalE2eeMigrated('u1', 'b1', dbName)

      // migratedTo 있는 로컬 행 — 새 값이 migratedTo 를 안 주고, 조건(bundle 옛것)이 맞으면 옮겨 싣는다
      expect(await writeE2eeRow({ id: 'local', bundle: 'b2', updatedAt: 2 }, { bundle: 'b1' }, dbName)).toBe(true)
      expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b2', updatedAt: 2, migratedTo: ['u1'] })

      // 계정 행은 지금과 같다 — 옮겨 싣지 않는다
      await writeE2eeRow({ id: 'account:u9', bundle: 'a1', rev: 0, updatedAt: 1 }, null, dbName)
      await writeE2eeRow({ id: 'account:u9', bundle: 'a2', rev: 1, updatedAt: 2 }, null, dbName)
      expect(await readE2eeRow('account:u9', dbName)).toEqual({ id: 'account:u9', bundle: 'a2', rev: 1, updatedAt: 2 })

      // migratedTo 없던 로컬 행은 지금과 같다
      const dbName2 = freshDbName()
      await writeE2eeRow({ id: 'local', bundle: 'c1', updatedAt: 1 }, null, dbName2)
      await writeE2eeRow({ id: 'local', bundle: 'c2', updatedAt: 2 }, { bundle: 'c1' }, dbName2)
      expect(await readE2eeRow('local', dbName2)).toEqual({ id: 'local', bundle: 'c2', updatedAt: 2 })
    })
  })

  describe('OS 파일 열기 재중복 방지 (F-231.md 3.1)', () => {
    // Node 의 structuredClone 은 FileSystemFileHandle 을 모른다 — 이 테스트는 조회·정리 로직만 보므로 클론을 항등 함수로 바꿔 메서드를 유지한다
    function makeHandle(name: string) {
      return { kind: 'file' as const, name, isSameEntry: vi.fn(async (other: { name: string }) => other?.name === name) }
    }

    it('linkFileHandle 뒤 findDocByFileHandle 는 같은 handle 로 docId 를 찾고, 다른 handle 은 null', async () => {
      vi.stubGlobal('structuredClone', (v: unknown) => v)
      try {
        const store = await freshStore()
        const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
        const handleA = makeHandle('a.md')
        const handleB = makeHandle('b.md')

        await store.linkFileHandle!(doc.id, handleA as unknown as FileSystemFileHandle)

        expect(await store.findDocByFileHandle!(handleA as unknown as FileSystemFileHandle)).toBe(doc.id)
        expect(await store.findDocByFileHandle!(handleB as unknown as FileSystemFileHandle)).toBeNull()
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('매치된 문서를 remove 한 뒤 같은 handle 로 조회하면 null (고아 정리)', async () => {
      vi.stubGlobal('structuredClone', (v: unknown) => v)
      try {
        const store = await freshStore()
        const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
        const handle = makeHandle('a.md')

        await store.linkFileHandle!(doc.id, handle as unknown as FileSystemFileHandle)
        await store.remove(doc.id)

        expect(await store.findDocByFileHandle!(handle as unknown as FileSystemFileHandle)).toBeNull()
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('가져오기 선택 필드 (F-282.md 3.11)', () => {
    it('create 에 id·createdAt·updatedAt·pinnedAt 을 주면 그대로 쓰고, 이미 있는 id 면 던진다', async () => {
      const store = await freshStore()
      const doc = await store.create({ title: 'A', content: '내용', lineEnding: 'lf', id: 'fixed-id', createdAt: 111, updatedAt: 222, pinnedAt: 333 })
      expect(doc.id).toBe('fixed-id')
      expect(doc.createdAt).toBe(111)
      expect(doc.updatedAt).toBe(222)
      expect(doc.pinnedAt).toBe(333)

      await expect(store.create({ title: 'B', content: '', lineEnding: 'lf', id: 'fixed-id' })).rejects.toThrow()
    })

    it('createFolder 에 id·createdAt·updatedAt 을 주면 그대로 쓰고, 이미 있는 id 면 던진다', async () => {
      const store = await freshStore()
      const folder = await store.createFolder({ name: 'A', id: 'fixed-folder', createdAt: 111, updatedAt: 222 })
      expect(folder.id).toBe('fixed-folder')
      expect(folder.createdAt).toBe(111)
      expect(folder.updatedAt).toBe(222)

      await expect(store.createFolder({ name: 'B', id: 'fixed-folder' })).rejects.toThrow()
    })

    it('putAttachment 에 id 를 주면 그 id 로 저장하고, 이미 있으면 덮지 않고 그대로 돌려준다', async () => {
      const store = await freshStore()
      const blob = new Blob([new Uint8Array([1, 2, 3])])
      const first = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1, id: 'fixed-att' })
      expect(first.id).toBe('fixed-att')

      const dup = await store.putAttachment({ blob: new Blob([new Uint8Array([9, 9])]), mime: 'image/png', ext: 'png', width: 1, height: 1, id: 'fixed-att' })
      expect(dup).toEqual({ id: 'fixed-att', ext: 'png' })
      const record = await store.getAttachment('fixed-att')
      expect(record!.size).toBe(3) // 덮지 않았다
    })
  })
})

// F-405 U13 — 금고 필드는 값이 있을 때만 행에 싣는다. 버전은 5 그대로 (specs/features/F-405.md 3.3, 9.1)
describe('F-405 U13 금고 필드', () => {
  it('create·update·moveDoc·createFolder 가 새 필드를 싣고 남긴다, 안 주면 키가 없다', async () => {
    const dbName = freshDbName()
    const store = await createIdbStore(dbName)
    const folder = await store.createFolder({ name: 'F' })
    const vault = await store.create({ title: 'env-t', content: 'env-c', lineEnding: 'lf', e2eeKey: 'K'.repeat(56), attachmentRefs: ['00000000000000aa'] })
    const plain = await store.create({ title: 'P', content: '', lineEnding: 'lf' })
    await store.update(vault.id, { content: 'env-c2', attachmentRefs: ['00000000000000bb'] })
    await store.moveDoc(vault.id, folder.id)
    const vaultFolder = await store.createFolder({ name: 'V', e2ee: true })

    const raw = await openDB(dbName)
    const vaultRow = await raw.get('docs', vault.id)
    const plainRow = await raw.get('docs', plain.id)
    const vaultFolderRow = await raw.get('folders', vaultFolder.id)
    const folderRow = await raw.get('folders', folder.id)
    const meta = await raw.get('meta', 'schema')
    raw.close()

    expect(vaultRow.e2eeKey).toBe('K'.repeat(56))
    expect(vaultRow.attachmentRefs).toEqual(['00000000000000bb'])
    expect(vaultRow.folderId).toBe(folder.id)
    expect(vaultRow.content).toBe('env-c2')
    expect('e2eeKey' in plainRow).toBe(false)
    expect('attachmentRefs' in plainRow).toBe(false)
    expect(vaultFolderRow.e2ee).toBe(true)
    expect('e2ee' in folderRow).toBe(false)
    expect(meta.version).toBe(6)
  })
})

// F-407 U21 — 옮기기·빼기·폴더 표지·첨부 지우기 로컬 판 (specs/features/F-407.md 5.3, 9.1)
describe('F-407 U21 금고로 옮기기·빼기 로컬 판', () => {
  it('setDocE2ee 옮기기 뒤 빼기 — 두 키가 행에서 없어진다, 버전 6 그대로', async () => {
    const dbName = freshDbName()
    const store = await createIdbStore(dbName)
    const doc = await store.create({ title: 't', content: 'c', lineEnding: 'lf' })
    const moved = await store.setDocE2ee!(doc.id, { e2ee: true, title: 'env-t', content: 'env-c', e2eeKey: 'K'.repeat(56), attachmentRefs: ['00000000000000aa'] })
    expect(moved.purged).toBe(true)
    expect(moved.doc.e2eeKey).toBe('K'.repeat(56))
    const back = await store.setDocE2ee!(doc.id, { e2ee: false, title: 't2', content: 'c2', e2eeKey: null, attachmentRefs: null })
    expect(back.doc.title).toBe('t2')

    const raw = await openDB(dbName)
    const row = await raw.get('docs', doc.id)
    const meta = await raw.get('meta', 'schema')
    raw.close()
    expect('e2eeKey' in row).toBe(false)
    expect('attachmentRefs' in row).toBe(false)
    expect(row.content).toBe('c2')
    expect(meta.version).toBe(6)
    await expect(store.setDocE2ee!('없는-id', { e2ee: false, title: '', content: '' })).rejects.toThrow()
  })

  it('setFolderE2ee — 켜기 조건 미달 e2ee_folder_not_ready, 부모가 금고면 끄기 e2ee_folder', async () => {
    const store = await freshStore()
    const outer = await store.createFolder({ name: 'O' })
    const inner = await store.createFolder({ name: 'I', parentId: outer.id })
    const plainDoc = await store.create({ title: 'p', content: '', lineEnding: 'lf', folderId: inner.id })
    await expect(store.setFolderE2ee!(inner.id, true)).rejects.toThrow('e2ee_folder_not_ready')
    await store.setDocE2ee!(plainDoc.id, { e2ee: true, title: 'e', content: 'e', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })
    expect((await store.setFolderE2ee!(inner.id, true)).e2ee).toBe(true)
    await expect(store.setFolderE2ee!(outer.id, true)).resolves.toMatchObject({ e2ee: true })
    await expect(store.setFolderE2ee!(inner.id, false)).rejects.toThrow('e2ee_folder')
    const off = await store.setFolderE2ee!(outer.id, false)
    expect('e2ee' in off).toBe(false)
    expect('e2ee' in (await store.setFolderE2ee!(inner.id, false))).toBe(false)
  })

  it('discardAttachment — 없으면 not_found, 다른 금고 문서 attachmentRefs·본문이 쓰면 in_use, 아니면 deleted', async () => {
    const store = await freshStore()
    const blob = new Blob([new Uint8Array([1, 2, 3])])
    const a = await store.putAttachmentNow!({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1 })
    const b = await store.putAttachmentNow!({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1, e2ee: true })
    const c = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1 })
    expect((await store.getAttachment(b.id))?.e2ee).toBe(true)
    await store.create({ title: 'v', content: 'env', lineEnding: 'lf', e2eeKey: 'K'.repeat(56), attachmentRefs: [b.id] })
    await store.create({ title: 'p', content: `![](attachments/${c.id}.png)`, lineEnding: 'lf' })
    expect(await store.discardAttachment!('ffffffffffffffff', 'png')).toBe('not_found')
    expect(await store.discardAttachment!(b.id, 'png')).toBe('in_use')
    expect(await store.discardAttachment!(c.id, 'png')).toBe('in_use')
    expect(await store.discardAttachment!(a.id, 'png')).toBe('deleted')
    expect(await store.getAttachment(a.id)).toBeNull()
    expect(await store.getAttachment(b.id)).not.toBeNull()
  })
})

// F-508 3.1·4장·5장·8장 — 로컬 문서 댓글 저장소
function makeRecord(id: string, over: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id,
    parent: null,
    body: `본문 ${id}`,
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
    ...over,
  }
}

describe('F-508 로컬 문서 댓글 저장소', () => {
  it('U1: 버전 5 DB(문서 둘·폴더 하나·e2ee 행 local)를 만든 뒤 createIdbStore — 문서·폴더·e2ee 행 그대로, comments 스토어 생김, 메타 버전 6', async () => {
    const dbName = freshDbName()
    const v5db = await openDB(dbName, 5, {
      upgrade(database) {
        database.createObjectStore('docs', { keyPath: 'id' })
        database.createObjectStore('meta', { keyPath: 'key' })
        database.createObjectStore('folders', { keyPath: 'id' })
        database.createObjectStore('attachments', { keyPath: 'id' })
        database.createObjectStore('fileHandles', { keyPath: 'docId' })
        database.createObjectStore('e2ee', { keyPath: 'id' })
      },
    })
    await v5db.put('docs', { id: 'd1', title: 'A', content: 'a', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null })
    await v5db.put('docs', { id: 'd2', title: 'B', content: 'b', lineEnding: 'lf', createdAt: 1, updatedAt: 1, folderId: null, pinnedAt: null })
    await v5db.put('folders', { id: 'f1', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 })
    await v5db.put('e2ee', { id: 'local', bundle: 'b1', updatedAt: 1 })
    await v5db.put('meta', { key: 'schema', version: 5 })
    v5db.close()

    const store = await createIdbStore(dbName)
    const list = await store.list()
    expect(list.map((d) => d.id).sort()).toEqual(['d1', 'd2'])
    expect(await store.listFolders()).toEqual([{ id: 'f1', name: 'F', parentId: null, createdAt: 1, updatedAt: 1 }])
    expect(await readE2eeRow('local', dbName)).toEqual({ id: 'local', bundle: 'b1', updatedAt: 1 })

    const raw = await openDB(dbName)
    expect([...raw.objectStoreNames]).toContain('comments')
    const meta = await raw.get('meta', 'schema')
    expect(meta.version).toBe(6)
    raw.close()
  })

  it('U2: update(a, { content, comments: [r1, r2] }) — docs 행 갱신, getCommentRecords 가 깊은 같음, 행의 v 1', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '원본', lineEnding: 'lf' })
    const r1 = makeRecord('c1')
    const r2 = makeRecord('c2')
    const updated = await store.update(doc.id, { content: 'x', comments: [r1, r2] })
    expect(updated.content).toBe('x')
    expect(updated.updatedAt).toBeGreaterThanOrEqual(doc.updatedAt)
    expect(await store.getCommentRecords!(doc.id)).toEqual([r1, r2])
  })

  it('U3: 같은 문서에 comments 만 다시 update — docs 행 그대로(updatedAt 포함), 기록만 바뀜', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '원본', lineEnding: 'lf' })
    const first = await store.update(doc.id, { content: 'x', comments: [makeRecord('c1'), makeRecord('c2')] })
    const r1 = makeRecord('c1', { body: '고침' })
    const commentsOnly = await store.update(doc.id, { comments: [r1] })
    expect(commentsOnly).toEqual(first)
    expect(await store.getCommentRecords!(doc.id)).toEqual([r1])
  })

  it('U4: comments 빈 배열이면 행 지움, 필드 없으면 그대로', async () => {
    const store = await freshStore()
    const doc = await store.create({ title: 'A', content: '원본', lineEnding: 'lf' })
    await store.update(doc.id, { comments: [makeRecord('c1')] })
    await store.update(doc.id, { comments: [] })
    expect(await store.getCommentRecords!(doc.id)).toEqual([])
    await store.update(doc.id, { comments: [makeRecord('c1')] })
    await store.update(doc.id, { content: 'y' })
    expect(await store.getCommentRecords!(doc.id)).toEqual([makeRecord('c1')])
  })

  it('U5: 없는 id 에 update(comments 포함) — 던짐, comments 스토어에 행 없음', async () => {
    const store = await freshStore()
    await expect(store.update('없음', { content: 'x', comments: [makeRecord('c1')] })).rejects.toThrow()
    expect(await store.getCommentRecords!('없음')).toEqual([])
  })

  it('U6: 금고 행에는 update(comments 포함) 해도 기록 행이 생기지 않는다, 일반 행은 생긴다', async () => {
    const store = await freshStore()
    const vault = await store.create({ title: 'v', content: 'env', lineEnding: 'lf', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })
    const plain = await store.create({ title: 'p', content: 'p', lineEnding: 'lf' })
    const updatedVault = await store.update(vault.id, { content: 'env2', comments: [makeRecord('c1')] })
    expect(updatedVault.content).toBe('env2')
    expect(await store.getCommentRecords!(vault.id)).toEqual([])
    await store.update(plain.id, { content: 'p2', comments: [makeRecord('c2')] })
    expect(await store.getCommentRecords!(plain.id)).toEqual([makeRecord('c2')])
  })

  it('U7: remove·removeFolder(delete-all)·removeFolder(move-up) 이 기록에 하는 것', async () => {
    const store = await freshStore()
    const a = await store.create({ title: 'a', content: '', lineEnding: 'lf' })
    const folderF = await store.createFolder({ name: 'F' })
    const b = await store.create({ title: 'b', content: '', lineEnding: 'lf', folderId: folderF.id })
    const folderG = await store.createFolder({ name: 'G' })
    const c = await store.create({ title: 'c', content: '', lineEnding: 'lf', folderId: folderG.id })
    await store.update(a.id, { comments: [makeRecord('ca')] })
    await store.update(b.id, { comments: [makeRecord('cb')] })
    await store.update(c.id, { comments: [makeRecord('cc')] })

    await store.remove(a.id)
    expect(await store.getCommentRecords!(a.id)).toEqual([])
    expect(await store.getCommentRecords!(b.id)).toEqual([makeRecord('cb')])

    await store.removeFolder(folderF.id, 'delete-all')
    expect(await store.getCommentRecords!(b.id)).toEqual([])

    await store.removeFolder(folderG.id, 'move-up')
    expect(await store.getCommentRecords!(c.id)).toEqual([makeRecord('cc')])
  })

  it('U8: 원시 comments 행이 모양 틀리면 getCommentRecords 는 던지고, listCommentRecords 는 그 행만 뺀다', async () => {
    const dbName = freshDbName()
    const store = await createIdbStore(dbName)
    const good = await store.create({ title: 'good', content: '', lineEnding: 'lf' })
    await store.update(good.id, { comments: [makeRecord('c1')] })

    const raw = await openDB(dbName)
    await raw.put('comments', { docId: 'bad-shape', v: 1, records: [{ id: 'x' }], updatedAt: 1 })
    await raw.put('comments', { docId: 'bad-version', v: 2, records: [makeRecord('c2')], updatedAt: 1 })
    raw.close()

    await expect(store.getCommentRecords!('bad-shape')).rejects.toThrow('comments_row_invalid')
    await expect(store.getCommentRecords!('bad-version')).rejects.toThrow('comments_row_invalid')

    const all = await store.listCommentRecords!()
    expect(all.has('bad-shape')).toBe(false)
    expect(all.has('bad-version')).toBe(false)
    expect(all.get(good.id)).toEqual([makeRecord('c1')])
  })

  it('U9: listCommentRecords() — 기록 있는 문서 둘·없는 문서 하나', async () => {
    const store = await freshStore()
    const a = await store.create({ title: 'a', content: '', lineEnding: 'lf' })
    const b = await store.create({ title: 'b', content: '', lineEnding: 'lf' })
    const c = await store.create({ title: 'c', content: '', lineEnding: 'lf' })
    await store.update(a.id, { comments: [makeRecord('ca')] })
    await store.update(b.id, { comments: [makeRecord('cb')] })

    const all = await store.listCommentRecords!()
    expect(all.size).toBe(2)
    expect(all.get(a.id)).toEqual([makeRecord('ca')])
    expect(all.get(b.id)).toEqual([makeRecord('cb')])
    expect(all.has(c.id)).toBe(false)
  })
})

// F-509 2.3·4.2·4.3 — 금고로 옮길 때 댓글 기록 지우기
describe('F-509 로컬 금고로 옮길 때 댓글 기록', () => {
  it('U10: setDocE2ee(e2ee: true) 는 같은 트랜잭션에서 그 문서 기록을 지운다. false·없는 id 는 손대지 않는다', async () => {
    const store = await freshStore()
    const a = await store.create({ title: 'a', content: '원본a', lineEnding: 'lf' })
    const b = await store.create({ title: 'b', content: '원본b', lineEnding: 'lf' })
    await store.update(a.id, { comments: [makeRecord('ca')] })
    await store.update(b.id, { comments: [makeRecord('cb')] })

    const moved = await store.setDocE2ee!(a.id, { e2ee: true, title: 'env-t', content: 'env-c', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })
    expect(moved.doc.e2eeKey).toBe('K'.repeat(56))
    expect(await store.getCommentRecords!(a.id)).toEqual([])
    expect(await store.getCommentRecords!(b.id)).toEqual([makeRecord('cb')])

    // 빼기는 기록을 건드리지 않는다 — 되살아나지 않는다
    await store.setDocE2ee!(a.id, { e2ee: false, title: 't2', content: 'c2', e2eeKey: null, attachmentRefs: null })
    expect(await store.getCommentRecords!(a.id)).toEqual([])

    // 없는 id — 던지고 b 기록은 그대로
    await expect(store.setDocE2ee!('없는-id', { e2ee: true, title: '', content: '' })).rejects.toThrow()
    expect(await store.getCommentRecords!(b.id)).toEqual([makeRecord('cb')])
  })

  it('U11: 금고 행에는 F-508 쓰기 자리에서 기록이 생기지 않는다, 일반 행은 생긴다', async () => {
    const store = await freshStore()
    const vault = await store.create({ title: 'v', content: 'env', lineEnding: 'lf', e2eeKey: 'K'.repeat(56), attachmentRefs: [] })
    const plain = await store.create({ title: 'p', content: 'p', lineEnding: 'lf' })
    await store.update(vault.id, { content: 'env2', comments: [makeRecord('c1')] })
    await store.update(plain.id, { content: 'p2', comments: [makeRecord('c2')] })
    expect(await store.getCommentRecords!(vault.id)).toEqual([])
    expect(await store.getCommentRecords!(plain.id)).toEqual([makeRecord('c2')])
  })
})
