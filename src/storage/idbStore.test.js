import 'fake-indexeddb/auto'
import { describe, it, expect, vi } from 'vitest'
import { createIdbStore } from './idbStore.js'

// 테스트마다 새 DB 이름을 써서 격리한다 (fake-indexeddb 는 전역 indexedDB 를 공유)
let dbCounter = 0
function freshStore() {
  dbCounter += 1
  return createIdbStore(`test-md-docs-${Date.now()}-${dbCounter}`)
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
})
