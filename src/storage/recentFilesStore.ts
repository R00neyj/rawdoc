// 최근 연 컴퓨터 파일 — IndexedDB `md-files`(제품명 쓰지 않음), 호출마다 열고 닫는다 (specs/features/F-2158.md 2장)
import { openDB, type IDBPDatabase } from 'idb'
import { planRecentAdd, sortRecentFiles, type RecentFileRow } from '../lib/file/recentFiles'

export const RECENT_FILES_DB = 'md-files'
const STORE = 'recent'

export type RecentFilesStore = {
  list(): Promise<RecentFileRow[]>
  add(handle: FileSystemFileHandle, name: string, now: number): Promise<RecentFileRow[]>
  remove(id: string): Promise<RecentFileRow[]>
}

function open(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, 1, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    },
  })
}

async function readAll(dbName: string): Promise<RecentFileRow[]> {
  const db = await open(dbName)
  try {
    return sortRecentFiles((await db.getAll(STORE)) as RecentFileRow[])
  } finally {
    db.close()
  }
}

async function isSame(a: FileSystemFileHandle, b: FileSystemFileHandle): Promise<boolean> {
  try {
    return await a.isSameEntry(b)
  } catch {
    return false
  }
}

export function createRecentFilesStore(dbName: string = RECENT_FILES_DB): RecentFilesStore {
  let tail: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn)
    tail = next.catch(() => {})
    return next
  }

  return {
    list: () => readAll(dbName),
    add: (handle, name, now) =>
      serial(async () => {
        const rows = await readAll(dbName)
        let sameId: string | null = null
        for (const row of rows) {
          if (await isSame(row.handle, handle)) { sameId = row.id; break }
        }
        const plan = planRecentAdd(rows, { handle, name, openedAt: now }, sameId, crypto.randomUUID())
        const db = await open(dbName)
        try {
          const tx = db.transaction(STORE, 'readwrite')
          await Promise.all([tx.store.put(plan.put), ...plan.remove.map((id) => tx.store.delete(id)), tx.done])
        } finally {
          db.close()
        }
        return readAll(dbName)
      }),
    remove: (id) =>
      serial(async () => {
        const db = await open(dbName)
        try {
          await db.delete(STORE, id)
        } finally {
          db.close()
        }
        return readAll(dbName)
      }),
  }
}
