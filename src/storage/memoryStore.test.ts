import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMemoryStore } from './memoryStore'
import type { Store } from '../types'

describe('memoryStore', () => {
  let store: Store

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
    expect(fromStore!.title).toBe('A')
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

  it('생성한 문서는 pinnedAt 이 null 이다', async () => {
    const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
    expect(doc.pinnedAt).toBeNull()
  })

  describe('상단 고정 (F-132)', () => {
    it('setPinned(id, true) 는 pinnedAt 을 지금 시각으로, updatedAt 은 그대로 둔다', async () => {
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      vi.spyOn(Date, 'now').mockReturnValue(doc.updatedAt + 1000)
      const pinned = await store.setPinned(doc.id, true)
      vi.restoreAllMocks()

      expect(pinned.pinnedAt).not.toBeNull()
      expect(pinned.updatedAt).toBe(doc.updatedAt)
    })

    it('setPinned(id, false) 는 pinnedAt 을 null 로 되돌린다', async () => {
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })
      await store.setPinned(doc.id, true)
      const unpinned = await store.setPinned(doc.id, false)
      expect(unpinned.pinnedAt).toBeNull()
    })

    it('없는 id 를 setPinned 하면 reject 한다', async () => {
      await expect(store.setPinned('없는-id', true)).rejects.toThrow()
    })
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

    it('하위 폴더 안에도 폴더를 만들 수 있다', async () => {
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const deeper = await store.createFolder({ name: '더 아래', parentId: sub.id })
      expect(deeper.parentId).toBe(sub.id)
    })

    it('3단계 이상 만들기·자식 있는 폴더 옮기기는 되고, 자기 손자 안으로는 reject (F-2017 U8)', async () => {
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

    it('moveFolder 로 다른 폴더를 하위 폴더 안으로 옮길 수 있다', async () => {
      const top = await store.createFolder({ name: '위', parentId: null })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const other = await store.createFolder({ name: '다른', parentId: null })
      expect((await store.moveFolder(other.id, sub.id)).parentId).toBe(sub.id)
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
      expect(folders.find((f) => f.id === sub.id)!.parentId).toBeNull()

      const updatedDoc = await store.get(doc.id)
      expect(updatedDoc!.folderId).toBeNull()
    })

    it('removeFolder(id, "move-up") 은 인자 없을 때와 같다', async () => {
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
      await expect(
        // 런타임 방어 검사를 테스트하려고 의도적으로 잘못된 타입을 넘긴다 (F-136.md 3.1)
        store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: { type: 'click' } as unknown as string }),
      ).rejects.toThrow()
      expect(await store.list()).toEqual([])
    })

    it('create 는 존재하지 않는 폴더 id 면 reject 하고 문서를 만들지 않는다', async () => {
      await expect(
        store.create({ title: 'A', content: '', lineEnding: 'crlf', folderId: '없는-폴더' }),
      ).rejects.toThrow()
      expect(await store.list()).toEqual([])
    })

    it('moveDoc 은 존재하지 않는 폴더 id 면 reject 하고 문서를 그대로 둔다(다른 문서 위에 놓는 경우 포함)', async () => {
      const other = await store.create({ title: 'B', content: '', lineEnding: 'crlf' })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'crlf' })

      // 다른 문서 행에 놓으면 그 문서 id 가 folderId 자리로 들어오는데, 문서 id 는 폴더가
      // 아니므로 거부해야 한다 (F-136.md 3.2)
      await expect(store.moveDoc(doc.id, other.id)).rejects.toThrow()

      const unchanged = await store.get(doc.id)
      expect(unchanged!.folderId).toBeNull()
    })
  })

  describe('첨부 이미지 (F-156)', () => {
    function blob(bytes = [1, 2, 3]) {
      return new Blob([new Uint8Array(bytes)])
    }

    it('putAttachment 은 16진수 16자 id 를 뽑고 getAttachment 으로 읽힌다', async () => {
      const { id, ext } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 10, height: 20 })
      expect(id).toMatch(/^[0-9a-f]{16}$/)
      expect(ext).toBe('png')

      const record = await store.getAttachment(id)
      expect(record!.mime).toBe('image/png')
      expect(record!.width).toBe(10)
      expect(record!.height).toBe(20)
      expect(record!.size).toBe(3)
      expect(record!.blob).toBeInstanceOf(Blob)
    })

    it('없는 id 는 null', async () => {
      expect(await store.getAttachment('없는-id')).toBeNull()
    })

    it('listAttachments 는 blob 을 뺀 메타만 돌려준다', async () => {
      const { id } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
      const list = await store.listAttachments()
      expect(list).toEqual([{ id, ext: 'png', size: 3, createdAt: expect.any(Number) }])
    })

    it('removeAttachment 으로 지운다', async () => {
      const { id } = await store.putAttachment({ blob: blob(), mime: 'image/png', ext: 'png', width: 1, height: 1 })
      await store.removeAttachment(id)
      expect(await store.getAttachment(id)).toBeNull()
    })
  })

  describe('가져오기 선택 필드 (F-282.md 3.11)', () => {
    it('create 에 id·createdAt·updatedAt·pinnedAt 을 주면 그대로 쓰고, 이미 있는 id 면 던진다', async () => {
      const doc = await store.create({ title: 'A', content: '내용', lineEnding: 'lf', id: 'fixed-id', createdAt: 111, updatedAt: 222, pinnedAt: 333 })
      expect(doc.id).toBe('fixed-id')
      expect(doc.createdAt).toBe(111)
      expect(doc.updatedAt).toBe(222)
      expect(doc.pinnedAt).toBe(333)

      await expect(store.create({ title: 'B', content: '', lineEnding: 'lf', id: 'fixed-id' })).rejects.toThrow()
    })

    it('createFolder 에 id·createdAt·updatedAt 을 주면 그대로 쓰고, 이미 있는 id 면 던진다', async () => {
      const folder = await store.createFolder({ name: 'A', id: 'fixed-folder', createdAt: 111, updatedAt: 222 })
      expect(folder.id).toBe('fixed-folder')
      expect(folder.createdAt).toBe(111)
      expect(folder.updatedAt).toBe(222)

      await expect(store.createFolder({ name: 'B', id: 'fixed-folder' })).rejects.toThrow()
    })

    it('putAttachment 에 id 를 주면 그 id 로 저장하고, 이미 있으면 덮지 않고 그대로 돌려준다', async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])])
      const first = await store.putAttachment({ blob, mime: 'image/png', ext: 'png', width: 1, height: 1, id: 'fixed-att' })
      expect(first.id).toBe('fixed-att')

      const dup = await store.putAttachment({ blob: new Blob([new Uint8Array([9, 9])]), mime: 'image/png', ext: 'png', width: 1, height: 1, id: 'fixed-att' })
      expect(dup).toEqual({ id: 'fixed-att', ext: 'png' })
      const record = await store.getAttachment('fixed-att')
      expect(record!.size).toBe(3)
    })
  })
})
