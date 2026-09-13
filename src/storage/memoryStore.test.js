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
})
