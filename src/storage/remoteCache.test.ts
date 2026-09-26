// md-remote 에서 한 사용자의 행만 지우기 (specs/features/F-2038.md 7.1, C5)
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
