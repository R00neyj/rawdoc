// F-207 서버 저장소 캐시 — IndexedDB `md-remote`(제품명 쓰지 않음). 로그아웃해도 지우지 않는다 (2.1)
// 버전 2(F-209 2.5): 첨부 blob 캐시 스토어 추가
import { openDB, type IDBPDatabase } from 'idb'
import type { AttachmentExt, Doc, Folder, LineEnding } from '../types'

const DEFAULT_DB_NAME = 'md-remote'
const DB_VERSION = 2

export type CachedDoc = Doc & { userId: string; version: number }
export type CachedFolder = Folder & { userId: string }
export type CachedAttachment = {
  userId: string
  id: string
  ext: AttachmentExt
  mime: string
  size: number
  width: number
  height: number
  blob: Blob
  uploaded: boolean
  createdAt: number
}

export type OutboxItem =
  // createdAt·updatedAt·pinnedAt 는 로컬 이관(F-208 2.2)이 원본 시각을 유지할 때만 채운다
  | {
      type: 'createDoc'
      docId: string
      title: string
      content: string
      lineEnding: LineEnding
      folderId: string | null
      createdAt?: number
      updatedAt?: number
      pinnedAt?: number | null
    }
  | { type: 'updateDoc'; docId: string; patch: { title?: string; content?: string } }
  | { type: 'removeDoc'; docId: string }
  | { type: 'moveDoc'; docId: string; folderId: string | null }
  | { type: 'setPinned'; docId: string; pinned: boolean }
  | { type: 'createFolder'; folderId: string; name: string; parentId: string | null }
  | { type: 'renameFolder'; folderId: string; name: string }
  | { type: 'moveFolder'; folderId: string; parentId: string | null }
  | { type: 'removeFolder'; folderId: string }
  | { type: 'upload'; attachmentId: string; ext: AttachmentExt }

export type OutboxEntry = OutboxItem & { key: number; userId: string }

export function docIdOf(item: OutboxItem): string | undefined {
  return 'docId' in item ? item.docId : undefined
}

export function folderIdOf(item: OutboxItem): string | undefined {
  return 'folderId' in item && (item.type === 'createFolder' || item.type === 'renameFolder' || item.type === 'moveFolder' || item.type === 'removeFolder')
    ? item.folderId
    : undefined
}

export type RemoteCache = {
  getDocs(userId: string): Promise<CachedDoc[]>
  getDoc(userId: string, id: string): Promise<CachedDoc | null>
  putDoc(userId: string, doc: Omit<CachedDoc, 'userId'>): Promise<void>
  deleteDoc(userId: string, id: string): Promise<void>
  deleteDocsNotIn(userId: string, keepIds: Set<string>): Promise<void>
  getFolders(userId: string): Promise<CachedFolder[]>
  getFolder(userId: string, id: string): Promise<CachedFolder | null>
  putFolder(userId: string, folder: Omit<CachedFolder, 'userId'>): Promise<void>
  deleteFolder(userId: string, id: string): Promise<void>
  getOutbox(userId: string): Promise<OutboxEntry[]>
  addOutbox(userId: string, item: OutboxItem): Promise<number>
  putOutboxEntry(entry: OutboxEntry): Promise<void>
  removeOutbox(key: number): Promise<void>
  removeOutboxForDoc(userId: string, docId: string, exceptKey?: number | null): Promise<void>
  removeOutboxForFolder(userId: string, folderId: string, exceptKey?: number | null): Promise<void>
  countOutbox(userId: string): Promise<number>
  getAttachment(userId: string, id: string): Promise<CachedAttachment | null>
  putAttachment(userId: string, record: Omit<CachedAttachment, 'userId'>): Promise<void>
  markAttachmentUploaded(userId: string, id: string): Promise<void>
  listAttachments(userId: string): Promise<CachedAttachment[]>
  deleteAttachment(userId: string, id: string): Promise<void>
}

async function openCacheDb(dbName: string): Promise<IDBPDatabase> {
  return openDB(dbName, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const docs = db.createObjectStore('docs', { keyPath: ['userId', 'id'] })
        docs.createIndex('byUser', 'userId')
        const folders = db.createObjectStore('folders', { keyPath: ['userId', 'id'] })
        folders.createIndex('byUser', 'userId')
        const outbox = db.createObjectStore('outbox', { keyPath: 'key', autoIncrement: true })
        outbox.createIndex('byUser', 'userId')
      }
      if (oldVersion < 2) {
        const attachments = db.createObjectStore('attachments', { keyPath: ['userId', 'id'] })
        attachments.createIndex('byUser', 'userId')
      }
    },
  })
}

export async function createRemoteCache(dbName: string = DEFAULT_DB_NAME): Promise<RemoteCache> {
  const db = await openCacheDb(dbName)

  async function readOutbox(userId: string): Promise<OutboxEntry[]> {
    const all: OutboxEntry[] = await db.getAllFromIndex('outbox', 'byUser', userId)
    return all.sort((a, b) => a.key - b.key)
  }

  return {
    async getDocs(userId) {
      return db.getAllFromIndex('docs', 'byUser', userId)
    },

    async getDoc(userId, id) {
      const doc = await db.get('docs', [userId, id])
      return doc ?? null
    },

    async putDoc(userId, doc) {
      await db.put('docs', { ...doc, userId })
    },

    async deleteDoc(userId, id) {
      await db.delete('docs', [userId, id])
    },

    async deleteDocsNotIn(userId, keepIds) {
      const all: CachedDoc[] = await db.getAllFromIndex('docs', 'byUser', userId)
      await Promise.all(
        all.filter((d) => !keepIds.has(d.id)).map((d) => db.delete('docs', [userId, d.id])),
      )
    },

    async getFolders(userId) {
      return db.getAllFromIndex('folders', 'byUser', userId)
    },

    async getFolder(userId, id) {
      const folder = await db.get('folders', [userId, id])
      return folder ?? null
    },

    async putFolder(userId, folder) {
      await db.put('folders', { ...folder, userId })
    },

    async deleteFolder(userId, id) {
      await db.delete('folders', [userId, id])
    },

    async getOutbox(userId) {
      return readOutbox(userId)
    },

    async addOutbox(userId, item) {
      return db.add('outbox', { ...item, userId }) as Promise<number>
    },

    async putOutboxEntry(entry) {
      await db.put('outbox', entry)
    },

    async removeOutbox(key) {
      await db.delete('outbox', key)
    },

    async removeOutboxForDoc(userId, docId, exceptKey = null) {
      const all = await readOutbox(userId)
      await Promise.all(
        all
          .filter((e) => docIdOf(e) === docId && e.key !== exceptKey)
          .map((e) => db.delete('outbox', e.key)),
      )
    },

    async removeOutboxForFolder(userId, folderId, exceptKey = null) {
      const all = await readOutbox(userId)
      await Promise.all(
        all
          .filter((e) => folderIdOf(e) === folderId && e.key !== exceptKey)
          .map((e) => db.delete('outbox', e.key)),
      )
    },

    async countOutbox(userId) {
      const all = await db.getAllFromIndex('outbox', 'byUser', userId)
      return all.length
    },

    async getAttachment(userId, id) {
      const record = await db.get('attachments', [userId, id])
      return record ?? null
    },

    async putAttachment(userId, record) {
      await db.put('attachments', { ...record, userId })
    },

    async markAttachmentUploaded(userId, id) {
      const record = await db.get('attachments', [userId, id])
      if (record) await db.put('attachments', { ...record, uploaded: true })
    },

    async listAttachments(userId) {
      return db.getAllFromIndex('attachments', 'byUser', userId)
    },

    async deleteAttachment(userId, id) {
      await db.delete('attachments', [userId, id])
    },
  }
}
