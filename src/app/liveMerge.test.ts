// 병합 알림 판정 — 끊긴 동안 내 편집·서버 쪽 본문 변경 (specs/features/F-306.md 7장, U11~U14)
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createMergeTracker } from './liveMerge'

const LOCAL = { local: true }
const LOAD = { load: true }
const PROVIDER = { provider: true }

function setup(initialUnsynced = false) {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, '본문')
  const changes: boolean[] = []
  const tracker = createMergeTracker(doc, {
    initialUnsynced,
    isLocalOrigin: (origin) => origin === LOCAL,
    isLoadOrigin: (origin) => origin === LOAD,
    onUnsyncedChange: (value) => changes.push(value),
  })
  const local = (text: string) => doc.transact(() => doc.getText('content').insert(0, text), LOCAL)
  const localTitle = (text: string) => doc.transact(() => doc.getText('title').insert(0, text), LOCAL)
  // 다른 Doc 에서 만든 변경을 provider origin 으로 넣는다 — 원격 쪽 본문 변경
  const remote = (name: 'content' | 'title', text: string, origin: unknown = PROVIDER) => {
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    other.getText(name).insert(0, text)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), origin)
  }
  return { doc, tracker, changes, local, localTitle, remote }
}

describe('F-306 U11 안 보낸 내 편집', () => {
  it('live 가 아닐 때 로컬 편집 → 참, onUnsyncedChange(true) 한 번', () => {
    const ctx = setup()
    expect(ctx.tracker.unsyncedLocal()).toBe(false)
    ctx.local('a')
    ctx.local('b')
    expect(ctx.tracker.unsyncedLocal()).toBe(true)
    expect(ctx.changes).toEqual([true])
  })

  it('live 인 동안의 로컬 편집은 표시하지 않고, live 가 되면 거짓', () => {
    const ctx = setup()
    ctx.local('a')
    ctx.tracker.setLive(true)
    expect(ctx.tracker.unsyncedLocal()).toBe(false)
    expect(ctx.changes).toEqual([true, false])
    ctx.local('b')
    expect(ctx.tracker.unsyncedLocal()).toBe(false)
    ctx.tracker.setLive(false)
    expect(ctx.tracker.unsyncedLocal()).toBe(false)
    expect(ctx.changes).toEqual([true, false])
  })
})

describe('F-306 U12 둘 다 → 알림', () => {
  it('로컬 편집 + 다른 origin 의 content 변경 → setLive(true) 가 true, 그 뒤 둘 다 거짓', () => {
    const ctx = setup()
    ctx.local('L')
    ctx.remote('content', 'R')
    expect(ctx.tracker.setLive(true)).toBe(true)
    expect(ctx.tracker.unsyncedLocal()).toBe(false)
    ctx.tracker.setLive(false)
    expect(ctx.tracker.setLive(true)).toBe(false)
  })
})

describe('F-306 U13 한쪽만이면 알리지 않는다', () => {
  it('로컬만', () => {
    const ctx = setup()
    ctx.local('L')
    expect(ctx.tracker.setLive(true)).toBe(false)
  })

  it('원격 content 만', () => {
    const ctx = setup()
    ctx.remote('content', 'R')
    expect(ctx.tracker.setLive(true)).toBe(false)
  })

  it('원격이 title 만 바꿈 + 로컬 편집', () => {
    const ctx = setup()
    ctx.local('L')
    ctx.remote('title', '새 제목')
    expect(ctx.tracker.setLive(true)).toBe(false)
  })

  it('불러오기 origin 의 content 변경은 원격으로 세지 않는다', () => {
    const ctx = setup()
    ctx.local('L')
    ctx.remote('content', 'R', LOAD)
    expect(ctx.tracker.setLive(true)).toBe(false)
  })

  it('로컬 제목 편집도 안 보낸 편집이다', () => {
    const ctx = setup()
    ctx.localTitle('T')
    expect(ctx.tracker.unsyncedLocal()).toBe(true)
  })

  it('live 인 동안의 원격 content 변경은 세지 않는다', () => {
    const ctx = setup()
    ctx.tracker.setLive(true)
    ctx.remote('content', 'R')
    ctx.tracker.setLive(false)
    ctx.local('L')
    expect(ctx.tracker.setLive(true)).toBe(false)
  })
})

describe('F-306 U14 이전 세션의 안 보낸 편집', () => {
  it('initialUnsynced + 원격 content 변경 → 첫 setLive(true) 가 true', () => {
    const ctx = setup(true)
    expect(ctx.tracker.unsyncedLocal()).toBe(true)
    ctx.remote('content', 'R')
    expect(ctx.tracker.setLive(true)).toBe(true)
    expect(ctx.changes).toEqual([false])
  })

  it('destroy 뒤에는 듣지 않는다', () => {
    const ctx = setup()
    ctx.tracker.destroy()
    ctx.local('L')
    expect(ctx.changes).toEqual([])
  })
})
