import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecentFilesStore, RECENT_FILES_DB } from '../../../src/storage/recentFilesStore'

type FakeHandle = { kind: 'file'; name: string; key: string; isSameEntry: (o: { key?: string }) => Promise<boolean> }
const makeHandle = (key: string, name = `${key}.md`): FakeHandle => ({
  kind: 'file',
  name,
  key,
  isSameEntry: async (o) => o?.key === key,
})
const asHandle = (h: FakeHandle) => h as unknown as FileSystemFileHandle

let n = 0
const freshDb = () => `md-files-test-${++n}`

beforeEach(() => { vi.stubGlobal('structuredClone', (v: unknown) => v) })
afterEach(() => { vi.unstubAllGlobals() })

describe('F-2158 U2 recentFilesStore', () => {
  it('DB 이름은 md-files', () => {
    expect(RECENT_FILES_DB).toBe('md-files')
  })

  it('add 한 순서대로 최신이 위', async () => {
    const store = createRecentFilesStore(freshDb())
    await store.add(asHandle(makeHandle('a')), 'a.md', 1)
    const rows = await store.add(asHandle(makeHandle('b')), 'b.md', 2)
    expect(rows.map((r) => r.name)).toEqual(['b.md', 'a.md'])
    expect((await store.list()).map((r) => r.name)).toEqual(['b.md', 'a.md'])
  })

  it('같은 handle 두 번이면 1행, 맨 위로 올라가고 id 가 같다', async () => {
    const store = createRecentFilesStore(freshDb())
    const first = await store.add(asHandle(makeHandle('a')), 'a.md', 1)
    await store.add(asHandle(makeHandle('b')), 'b.md', 2)
    const rows = await store.add(asHandle(makeHandle('a')), 'a.md', 3)
    expect(rows.map((r) => r.name)).toEqual(['a.md', 'b.md'])
    expect(rows[0].id).toBe(first[0].id)
  })

  it('isSameEntry 가 던지면 다른 파일로 본다', async () => {
    const store = createRecentFilesStore(freshDb())
    const broken = { ...makeHandle('a'), isSameEntry: async () => { throw new Error('gone') } }
    await store.add(broken as unknown as FileSystemFileHandle, 'a.md', 1)
    const rows = await store.add(asHandle(makeHandle('a')), 'a.md', 2)
    expect(rows).toHaveLength(2)
  })

  it('11개를 넣으면 10행만 남고 가장 오래된 것이 빠진다', async () => {
    const store = createRecentFilesStore(freshDb())
    let rows = await store.list()
    for (let i = 0; i < 11; i++) rows = await store.add(asHandle(makeHandle(`k${i}`)), `k${i}.md`, i + 1)
    expect(rows).toHaveLength(10)
    expect(rows.map((r) => r.name)).not.toContain('k0.md')
    expect(rows[0].name).toBe('k10.md')
  })

  it('remove 는 그 행만 지우고 새로 연 저장소에서도 남는다', async () => {
    const db = freshDb()
    const store = createRecentFilesStore(db)
    await store.add(asHandle(makeHandle('a')), 'a.md', 1)
    const rows = await store.add(asHandle(makeHandle('b')), 'b.md', 2)
    const after = await store.remove(rows[0].id)
    expect(after.map((r) => r.name)).toEqual(['a.md'])
    expect((await createRecentFilesStore(db).list()).map((r) => r.name)).toEqual(['a.md'])
  })

  it('동시에 부른 add 가 모두 반영된다', async () => {
    const store = createRecentFilesStore(freshDb())
    await Promise.all([1, 2, 3].map((i) => store.add(asHandle(makeHandle(`p${i}`)), `p${i}.md`, i)))
    expect(await store.list()).toHaveLength(3)
  })
})
