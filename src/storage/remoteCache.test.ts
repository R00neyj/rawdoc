// md-remote 에서 한 사용자의 행만 지우기 (specs/features/F-2038.md 7.1, C5)
// 다른 탭이 더 높은 버전을 열 때 (코드 리뷰 S8, idbStore 의 F-136.md 3.3 과 같은 규칙)
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { openDB } from 'idb'

import { createRemoteCache, deleteRemoteCacheUserRows } from './remoteCache'

const STORES = ['docs', 'folders', 'outbox', 'attachments'] as const

async function rowsByUser(dbName: string): Promise<Record<string, Record<string, number>>> {
  const db = await openDB(dbName)
  const out: Record<string, Record<string, number>> = {}
  for (const name of STORES) {
    const all = (await db.getAll(name)) as { userId: string }[]
    out[name] = {}
    for (const row of all) out[name][row.userId] = (out[name][row.userId] ?? 0) + 1
  }
  db.close()
  return out
}

describe('F-2038 C5 deleteRemoteCacheUserRows', () => {
  it('A·B 행을 네 스토어 모두에 넣고 A 를 지우면 A 행 0, B 행 그대로', async () => {
    const dbName = `test-md-remote-${Date.now()}`
    const cache = await createRemoteCache(dbName)
    for (const user of ['A', 'B']) {
      for (const id of ['d1', 'd2']) {
        await cache.putDoc(user, { id, title: id, content: '', lineEnding: 'lf', folderId: null, pinnedAt: null, createdAt: 1, updatedAt: 1, version: 1 })
      }
      await cache.putFolder(user, { id: 'f1', name: 'f', parentId: null, createdAt: 1, updatedAt: 1 })
      await cache.addOutbox(user, { type: 'removeDoc', docId: 'd1' })
      await cache.addOutbox(user, { type: 'removeDoc', docId: 'd2' })
      await cache.putAttachment(user, {
        id: 'a1',
        ext: 'png',
        mime: 'image/png',
        size: 1,
        width: 1,
        height: 1,
        blob: new Blob([new Uint8Array([1])]),
        uploaded: true,
        createdAt: 1,
      })
    }
    expect(await rowsByUser(dbName)).toEqual({
      docs: { A: 2, B: 2 },
      folders: { A: 1, B: 1 },
      outbox: { A: 2, B: 2 },
      attachments: { A: 1, B: 1 },
    })

    await deleteRemoteCacheUserRows('A', dbName)

    expect(await rowsByUser(dbName)).toEqual({
      docs: { B: 2 },
      folders: { B: 1 },
      outbox: { B: 2 },
      attachments: { B: 1 },
    })
    expect(await cache.countOutbox('B')).toBe(2)
  })
})

let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-md-remote-cache-${Date.now()}-${dbCounter}`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${ms}ms 안에 열리지 않음`)), ms)),
  ])
}

describe('리뷰 S8 versionchange — 옛 연결이 새 버전 열기를 막지 않는다', () => {
  it('더 높은 버전 열기가 오면 정리 콜백 → 연결 닫기 → 닫힘 콜백 순으로 돌고, 새 열기가 끝난다', async () => {
    const dbName = freshDbName()
    const order: string[] = []
    await createRemoteCache(dbName, {
      onBlocking: () => {
        order.push('blocking')
      },
      onClosed: () => {
        order.push('closed')
      },
    })

    const newer = await withTimeout(openDB(dbName, 99), 1_000)
    expect(order).toEqual(['blocking', 'closed'])
    newer.close()
  })

  it('콜백 없이 만들어도 닫는다', async () => {
    const dbName = freshDbName()
    await createRemoteCache(dbName)
    const newer = await withTimeout(openDB(dbName, 99), 1_000)
    newer.close()
  })

  it('새 버전 쪽: 옛 연결이 막고 있으면 onBlocked 가 불린다', async () => {
    const dbName = freshDbName()
    const old = await openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore('placeholder')
      },
    })
    let blockedCalls = 0
    const opening = createRemoteCache(dbName, {
      onBlocked: () => {
        blockedCalls += 1
        old.close()
      },
    })
    await withTimeout(opening, 1_000)
    expect(blockedCalls).toBe(1)
  })
})
