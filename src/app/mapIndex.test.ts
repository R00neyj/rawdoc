// specs/features/F-292.md 10장 A6
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryStore } from '../storage/memoryStore'
import { buildMapIndex, mapIndexScope, resetMapIndexCache } from './mapIndex'

describe('buildMapIndex — A6', () => {
  beforeEach(() => {
    resetMapIndexCache()
  })

  it('문서 하나를 고치면 그 하나만 다시 만든다', async () => {
    const store = createMemoryStore()
    const a = await store.create({ title: 'A', content: '[[B]]', lineEnding: 'lf' })
    const b = await store.create({ title: 'B', content: '', lineEnding: 'lf' })
    const scope = mapIndexScope('memory', null)

    const first = await buildMapIndex({ store, scope })
    expect(first.rebuiltCount).toBe(2)
    expect(first.reusedCount).toBe(0)

    await store.update(a.id, { content: '[[B]] [[C]]' })

    const second = await buildMapIndex({ store, scope })
    expect(second.rebuiltCount).toBe(1)
    expect(second.reusedCount).toBe(1)
    const entryA = second.entries.find((e) => e.id === a.id)
    expect(entryA?.targets).toEqual(['B', 'C'])
    void b
  })

  it('list() 에서 사라진 id 는 인덱스에서도 사라진다', async () => {
    const store = createMemoryStore()
    const a = await store.create({ title: 'A', content: '', lineEnding: 'lf' })
    const b = await store.create({ title: 'B', content: '', lineEnding: 'lf' })
    const scope = mapIndexScope('memory', null)

    await buildMapIndex({ store, scope })
    await store.remove(a.id)

    const second = await buildMapIndex({ store, scope })
    expect(second.entries.map((e) => e.id)).toEqual([b.id])
    // 다시 만들 때 남은 문서는 재사용된다
    expect(second.reusedCount).toBe(1)
  })

  it('저장소 표시(scope)가 다르면 통째로 버린다', async () => {
    const store = createMemoryStore()
    await store.create({ title: 'A', content: '', lineEnding: 'lf' })

    const first = await buildMapIndex({ store, scope: mapIndexScope('memory', null) })
    expect(first.rebuiltCount).toBe(1)

    const second = await buildMapIndex({ store, scope: mapIndexScope('server', 'a@b.com') })
    expect(second.rebuiltCount).toBe(1)
    expect(second.reusedCount).toBe(0)
  })

  it('U18 docs 를 주면 list() 를 안 부른다 (F-2007 5.2)', async () => {
    const store = createMemoryStore()
    const a = await store.create({ title: 'A', content: '[[B]]', lineEnding: 'lf' })
    let listCalls = 0
    const counting = {
      list: async () => {
        listCalls++
        return store.list()
      },
      listFolders: async () => store.listFolders(),
    }
    const scope = mapIndexScope('memory', null)
    const docs = await store.list()

    const result = await buildMapIndex({ store: counting, scope, docs })
    expect(listCalls).toBe(0)
    expect(result.entries.map((e) => e.id)).toEqual([a.id])

    await buildMapIndex({ store: counting, scope })
    expect(listCalls).toBe(1)
  })

  it('F-2018 U16 folderId 만 바뀐 문서는 targets 를 재사용하고 folderId 는 새 값', async () => {
    const store = createMemoryStore()
    const folder = await store.createFolder({ name: '교안', parentId: null })
    const a = await store.create({ title: 'A', content: '[[B]]', lineEnding: 'lf' })
    const scope = mapIndexScope('memory', null)

    const first = await buildMapIndex({ store, scope })
    expect(first.entries[0].folderId).toBeNull()

    await store.moveDoc(a.id, folder.id)
    const second = await buildMapIndex({ store, scope })
    expect(second.reusedCount).toBe(1)
    expect(second.entries[0].targets).toBe(first.entries[0].targets)
    expect(second.entries[0].folderId).toBe(folder.id)
  })
})
