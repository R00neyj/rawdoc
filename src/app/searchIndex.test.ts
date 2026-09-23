// specs/features/F-286.md 7장 A1~A28
import { beforeEach, describe, expect, it } from 'vitest'
import { createMemoryStore } from '../storage/memoryStore'
import type { Doc, Folder } from '../types'
import {
  buildSearchIndex,
  folderPathMap,
  makeIndexEntry,
  resetSearchIndexCache,
  searchIndexCacheSize,
  searchScope,
  type SearchSource,
} from './searchIndex'

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'd1',
    title: '제목',
    content: '본문',
    lineEnding: 'lf',
    createdAt: 1,
    updatedAt: 1,
    folderId: null,
    pinnedAt: null,
    ...overrides,
  }
}

function stubSource(docs: Doc[], folders: Folder[] = []): SearchSource {
  return {
    async list() {
      return docs
    },
    async listFolders() {
      return folders
    },
  }
}

const nfd = (s: string) => s.normalize('NFD')

beforeEach(() => {
  resetSearchIndexCache()
})

describe('makeIndexEntry — 문서 하나 (A2~A9)', () => {
  it('A2 프론트매터 떼기', () => {
    const doc = makeDoc({ content: '---\ntitle: 회의\ntag: 일기\n---\n본문 회고' })
    const entry = makeIndexEntry(doc, new Map())
    expect(entry.body.startsWith('본문 회고')).toBe(true)
    expect(entry.body).not.toContain('title:')
    expect(entry.body).not.toContain('---')
  })

  it('A3 프론트매터 없음', async () => {
    const doc = makeDoc({ content: '그냥 본문' })
    const entry = makeIndexEntry(doc, new Map())
    expect(entry.body).toBe('그냥 본문')
    expect(entry.properties).toBeNull()
    expect(entry.frontmatterUnreadable).toBe(false)

    const store = createMemoryStore()
    await store.create({ title: '문서', content: '그냥 본문', lineEnding: 'lf' })
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.frontmatterUnreadableCount).toBe(0)
  })

  it('A4 속성 파싱', () => {
    const content = "---\ntags:\n  - a\n  - b\ntime: 10:30\ntag: '일기'\n---\n본문"
    const doc = makeDoc({ content })
    const entry = makeIndexEntry(doc, new Map())
    expect(entry.properties).toEqual([
      { key: 'tags', value: ['a', 'b'] },
      { key: 'time', value: '10:30' },
      { key: 'tag', value: '일기' },
    ])
  })

  it('A5 속성 못 읽음', async () => {
    const doc = makeDoc({ content: '---\nauthor:\n  name: kim\n---\n본문' })
    const entry = makeIndexEntry(doc, new Map())
    expect(entry.properties).toBeNull()
    expect(entry.frontmatterUnreadable).toBe(true)
    expect(entry.body).toBe('본문')

    const store = createMemoryStore()
    await store.create({ title: '문서', content: '---\nauthor:\n  name: kim\n---\n본문', lineEnding: 'lf' })
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.frontmatterUnreadableCount).toBe(1)
  })

  it('A6 인라인 배열을 인덱스가 쪼개지 않는다', () => {
    const doc = makeDoc({ content: '---\ntags: [a, b]\n---\n본문' })
    const entry = makeIndexEntry(doc, new Map())
    expect(entry.properties).toEqual([{ key: 'tags', value: '[a, b]' }])
  })

  it('A7 NFC 정규화', () => {
    const title = nfd('한글 제목입니다')
    const bodyText = nfd('한글 본문입니다')
    const key = nfd('속성')
    const value = nfd('한글값')
    const content = `---\n${key}: ${value}\n---\n${bodyText}`
    const doc = makeDoc({ title, content })
    const entry = makeIndexEntry(doc, new Map())

    expect(entry.title).toBe(title.normalize('NFC'))
    expect(entry.body).toBe(bodyText.normalize('NFC'))
    expect(entry.properties![0].key).toBe(key.normalize('NFC'))
    expect(entry.properties![0].value).toBe(value.normalize('NFC'))
    expect(entry.title.length).toBeLessThan(title.length)
    expect(entry.body.length).toBeLessThan(bodyText.length)
  })

  it('A8 원문을 정규화해 저장하지 않는다', async () => {
    const store = createMemoryStore()
    const content = nfd('한글 프론트매터 없는 본문')
    const created = await store.create({ title: nfd('제목입니다'), content, lineEnding: 'lf' })
    await buildSearchIndex({ store, scope: searchScope('memory', null) })
    const stored = await store.get(created.id)
    expect(stored!.content).toBe(content)
  })

  it('A9 폴더 경로', () => {
    const top: Folder = { id: 'f1', name: '상위', parentId: null, createdAt: 0, updatedAt: 0 }
    const sub: Folder = { id: 'f2', name: '하위', parentId: 'f1', createdAt: 0, updatedAt: 0 }
    const paths = folderPathMap([top, sub])

    expect(makeIndexEntry(makeDoc({ folderId: 'f1' }), paths).folderPath).toBe('상위')
    expect(makeIndexEntry(makeDoc({ folderId: 'f2' }), paths).folderPath).toBe('상위 / 하위')
    expect(makeIndexEntry(makeDoc({ folderId: null }), paths).folderPath).toBe('')
    expect(makeIndexEntry(makeDoc({ folderId: '없는-폴더' }), paths).folderPath).toBe('')
  })
})

describe('공유받은 문서 (A10~A11)', () => {
  it('A10 공유받은 문서', async () => {
    const source = stubSource([
      makeDoc({ id: 'd1', role: 'view', title: nfd('제목1'), content: '본문내용1' }),
      makeDoc({ id: 'd2', role: 'edit', title: '제목2', content: '본문내용2' }),
    ])
    const idx = await buildSearchIndex({ store: source, scope: 'server:u1' })
    expect(idx.sharedCount).toBe(2)
    for (const entry of idx.entries) {
      expect(entry.shared).toBe(true)
      expect(entry.body).toBe('')
      expect(entry.properties).toBeNull()
    }
    expect(idx.entries.find((e) => e.id === 'd1')!.title).toBe(nfd('제목1').normalize('NFC'))
  })

  it('A11 로컬 문서를 공유로 보지 않는다', async () => {
    const store = createMemoryStore()
    await store.create({ title: 'a', content: '1', lineEnding: 'lf' })
    await store.create({ title: 'b', content: '2', lineEnding: 'lf' })
    await store.create({ title: 'c', content: '3', lineEnding: 'lf' })
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.entries.every((e) => e.shared === false)).toBe(true)
    expect(idx.sharedCount).toBe(0)
  })
})

describe('재사용 (A12~A24)', () => {
  it('A12 처음 만들기', async () => {
    const store = createMemoryStore()
    await store.create({ title: 'a', content: '1', lineEnding: 'lf' })
    await store.create({ title: 'b', content: '2', lineEnding: 'lf' })
    await store.create({ title: 'c', content: '3', lineEnding: 'lf' })
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.rebuiltCount).toBe(3)
    expect(idx.reusedCount).toBe(0)
    expect(searchIndexCacheSize()).toBe(3)
  })

  it('A13 재사용', async () => {
    const store = createMemoryStore()
    await store.create({ title: 'a', content: '1', lineEnding: 'lf' })
    await store.create({ title: 'b', content: '2', lineEnding: 'lf' })
    await store.create({ title: 'c', content: '3', lineEnding: 'lf' })
    const scope = searchScope('memory', null)
    await buildSearchIndex({ store, scope })
    const idx = await buildSearchIndex({ store, scope })
    expect(idx.rebuiltCount).toBe(0)
    expect(idx.reusedCount).toBe(3)
  })

  it('A14 바뀐 문서만', async () => {
    const store = createMemoryStore()
    const d1 = await store.create({ title: 'a', content: '1', lineEnding: 'lf' })
    await store.create({ title: 'b', content: '2', lineEnding: 'lf' })
    await store.create({ title: 'c', content: '3', lineEnding: 'lf' })
    const scope = searchScope('memory', null)
    await buildSearchIndex({ store, scope })
    await store.update(d1.id, { content: '새 내용' })
    const idx = await buildSearchIndex({ store, scope })
    expect(idx.rebuiltCount).toBe(1)
    expect(idx.reusedCount).toBe(2)
    expect(idx.entries.find((e) => e.id === d1.id)!.body).toBe('새 내용')
  })

  it('A15 제목만 바뀜', async () => {
    let docs = [makeDoc({ id: 'd1', updatedAt: 100, title: '제목1', content: '본문' })]
    const source: SearchSource = {
      async list() {
        return docs
      },
      async listFolders() {
        return []
      },
    }
    await buildSearchIndex({ store: source, scope: 's' })
    docs = [{ ...docs[0], title: '제목2' }]
    const idx = await buildSearchIndex({ store: source, scope: 's' })
    expect(idx.rebuiltCount).toBe(1)
  })

  it('A16 본문 길이만 바뀜', async () => {
    let docs = [makeDoc({ id: 'd1', updatedAt: 100, title: '제목', content: '본문' })]
    const source: SearchSource = {
      async list() {
        return docs
      },
      async listFolders() {
        return []
      },
    }
    await buildSearchIndex({ store: source, scope: 's' })
    docs = [{ ...docs[0], content: '본문본문' }]
    const idx = await buildSearchIndex({ store: source, scope: 's' })
    expect(idx.rebuiltCount).toBe(1)
  })

  it('A17 moveDoc — 다시 만들지 않지만 경로는 새 값', async () => {
    const store = createMemoryStore()
    const doc = await store.create({ title: 't', content: '본문', lineEnding: 'lf' })
    const folder = await store.createFolder({ name: '새폴더' })
    const scope = searchScope('memory', null)
    await buildSearchIndex({ store, scope })
    await store.moveDoc(doc.id, folder.id)
    const idx = await buildSearchIndex({ store, scope })
    expect(idx.rebuiltCount).toBe(0)
    const entry = idx.entries.find((e) => e.id === doc.id)!
    expect(entry.folderId).toBe(folder.id)
    expect(entry.folderPath).toBe('새폴더')
  })

  it('A18 앞서 돌려준 인덱스를 고치지 않는다', async () => {
    const store = createMemoryStore()
    const doc = await store.create({ title: 't', content: '본문', lineEnding: 'lf' })
    const folder = await store.createFolder({ name: '새폴더' })
    const scope = searchScope('memory', null)
    const before = await buildSearchIndex({ store, scope })
    await store.moveDoc(doc.id, folder.id)
    await buildSearchIndex({ store, scope })
    expect(before.entries.find((e) => e.id === doc.id)!.folderPath).toBe('')
  })

  it('A19 사라진 문서', async () => {
    const store = createMemoryStore()
    const doc = await store.create({ title: 't', content: '본문', lineEnding: 'lf' })
    const scope = searchScope('memory', null)
    await buildSearchIndex({ store, scope })
    await store.remove(doc.id)
    const idx = await buildSearchIndex({ store, scope })
    expect(idx.entries.find((e) => e.id === doc.id)).toBeUndefined()
    expect(searchIndexCacheSize()).toBe(0)
  })

  it('A20 범위가 바뀌면 통째로', async () => {
    const store = createMemoryStore()
    await store.create({ title: 'a', content: '1', lineEnding: 'lf' })
    await store.create({ title: 'b', content: '2', lineEnding: 'lf' })
    await buildSearchIndex({ store, scope: 'server:a' })
    const idx = await buildSearchIndex({ store, scope: 'server:b' })
    expect(idx.rebuiltCount).toBe(2)
    expect(idx.reusedCount).toBe(0)
  })

  it('A21 store 인스턴스가 바뀌면 통째로', async () => {
    const store1 = createMemoryStore()
    await store1.create({ id: 'd1', title: 't', content: 'c', lineEnding: 'lf', createdAt: 1000, updatedAt: 1000 })
    await buildSearchIndex({ store: store1, scope: 's' })
    const store2 = createMemoryStore()
    await store2.create({ id: 'd1', title: 't', content: 'c', lineEnding: 'lf', createdAt: 1000, updatedAt: 1000 })
    const idx = await buildSearchIndex({ store: store2, scope: 's' })
    expect(idx.rebuiltCount).toBe(1)
    expect(idx.reusedCount).toBe(0)
  })

  it('A22 resetSearchIndexCache', async () => {
    const store = createMemoryStore()
    await store.create({ title: 't', content: '본문', lineEnding: 'lf' })
    const scope = searchScope('memory', null)
    await buildSearchIndex({ store, scope })
    expect(searchIndexCacheSize()).toBe(1)
    resetSearchIndexCache()
    expect(searchIndexCacheSize()).toBe(0)
    const idx = await buildSearchIndex({ store, scope })
    expect(idx.rebuiltCount).toBe(1)
  })

  it('A23 list() 실패 — 예외가 올라오고 캐시는 그대로', async () => {
    let shouldFail = false
    const docs = [makeDoc({ id: 'd1' })]
    const source: SearchSource = {
      async list() {
        if (shouldFail) throw new Error('boom')
        return docs
      },
      async listFolders() {
        return []
      },
    }
    await buildSearchIndex({ store: source, scope: 's' })
    const before = searchIndexCacheSize()
    shouldFail = true
    await expect(buildSearchIndex({ store: source, scope: 's' })).rejects.toThrow('boom')
    expect(searchIndexCacheSize()).toBe(before)
  })

  it('A24 entries 순서', async () => {
    const store = createMemoryStore()
    const d1 = await store.create({ title: 'a', content: '1', lineEnding: 'lf', createdAt: 100, updatedAt: 100 })
    const d2 = await store.create({ title: 'b', content: '2', lineEnding: 'lf', createdAt: 300, updatedAt: 300 })
    const d3 = await store.create({ title: 'c', content: '3', lineEnding: 'lf', createdAt: 200, updatedAt: 200 })
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.entries.map((e) => e.id)).toEqual([d2.id, d3.id, d1.id])
  })
})

describe('A1·A25 기타', () => {
  it('A1 빈 저장소', async () => {
    const store = createMemoryStore()
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.entries).toEqual([])
    expect(idx.frontmatterUnreadableCount).toBe(0)
    expect(idx.sharedCount).toBe(0)
    expect(idx.rebuiltCount).toBe(0)
    expect(idx.reusedCount).toBe(0)
  })

  it('A25 searchScope', () => {
    expect(searchScope('server', 'u_1')).toBe('server:u_1')
    expect(searchScope('idb', null)).toBe('idb:local')
    expect(searchScope('memory', null)).toBe('memory:local')
  })
})

describe('U19 docs·folders 선택 인자 (F-2007 5.2)', () => {
  it('둘 다 주면 list()·listFolders() 를 안 부른다', async () => {
    let listCalls = 0
    let folderCalls = 0
    const docs = [makeDoc({ id: 'a' })]
    const folders: Folder[] = []
    const counting: SearchSource = {
      list: async () => {
        listCalls++
        return docs
      },
      listFolders: async () => {
        folderCalls++
        return folders
      },
    }
    const scope = searchScope('memory', null)
    const idx = await buildSearchIndex({ store: counting, scope, docs, folders })
    expect(listCalls).toBe(0)
    expect(folderCalls).toBe(0)
    expect(idx.entries.map((e) => e.id)).toEqual(['a'])
  })

  it('folders 만 주면 listFolders() 가 0회이고 list() 는 1회', async () => {
    let listCalls = 0
    let folderCalls = 0
    const counting: SearchSource = {
      list: async () => {
        listCalls++
        return [makeDoc({ id: 'a' })]
      },
      listFolders: async () => {
        folderCalls++
        return []
      },
    }
    const scope = searchScope('memory', null)
    await buildSearchIndex({ store: counting, scope, folders: [] })
    expect(listCalls).toBe(1)
    expect(folderCalls).toBe(0)
  })

  it('안 주면 기존과 동작이 같다', async () => {
    const store = stubSource([makeDoc({ id: 'a' })])
    const idx = await buildSearchIndex({ store, scope: searchScope('memory', null) })
    expect(idx.entries.map((e) => e.id)).toEqual(['a'])
  })
})
