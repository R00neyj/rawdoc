// 서버 문서의 Yjs 기록 — IndexedDB `md-yjs`(제품명 쓰지 않음). 행 하나 = 업데이트 하나, 로그아웃해도 지우지 않는다 (specs/features/F-306.md 4장)
import { openDB, type IDBPDatabase } from 'idb'
import * as Y from 'yjs'

export const YJS_DB_NAME = 'md-yjs'
const DB_VERSION = 1
export const COMPACT_ROWS = 500
export const COMPACT_IDLE_MS = 2_000
export const RETAIN_MS = 30 * 24 * 60 * 60 * 1000
// 객체 상수라 다른 origin 과 우연히 같을 수 없다 — 병합 판정기가 불러오기를 원격으로 세지 않게 한다 (7.2)
export const YJS_LOAD_ORIGIN: object = { yjsStore: 'load' }

type YjsUpdateRow = { key?: number; userId: string; docId: string; update: Uint8Array }
type YjsMetaRow = { userId: string; docId: string; unsyncedLocal: boolean; lastOpenedAt: number }

export type YjsStore = {
  hasState(docId: string): Promise<boolean>
  attach(docId: string, doc: Y.Doc, options?: YjsAttachOptions): Promise<YjsAttachment>
  unsyncedDocIds(): Promise<string[]>
  removeDoc(docId: string): Promise<void>
  collectGarbage(now: number): Promise<void>
}

export type YjsAttachOptions = {
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export type YjsAttachment = {
  readonly loadedRows: number
  readonly unsyncedLocal: boolean
  readonly broken: boolean
  setUnsyncedLocal(value: boolean): void
  detach(): void
}

// 열기에 실패하면 null — 앱은 영속 없이 F-305 처럼 돈다 (4.5)
export async function openYjsStore(userId: string, dbName: string = YJS_DB_NAME): Promise<YjsStore | null> {
  let db: IDBPDatabase
  try {
    db = await openDB(dbName, DB_VERSION, {
      upgrade(upgradeDb) {
        const updates = upgradeDb.createObjectStore('updates', { keyPath: 'key', autoIncrement: true })
        updates.createIndex('byDoc', ['userId', 'docId'])
        const meta = upgradeDb.createObjectStore('meta', { keyPath: ['userId', 'docId'] })
        meta.createIndex('byUser', 'userId')
      },
    })
  } catch {
    return null
  }

  async function removeDoc(docId: string) {
    const tx = db.transaction(['updates', 'meta'], 'readwrite')
    const keys = await tx.objectStore('updates').index('byDoc').getAllKeys([userId, docId])
    await Promise.all([...keys.map((key) => tx.objectStore('updates').delete(key)), tx.objectStore('meta').delete([userId, docId]), tx.done])
  }

  return {
    async hasState(docId) {
      return (await db.countFromIndex('updates', 'byDoc', [userId, docId])) > 0
    },

    attach: (docId, doc, options = {}) => attachDoc(db, userId, docId, doc, options),

    async unsyncedDocIds() {
      const rows = (await db.getAllFromIndex('meta', 'byUser', userId)) as YjsMetaRow[]
      return rows.filter((row) => row.unsyncedLocal).map((row) => row.docId)
    },

    removeDoc,

    async collectGarbage(now) {
      const rows = (await db.getAllFromIndex('meta', 'byUser', userId)) as YjsMetaRow[]
      for (const row of rows) {
        if (!row.unsyncedLocal && now - row.lastOpenedAt > RETAIN_MS) await removeDoc(row.docId)
      }
    },
  }
}

async function attachDoc(
  db: IDBPDatabase,
  userId: string,
  docId: string,
  doc: Y.Doc,
  options: YjsAttachOptions,
): Promise<YjsAttachment> {
  const setTimer = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = options.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  const readTx = db.transaction(['updates', 'meta'], 'readwrite')
  const byDoc = readTx.objectStore('updates').index('byDoc')
  const [keys, rows, storedMeta] = await Promise.all([
    byDoc.getAllKeys([userId, docId]) as Promise<number[]>,
    byDoc.getAll([userId, docId]) as Promise<YjsUpdateRow[]>,
    readTx.objectStore('meta').get([userId, docId]) as Promise<YjsMetaRow | undefined>,
  ])
  const meta: YjsMetaRow = { userId, docId, unsyncedLocal: storedMeta?.unsyncedLocal ?? false, lastOpenedAt: Date.now() }
  await Promise.all([readTx.objectStore('meta').put(meta), readTx.done])

  // 행마다 applyUpdate 를 한 트랜잭션 안에서 — 합친 뒤 적용이 더 느렸다 (4.3, F-304 측정 b)
  if (rows.length > 0) {
    Y.transact(
      doc,
      () => {
        for (const row of rows) Y.applyUpdate(doc, row.update, YJS_LOAD_ORIGIN)
      },
      YJS_LOAD_ORIGIN,
    )
  }

  const known = new Set<number>(keys)
  let inflight = 0
  let broken = false
  let detached = false
  let compactTimer: unknown = null

  function fail(error: unknown) {
    if (broken) return
    broken = true
    stopListening()
    console.error('md-yjs 에 쓰지 못했습니다', error)
  }

  function stopListening() {
    doc.off('update', onUpdate)
    if (compactTimer !== null) clearTimer(compactTimer)
    compactTimer = null
  }

  // 아는 키가 500 이상이면 마지막 업데이트 뒤 2초 조용할 때 압축한다 — 업데이트마다 다시 센다 (4.4)
  function scheduleCompaction() {
    if (known.size + inflight < COMPACT_ROWS) return
    if (compactTimer !== null) clearTimer(compactTimer)
    compactTimer = setTimer(() => {
      compactTimer = null
      void compact()
    }, COMPACT_IDLE_MS)
  }

  async function compact() {
    if (broken || detached) return
    const state = Y.encodeStateAsUpdate(doc)
    const doomed = [...known]
    try {
      const tx = db.transaction('updates', 'readwrite')
      const store = tx.objectStore('updates')
      const [newKey] = await Promise.all([
        store.add({ userId, docId, update: state } satisfies YjsUpdateRow) as Promise<number>,
        ...doomed.map((key) => store.delete(key)),
        tx.done,
      ])
      for (const key of doomed) known.delete(key)
      known.add(newKey)
    } catch (error) {
      fail(error)
    }
  }

  function onUpdate(update: Uint8Array, origin: unknown) {
    if (origin === YJS_LOAD_ORIGIN || broken || detached) return
    inflight++
    scheduleCompaction()
    db.add('updates', { userId, docId, update } satisfies YjsUpdateRow).then(
      (key) => {
        inflight--
        known.add(key as number)
      },
      (error) => {
        inflight--
        fail(error)
      },
    )
  }

  doc.on('update', onUpdate)
  scheduleCompaction()

  return {
    loadedRows: rows.length,
    unsyncedLocal: meta.unsyncedLocal,
    get broken() {
      return broken
    },
    setUnsyncedLocal(value) {
      if (broken || detached || meta.unsyncedLocal === value) return
      meta.unsyncedLocal = value
      db.put('meta', { ...meta }).catch(fail)
    },
    detach() {
      if (detached) return
      detached = true
      stopListening()
    },
  }
}
