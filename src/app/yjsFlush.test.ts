// 열지 않은 문서의 밀린 편집 러너 (specs/features/F-306.md 8장, U22~U25)
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { openYjsStore } from '../storage/yjsStore'
import type { YjsStore } from '../storage/yjsStore'
import type { LiveDocController, LiveSnapshot } from './liveDoc'
import { FLUSH_SESSION_TIMEOUT_MS, flushUnsyncedDocs } from './yjsFlush'

let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-md-yjs-flush-${Date.now()}-${dbCounter}`
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

type Script = 'live' | 'deleted' | 'not-found' | 'forbidden' | 'revoked' | 'signed-out' | 'reconnecting' | 'hang'

const BASE: LiveSnapshot = {
  phase: 'connecting',
  everSynced: false,
  ready: false,
  fallbackReason: null,
  stopReason: null,
  tooLarge: false,
  disconnectedLong: false,
}

function snapshotFor(script: Script): LiveSnapshot | null {
  if (script === 'live') return { ...BASE, phase: 'live', everSynced: true, ready: true }
  if (script === 'reconnecting') return { ...BASE, phase: 'reconnecting', ready: true }
  if (script === 'hang') return null
  return { ...BASE, phase: 'stopped', ready: script !== 'forbidden', stopReason: script }
}

type FakeEntry = { docId: string; options: Record<string, unknown>; destroyed: boolean; openAtCreate: string[] }

function fakeControllers(scripts: Record<string, Script>) {
  const created: FakeEntry[] = []
  const create = (options: { docId: string; doc: Y.Doc }): LiveDocController => {
    const entry: FakeEntry = {
      docId: options.docId,
      options: options as unknown as Record<string, unknown>,
      destroyed: false,
      openAtCreate: created.filter((e) => !e.destroyed).map((e) => e.docId),
    }
    created.push(entry)
    let snap = BASE
    const listeners = new Set<(s: LiveSnapshot) => void>()
    return {
      start() {
        const next = snapshotFor(scripts[options.docId])
        if (!next) return
        queueMicrotask(() => {
          if (entry.destroyed) return
          snap = next
          listeners.forEach((listener) => listener(snap))
        })
      },
      snapshot: () => snap,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      wake() {},
      goOffline() {},
      destroy() {
        entry.destroyed = true
        listeners.clear()
      },
    }
  }
  return { created, create }
}

async function seedUnsynced(store: YjsStore, docId: string, text: string) {
  const doc = new Y.Doc()
  const attachment = await store.attach(docId, doc)
  doc.getText('content').insert(0, text)
  attachment.setUnsyncedLocal(true)
  await tick()
  attachment.detach()
}

async function setupStore() {
  const store = await openYjsStore('u1', freshDbName())
  if (!store) throw new Error('열기 실패')
  return store
}

describe('F-306 U22 결과 분류·한 번에 한 문서씩', () => {
  it('live·deleted·reconnecting → synced·gone·failed, gone 은 지워지고 제어기는 앞 것이 끝난 뒤 만들어진다', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', 'A')
    await seedUnsynced(store, 'b', 'B')
    await seedUnsynced(store, 'c', 'C')
    const clock = fakeClock()
    const fakes = fakeControllers({ a: 'live', b: 'deleted', c: 'reconnecting' })
    const result = await flushUnsyncedDocs({
      store,
      isOpenDoc: () => false,
      createController: fakes.create,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    expect([...result.entries()]).toEqual([
      ['a', 'synced'],
      ['b', 'gone'],
      ['c', 'failed'],
    ])
    expect(fakes.created.map((e) => e.docId)).toEqual(['a', 'b', 'c'])
    for (const entry of fakes.created) {
      expect(entry.openAtCreate).toEqual([])
      expect(entry.destroyed).toBe(true)
    }
    expect(await store.hasState('b')).toBe(false)
    expect(await store.hasState('c')).toBe(true)
    expect(await store.unsyncedDocIds()).toEqual(['c'])
    expect(clock.pending()).toBe(0)
  })

  it('forbidden·revoked 는 forbidden, 기록을 남긴다', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', 'A')
    await seedUnsynced(store, 'b', 'B')
    const clock = fakeClock()
    const fakes = fakeControllers({ a: 'forbidden', b: 'revoked' })
    const result = await flushUnsyncedDocs({
      store,
      isOpenDoc: () => false,
      createController: fakes.create,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    expect([...result.entries()]).toEqual([
      ['a', 'forbidden'],
      ['b', 'forbidden'],
    ])
    expect(await store.unsyncedDocIds()).toEqual(['a', 'b'])
  })
})

describe('F-306 U23 로그인 만료', () => {
  it('첫 문서가 signed-out 이면 나머지 제어기를 만들지 않는다', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', 'A')
    await seedUnsynced(store, 'b', 'B')
    const clock = fakeClock()
    const fakes = fakeControllers({ a: 'signed-out', b: 'live' })
    const result = await flushUnsyncedDocs({
      store,
      isOpenDoc: () => false,
      createController: fakes.create,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    expect([...result.entries()]).toEqual([['a', 'signed-out']])
    expect(fakes.created.map((e) => e.docId)).toEqual(['a'])
    expect(await store.unsyncedDocIds()).toEqual(['a', 'b'])
  })
})

describe('F-306 U24 열린 문서·시간 제한·제어기 옵션', () => {
  it('열린 문서는 건너뛴다', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', 'A')
    await seedUnsynced(store, 'b', 'B')
    const clock = fakeClock()
    const fakes = fakeControllers({ a: 'live', b: 'live' })
    const result = await flushUnsyncedDocs({
      store,
      isOpenDoc: (id) => id === 'a',
      createController: fakes.create,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    expect([...result.entries()]).toEqual([['b', 'synced']])
    expect(fakes.created.map((e) => e.docId)).toEqual(['b'])
  })

  it('30,000ms 안에 끝나지 않으면 failed, 제어기 destroy. 옵션은 resumable·keepaliveMs null', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', 'A')
    const clock = fakeClock()
    const fakes = fakeControllers({ a: 'hang' })
    const running = flushUnsyncedDocs({
      store,
      isOpenDoc: () => false,
      createController: fakes.create,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    for (let i = 0; i < 50 && fakes.created.length === 0; i++) await tick(1)
    expect(fakes.created).toHaveLength(1)
    expect(fakes.created[0].options).toMatchObject({ docId: 'a', resumable: true, startOffline: false, keepaliveMs: null })
    clock.advance(FLUSH_SESSION_TIMEOUT_MS - 1)
    await tick()
    expect(fakes.created[0].destroyed).toBe(false)
    clock.advance(1)
    const result = await running
    expect([...result.entries()]).toEqual([['a', 'failed']])
    expect(fakes.created[0].destroyed).toBe(true)
    expect(await store.unsyncedDocIds()).toEqual(['a'])
  })

  it('러너가 만든 Doc 에는 기록이 불러와져 있다', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', '밀린 편집')
    const clock = fakeClock()
    let seen = ''
    const fakes = fakeControllers({ a: 'live' })
    await flushUnsyncedDocs({
      store,
      isOpenDoc: () => false,
      createController: (options) => {
        seen = options.doc.getText('content').toString()
        return fakes.create(options)
      },
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    expect(seen).toBe('밀린 편집')
  })
})

describe('F-306 U25 synced 뒤 표시가 내려간다', () => {
  it('실제 yjsStore + 가짜 제어기: synced 뒤 meta.unsyncedLocal 이 거짓', async () => {
    const store = await setupStore()
    await seedUnsynced(store, 'a', 'A')
    expect(await store.unsyncedDocIds()).toEqual(['a'])
    const clock = fakeClock()
    const fakes = fakeControllers({ a: 'live' })
    await flushUnsyncedDocs({
      store,
      isOpenDoc: () => false,
      createController: fakes.create,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    })
    await tick()
    expect(await store.unsyncedDocIds()).toEqual([])
    const again = await store.attach('a', new Y.Doc())
    expect(again.unsyncedLocal).toBe(false)
    again.detach()
  })
})
