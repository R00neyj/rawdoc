// IndexedDB md-yjs — 불러오기·append·압축·안 보낸 편집 표시·정리 (specs/features/F-306.md 4장, U1~U10)
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDB } from 'idb'
import * as Y from 'yjs'

import { COMPACT_IDLE_MS, COMPACT_ROWS, RETAIN_MS, YJS_DB_NAME, YJS_LOAD_ORIGIN, deleteYjsUserRows, openYjsStore } from './yjsStore'
import type { YjsStore } from './yjsStore'

let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-md-yjs-${Date.now()}-${dbCounter}`
}

async function tick(n = 20) {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function fakeClock() {
  let now = 0
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = ++seq
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(handle: unknown) {
      timers.delete(handle as number)
    },
    advance(ms: number) {
      const end = now + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null
        for (const entry of timers) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
        if (!next) break
        timers.delete(next[0])
        now = next[1].at
        next[1].fn()
      }
      now = end
    },
    pending: () => timers.size,
  }
}

type RawRow = { key: number; userId: string; docId: string; update: Uint8Array }
type RawMeta = { userId: string; docId: string; unsyncedLocal: boolean; lastOpenedAt: number }

async function rawRows(dbName: string, userId: string, docId: string): Promise<RawRow[]> {
  const db = await openDB(dbName)
  const all = (await db.getAll('updates')) as RawRow[]
  db.close()
  return all.filter((r) => r.userId === userId && r.docId === docId)
}

async function rawMeta(dbName: string, userId: string, docId: string): Promise<RawMeta | undefined> {
  const db = await openDB(dbName)
  const meta = (await db.get('meta', [userId, docId])) as RawMeta | undefined
  db.close()
  return meta
}

async function open(userId: string, dbName: string): Promise<YjsStore> {
  const store = await openYjsStore(userId, dbName)
  if (!store) throw new Error('열기 실패')
  return store
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('F-306 U1 스키마', () => {
  it('기본 DB 이름이 md-yjs 이고 스토어가 updates·meta 둘이다', async () => {
    expect(YJS_DB_NAME).toBe('md-yjs')
    const store = await openYjsStore('u1')
    expect(store).not.toBeNull()
    const names = (await indexedDB.databases()).map((d) => d.name)
    expect(names).toContain('md-yjs')
    const db = await openDB('md-yjs')
    expect([...db.objectStoreNames].sort()).toEqual(['meta', 'updates'])
    expect([...db.transaction('updates').store.indexNames]).toEqual(['byDoc'])
    expect([...db.transaction('meta').store.indexNames]).toEqual(['byUser'])
    db.close()
  })
})

describe('F-306 U2 붙이기·불러오기', () => {
  it('insert 3번 → 행 3개, 새 Doc 에 불러오면 본문이 같고 불러오기는 새 행을 쓰지 않는다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const doc = new Y.Doc()
    const first = await store.attach('d1', doc)
    expect(first.loadedRows).toBe(0)
    doc.getText('content').insert(0, 'a')
    doc.getText('content').insert(1, 'b')
    doc.getText('content').insert(2, 'c')
    await tick()
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(3)
    first.detach()

    const next = new Y.Doc()
    const origins: unknown[] = []
    next.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin))
    const second = await store.attach('d1', next)
    expect(second.loadedRows).toBe(3)
    expect(next.getText('content').toString()).toBe('abc')
    expect(origins).toEqual([YJS_LOAD_ORIGIN])
    await tick()
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(3)
    expect(await store.hasState('d1')).toBe(true)
    expect(await store.hasState('d2')).toBe(false)
    second.detach()
  })
})

describe('F-306 U3 사용자 구분', () => {
  it('다른 userId 의 저장소는 u1 의 행을 못 본다', async () => {
    const dbName = freshDbName()
    const u1 = await open('u1', dbName)
    const doc = new Y.Doc()
    const attachment = await u1.attach('d1', doc)
    doc.getText('content').insert(0, '내 글')
    await tick()
    attachment.detach()

    const u2 = await open('u2', dbName)
    expect(await u2.hasState('d1')).toBe(false)
    const other = new Y.Doc()
    const loaded = await u2.attach('d1', other)
    expect(loaded.loadedRows).toBe(0)
    expect(other.getText('content').toString()).toBe('')
    loaded.detach()
  })
})

describe('F-306 U4 압축 예약', () => {
  it('499개에서는 예약하지 않고 500개에서 예약, 업데이트마다 다시 센다, 조용히 2초면 행이 줄고 본문이 같다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const clock = fakeClock()
    const doc = new Y.Doc()
    const text = doc.getText('content')
    const attachment = await store.attach('d1', doc, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })
    for (let i = 0; i < COMPACT_ROWS - 1; i++) text.insert(text.length, 'x')
    await tick()
    expect(clock.pending()).toBe(0)
    text.insert(text.length, 'y')
    await tick()
    expect(clock.pending()).toBe(1)

    clock.advance(COMPACT_IDLE_MS - 1)
    text.insert(text.length, 'z')
    await tick()
    clock.advance(COMPACT_IDLE_MS - 1)
    await tick()
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(COMPACT_ROWS + 1)

    clock.advance(1)
    await tick(40)
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(1)

    text.insert(text.length, 'w')
    await tick()
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(2)
    attachment.detach()

    const next = new Y.Doc()
    const loaded = await store.attach('d1', next)
    expect(loaded.loadedRows).toBe(2)
    expect(next.getText('content').toString()).toBe(text.toString())
    loaded.detach()
  })
})

describe('F-306 U5 아는 키만 지운다', () => {
  it('다른 세션이 쓴 행은 압축해도 남고 두 Doc 의 편집이 모두 불러와진다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const clock = fakeClock()
    const docA = new Y.Doc()
    const a = await store.attach('d1', docA, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })
    const docB = new Y.Doc()
    const b = await store.attach('d1', docB)

    const textA = docA.getText('content')
    for (let i = 0; i < COMPACT_ROWS; i++) textA.insert(textA.length, 'a')
    docB.getText('content').insert(0, 'B1')
    docB.getText('content').insert(2, 'B2')
    await tick()
    const bKeys = (await rawRows(dbName, 'u1', 'd1')).slice(-2).map((r) => r.key)

    clock.advance(COMPACT_IDLE_MS)
    await tick(40)
    const left = await rawRows(dbName, 'u1', 'd1')
    expect(left).toHaveLength(3)
    for (const key of bKeys) expect(left.map((r) => r.key)).toContain(key)
    a.detach()
    b.detach()

    const next = new Y.Doc()
    const loaded = await store.attach('d1', next)
    const body = next.getText('content').toString()
    expect(body).toContain('B1B2')
    expect(body.replace('B1B2', '')).toBe('a'.repeat(COMPACT_ROWS))
    loaded.detach()
  })
})

describe('F-306 U6 불러온 직후 500개 이상', () => {
  it('조용히 2초 뒤 압축한다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const idle = fakeClock()
    const doc = new Y.Doc()
    const writer = await store.attach('d1', doc, { setTimeout: idle.setTimeout, clearTimeout: idle.clearTimeout })
    const text = doc.getText('content')
    for (let i = 0; i < COMPACT_ROWS; i++) text.insert(text.length, 'x')
    await tick()
    writer.detach()
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(COMPACT_ROWS)

    const clock = fakeClock()
    const next = new Y.Doc()
    const reader = await store.attach('d1', next, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout })
    expect(reader.loadedRows).toBe(COMPACT_ROWS)
    expect(clock.pending()).toBe(1)
    clock.advance(COMPACT_IDLE_MS)
    await tick(40)
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(1)
    reader.detach()
  })
})

describe('F-306 U7 안 보낸 편집 표시', () => {
  it('true 면 다시 붙일 때 true·unsyncedDocIds 에 있고, false 면 빠진다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const doc = new Y.Doc()
    const first = await store.attach('d1', doc)
    expect(first.unsyncedLocal).toBe(false)
    first.setUnsyncedLocal(true)
    await tick()
    first.detach()

    const second = await store.attach('d1', new Y.Doc())
    expect(second.unsyncedLocal).toBe(true)
    expect(await store.unsyncedDocIds()).toEqual(['d1'])
    second.setUnsyncedLocal(false)
    await tick()
    expect(await store.unsyncedDocIds()).toEqual([])
    second.detach()

    const other = await open('u2', dbName)
    expect(await other.unsyncedDocIds()).toEqual([])
  })
})

describe('F-306 U8 나이 정리', () => {
  it('30일 넘고 안 보낸 편집 없음 → 지움, 30일 안 → 남김, 안 보낸 편집 → 남김, 다른 사용자 → 남김', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const now = 10_000_000_000
    const db = await openDB(dbName)
    const rows: [string, string, boolean, number][] = [
      ['u1', 'old', false, now - RETAIN_MS - 1],
      ['u1', 'young', false, now - RETAIN_MS + 1],
      ['u1', 'unsent', true, now - RETAIN_MS - 1],
      ['u2', 'other', false, now - RETAIN_MS - 1],
    ]
    for (const [userId, docId, unsyncedLocal, lastOpenedAt] of rows) {
      await db.put('meta', { userId, docId, unsyncedLocal, lastOpenedAt })
      await db.add('updates', { userId, docId, update: new Uint8Array([0, 0]) })
    }
    db.close()

    await store.collectGarbage(now)
    expect(await rawRows(dbName, 'u1', 'old')).toHaveLength(0)
    expect(await rawMeta(dbName, 'u1', 'old')).toBeUndefined()
    expect(await rawRows(dbName, 'u1', 'young')).toHaveLength(1)
    expect(await rawRows(dbName, 'u1', 'unsent')).toHaveLength(1)
    expect(await rawRows(dbName, 'u2', 'other')).toHaveLength(1)
    expect(await rawMeta(dbName, 'u2', 'other')).toBeDefined()
  })
})

describe('F-306 U9 문서 지우기', () => {
  it('removeDoc 뒤 hasState 거짓, meta 없음', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const doc = new Y.Doc()
    const attachment = await store.attach('d1', doc)
    doc.getText('content').insert(0, '글')
    await tick()
    attachment.detach()
    expect(await store.hasState('d1')).toBe(true)
    await store.removeDoc('d1')
    expect(await store.hasState('d1')).toBe(false)
    expect(await rawMeta(dbName, 'u1', 'd1')).toBeUndefined()
  })
})

describe('F-306 U10 쓰기 실패·detach', () => {
  it('put 이 실패하면 broken, 그 뒤로는 쓰지 않는다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const doc = new Y.Doc()
    const attachment = await store.attach('d1', doc)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(() => {
      throw new DOMException('가득 참', 'QuotaExceededError')
    })
    doc.getText('content').insert(0, 'a')
    await tick()
    expect(attachment.broken).toBe(true)
    const calls = add.mock.calls.length
    doc.getText('content').insert(1, 'b')
    doc.getText('content').insert(2, 'c')
    await tick()
    expect(add.mock.calls.length).toBe(calls)
    expect(errors).toHaveBeenCalledTimes(1)
    attachment.detach()
  })

  it('detach 뒤에는 쓰지 않는다', async () => {
    const dbName = freshDbName()
    const store = await open('u1', dbName)
    const doc = new Y.Doc()
    const attachment = await store.attach('d1', doc)
    doc.getText('content').insert(0, 'a')
    await tick()
    attachment.detach()
    doc.getText('content').insert(1, 'b')
    await tick()
    expect(await rawRows(dbName, 'u1', 'd1')).toHaveLength(1)
    expect(attachment.broken).toBe(false)
  })
})

describe('F-2038 C6 한 사용자의 행만 지우기', () => {
  it('A·B 의 updates·meta 중 A 만 0, B 그대로', async () => {
    const dbName = freshDbName()
    for (const user of ['A', 'B']) {
      const store = await open(user, dbName)
      for (const docId of ['d1', 'd2']) {
        const doc = new Y.Doc()
        const attachment = await store.attach(docId, doc)
        doc.getText('content').insert(0, `${user}${docId}`)
        await tick()
        attachment.setUnsyncedLocal(true)
        await tick()
        attachment.detach()
      }
    }
    await deleteYjsUserRows('A', dbName)
    for (const docId of ['d1', 'd2']) {
      expect(await rawRows(dbName, 'A', docId)).toHaveLength(0)
      expect(await rawMeta(dbName, 'A', docId)).toBeUndefined()
      expect(await rawRows(dbName, 'B', docId)).toHaveLength(1)
      expect((await rawMeta(dbName, 'B', docId))?.unsyncedLocal).toBe(true)
    }
  })
})
