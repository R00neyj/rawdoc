// idb·memory 저장소가 같이 지키는 로컬 휴지통 계약 (small 2026-10-16) — idbStore.test·memoryStore.test 가 부른다
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { CommentRecord } from '../../../src/lib/docComments'
import type { Store } from '../../../src/types'

function record(id: string): CommentRecord {
  return {
    id, parent: null, body: `본문 ${id}`, mentions: [], authorId: null, authorEmail: null, createdAt: 1,
    resolvedAt: null, resolvedById: null, resolvedBy: null, quote: 'q', prefix: '', suffix: '', anchorFrom: 0, anchorLength: 1,
  }
}

export function runLocalTrashContract(makeStore: () => Promise<Store>) {
  describe('로컬 휴지통 (small 2026-10-16)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('remove 는 휴지통으로 — list·get 에서 빠지고 listTrash 에 지운 때·폴더 경로와 함께, 댓글은 남는다', async () => {
      const store = await makeStore()
      const top = await store.createFolder({ name: '업무' })
      const sub = await store.createFolder({ name: '회의', parentId: top.id })
      const inSub = await store.create({ title: '회의 메모', content: '본문', lineEnding: 'lf', folderId: sub.id })
      const atRoot = await store.create({ title: '맨 위', content: '', lineEnding: 'lf' })
      const keep = await store.create({ title: '남김', content: '', lineEnding: 'lf' })
      await store.update(inSub.id, { comments: [record('c1')] })

      vi.spyOn(Date, 'now').mockReturnValue(5_000)
      await store.remove(inSub.id)
      await store.remove(atRoot.id)

      expect((await store.list()).map((d) => d.id)).toEqual([keep.id])
      expect(await store.get(inSub.id)).toBeNull()
      const trash = await store.listTrash!()
      const byId = new Map(trash.map((d) => [d.id, d]))
      expect(byId.get(inSub.id)).toMatchObject({ title: '회의 메모', content: '본문', folderId: sub.id, deletedAt: 5_000, deletedPath: '업무/회의' })
      expect(byId.get(atRoot.id)).toMatchObject({ folderId: null, deletedAt: 5_000, deletedPath: null })
      expect(await store.getCommentRecords!(inSub.id)).toEqual([record('c1')])
    })

    it('이미 휴지통인 문서를 다시 remove 해도 지운 때가 그대로', async () => {
      const store = await makeStore()
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'lf' })
      vi.spyOn(Date, 'now').mockReturnValue(1_000)
      await store.remove(doc.id)
      vi.spyOn(Date, 'now').mockReturnValue(9_000)
      await store.remove(doc.id)
      expect((await store.listTrash!())[0].deletedAt).toBe(1_000)
    })

    it('휴지통 문서는 update·moveDoc·setPinned 가 없는 문서처럼 reject', async () => {
      const store = await makeStore()
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'lf' })
      await store.remove(doc.id)
      await expect(store.update(doc.id, { content: 'x' })).rejects.toThrow()
      await expect(store.moveDoc(doc.id, null)).rejects.toThrow()
      await expect(store.setPinned(doc.id, true)).rejects.toThrow()
      expect((await store.listTrash!())[0].content).toBe('')
    })

    it('removeFolder delete-all 은 폴더를 지우고 안 문서는 각각 휴지통, 먼저 지운 문서의 기록은 그대로', async () => {
      const store = await makeStore()
      const top = await store.createFolder({ name: '위' })
      const sub = await store.createFolder({ name: '아래', parentId: top.id })
      const a = await store.create({ title: 'a', content: '', lineEnding: 'lf', folderId: top.id })
      const b = await store.create({ title: 'b', content: '', lineEnding: 'lf', folderId: sub.id })
      const earlier = await store.create({ title: 'e', content: '', lineEnding: 'lf', folderId: sub.id })
      const outside = await store.create({ title: 'o', content: '', lineEnding: 'lf' })
      await store.update(b.id, { comments: [record('cb')] })
      vi.spyOn(Date, 'now').mockReturnValue(1_000)
      await store.remove(earlier.id)
      vi.spyOn(Date, 'now').mockReturnValue(2_000)

      await store.removeFolder(top.id, 'delete-all')

      expect(await store.listFolders()).toEqual([])
      expect((await store.list()).map((d) => d.id)).toEqual([outside.id])
      const byId = new Map((await store.listTrash!()).map((d) => [d.id, d]))
      expect(byId.get(a.id)).toMatchObject({ deletedAt: 2_000, deletedPath: '위' })
      expect(byId.get(b.id)).toMatchObject({ deletedAt: 2_000, deletedPath: '위/아래' })
      expect(byId.get(earlier.id)).toMatchObject({ deletedAt: 1_000, deletedPath: '위/아래' })
      expect(await store.getCommentRecords!(b.id)).toEqual([record('cb')])
    })

    it('restoreTrash 는 원래 폴더로, updatedAt 그대로, 지운 표시는 행에서 없어진다', async () => {
      const store = await makeStore()
      const folder = await store.createFolder({ name: 'F' })
      const doc = await store.create({ title: 'A', content: '본문', lineEnding: 'lf', folderId: folder.id, updatedAt: 777 })
      await store.remove(doc.id)

      expect(await store.restoreTrash!(doc.id)).toEqual({ folderId: folder.id })
      const back = await store.get(doc.id)
      expect(back).toEqual(doc)
      expect(back && 'deletedAt' in back).toBe(false)
      expect(await store.listTrash!()).toEqual([])
      expect((await store.list()).map((d) => d.id)).toEqual([doc.id])
    })

    it('원래 폴더가 없으면 최상위로 복원한다', async () => {
      const store = await makeStore()
      const folder = await store.createFolder({ name: 'F' })
      const doc = await store.create({ title: 'A', content: '', lineEnding: 'lf', folderId: folder.id })
      await store.removeFolder(folder.id, 'delete-all')

      expect(await store.restoreTrash!(doc.id)).toEqual({ folderId: null })
      expect((await store.get(doc.id))?.folderId).toBeNull()
    })

    it('휴지통에 없는 id 는 restoreTrash null, purgeTrash 0 — 살아 있는 문서는 건드리지 않는다', async () => {
      const store = await makeStore()
      const live = await store.create({ title: 'A', content: '', lineEnding: 'lf' })
      expect(await store.restoreTrash!(live.id)).toBeNull()
      expect(await store.restoreTrash!('없는-id')).toBeNull()
      expect(await store.purgeTrash!([live.id, '없는-id'])).toBe(0)
      expect(await store.get(live.id)).not.toBeNull()
    })

    it('purgeTrash 는 휴지통 문서를 댓글까지 영구히 지우고 수를 돌려준다(비우기는 전부 넘긴다)', async () => {
      const store = await makeStore()
      const a = await store.create({ title: 'a', content: '', lineEnding: 'lf' })
      const b = await store.create({ title: 'b', content: '', lineEnding: 'lf' })
      const c = await store.create({ title: 'c', content: '', lineEnding: 'lf' })
      await store.update(a.id, { comments: [record('ca')] })
      await store.remove(a.id)
      await store.remove(b.id)
      await store.remove(c.id)

      expect(await store.purgeTrash!([a.id])).toBe(1)
      expect(await store.getCommentRecords!(a.id)).toEqual([])
      expect((await store.listTrash!()).map((d) => d.id).sort()).toEqual([b.id, c.id].sort())
      expect(await store.restoreTrash!(a.id)).toBeNull()

      expect(await store.purgeTrash!((await store.listTrash!()).map((d) => d.id))).toBe(2)
      expect(await store.listTrash!()).toEqual([])
      expect(await store.list()).toEqual([])
    })

    it('같은 id 로 create(가져오기) 하면 휴지통 행을 댓글까지 대신한다 — 살아 있는 id 는 그대로 던진다', async () => {
      const store = await makeStore()
      const doc = await store.create({ title: '옛', content: '옛 본문', lineEnding: 'lf', id: 'fixed' })
      await store.update(doc.id, { comments: [record('old')] })
      await expect(store.create({ title: 'x', content: '', lineEnding: 'lf', id: 'fixed' })).rejects.toThrow()
      await store.remove(doc.id)

      const imported = await store.create({ title: '새', content: '새 본문', lineEnding: 'lf', id: 'fixed' })
      expect(imported.title).toBe('새')
      expect(await store.listTrash!()).toEqual([])
      expect(await store.getCommentRecords!('fixed')).toEqual([])
      expect((await store.get('fixed'))?.content).toBe('새 본문')
    })
  })
}
