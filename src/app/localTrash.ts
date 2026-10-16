// 로컬(idb·memory) 휴지통 — S-10 소스와 앱을 열 때의 30일 정리 (small 2026-10-16)
import { trashExpired, trashPurgeAt, type TrashItem } from '../lib/trash'
import type { Store, TrashedDoc } from '../types'
import type { TrashSource } from './trashApi'

type LocalTrashStore = Pick<Store, 'listTrash' | 'restoreTrash' | 'purgeTrash'>

// 금고 문서는 서버 휴지통처럼 제목을 비워 `금고 문서` 로 보인다. 지운 주체는 늘 이 브라우저라 싣지 않는다
function toTrashItem(doc: TrashedDoc): TrashItem {
  const item: TrashItem = { id: doc.id, title: doc.e2eeKey === undefined ? doc.title : '', deletedAt: doc.deletedAt, path: doc.deletedPath, purgeAt: trashPurgeAt(doc.deletedAt) }
  return doc.e2eeKey === undefined ? item : { ...item, e2ee: true }
}

async function listTrashed(store: LocalTrashStore): Promise<TrashedDoc[]> {
  if (!store.listTrash) throw new Error('local_trash_unavailable')
  return store.listTrash()
}

async function purge(store: LocalTrashStore, ids: string[]): Promise<number> {
  if (!store.purgeTrash) throw new Error('local_trash_unavailable')
  return store.purgeTrash(ids)
}

export function localTrashSource(store: LocalTrashStore): TrashSource {
  return {
    list: async () => (await listTrashed(store)).sort((a, b) => b.deletedAt - a.deletedAt).map(toTrashItem),
    restore: async (id) => {
      try {
        if (!store.restoreTrash) return { status: 'failed' }
        const restored = await store.restoreTrash(id)
        return restored ? { status: 'ok', folderId: restored.folderId } : { status: 'gone' }
      } catch {
        return { status: 'failed' }
      }
    },
    purge: async (id) => {
      try {
        return (await purge(store, [id])) > 0 ? 'ok' : 'gone'
      } catch {
        return 'failed'
      }
    },
    empty: async () => {
      try {
        const ids = (await listTrashed(store)).map((d) => d.id)
        return { status: 'ok', docs: await purge(store, ids) }
      } catch {
        return { status: 'failed' }
      }
    },
  }
}

// 앱을 열 때 한 번 — 서버 만료와 같은 경계로 지난 것만 영구 삭제하고 지운 수를 돌려준다
export async function purgeExpiredTrash(store: LocalTrashStore, now: number): Promise<number> {
  if (!store.listTrash) return 0
  const expired = (await store.listTrash()).filter((d) => trashExpired(d.deletedAt, now)).map((d) => d.id)
  return expired.length === 0 ? 0 : purge(store, expired)
}
