// IndexedDB 저장소 (specs/architecture.md 2장, specs/features/F-110.md 3.1, F-126.md 3장)
// 이름에 제품명을 쓰지 않는다. 제품명이 바뀌어도 사용자 문서가 남아야 한다 (CLAUDE.md 불변조건)
import { openDB } from 'idb'
import { canCreateFolder, canMoveFolder, descendantFolderIds } from '../lib/folderTree'
import type { Store, Doc, Folder, Attachment, AttachmentExt, FolderDeleteMode } from '../types'

const DEFAULT_DB_NAME = 'md-docs'
const DB_VERSION = 4
const DOCS_STORE = 'docs'
const META_STORE = 'meta'
const FOLDERS_STORE = 'folders'
const ATTACHMENTS_STORE = 'attachments' // F-156.md 2.3, 버전 3
const FILE_HANDLES_STORE = 'fileHandles' // F-231.md 2장, 버전 4 — docId ↔ FileSystemFileHandle

type StoredFileHandle = { docId: string; handle: FileSystemFileHandle }

// 저장소에 실제로 든 문서 모양 — 옛 스키마 문서는 folderId·pinnedAt 이 없을 수 있다
type StoredDoc = Omit<Doc, 'folderId' | 'pinnedAt'> & {
  folderId?: string | null
  pinnedAt?: number | null
}

// 소문자 16진수 16자 (crypto.getRandomValues 8바이트, F-156.md 2.1)
function randomAttachmentId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function applyPatch(existing: Doc, patch: { title?: string; content?: string }): Doc {
  return {
    ...existing,
    ...('title' in patch ? { title: patch.title as string } : {}),
    ...('content' in patch ? { content: patch.content as string } : {}),
    updatedAt: Date.now(),
  }
}

// folderId 가 없는 옛 문서(F-126 이전)는 null 로 취급한다. 읽을 때만 이렇게 채우고
// 저장소를 일괄 다시 쓰지 않는다 (F-126.md 3장)
function withFolderId(doc: StoredDoc): StoredDoc {
  if (!doc) return doc
  return doc.folderId === undefined ? { ...doc, folderId: null } : doc
}

// pinnedAt 이 없는 옛 문서(F-132 이전)는 null 로 취급한다. 같은 이유로 일괄 다시 쓰지
// 않는다 (F-132.md 2장)
function withPinnedAt(doc: StoredDoc): StoredDoc {
  if (!doc) return doc
  return doc.pinnedAt === undefined ? { ...doc, pinnedAt: null } : doc
}

function normalizeDoc(doc: StoredDoc): Doc {
  return withPinnedAt(withFolderId(doc)) as Doc
}

// folderId 가 null 이거나 존재하는 폴더를 가리키는 문자열이면 유효하다. 그 외(문자열이
// 아니거나 없는 폴더)는 무효 — create·moveDoc 이 이 검사를 통과 못 하면 아무것도 바꾸지
// 않고 오류를 던진다 (F-136.md 3.1·3.2)
function isValidFolderId(folders: Folder[], folderId: unknown): folderId is string | null {
  if (folderId === null) return true
  if (typeof folderId !== 'string') return false
  return folders.some((f) => f.id === folderId)
}

export type IdbStoreHandlers = {
  // 새 버전 창: 다른 창이 옛 버전 연결을 쥐고 있어 이 열기가 막혔을 때 (F-136.md 3.3)
  onBlocked?: (currentVersion: number, blockedVersion: number | null, event: IDBVersionChangeEvent) => void
  // 옛 버전 창: 새 버전이 열리려 해 연결을 닫기 전에 호출 — 저장 대기 중인 내용을 먼저 저장하는 데 쓴다
  onBlocking?: () => void | Promise<void>
  // 옛 버전 창: 위 정리가 끝나고 연결을 닫은 뒤 호출 (알림 표시용)
  onClosed?: () => void
}

// dbName 기본값 md-docs. 테스트에서만 다른 이름을 넘겨 DB 를 격리한다
export async function createIdbStore(
  dbName: string = DEFAULT_DB_NAME,
  { onBlocked, onBlocking, onClosed }: IdbStoreHandlers = {},
): Promise<Store> {
  const db = await openDB(dbName, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore(DOCS_STORE, { keyPath: 'id' })
        database.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      if (oldVersion < 2) {
        database.createObjectStore(FOLDERS_STORE, { keyPath: 'id' })
      }
      if (oldVersion < 3) {
        database.createObjectStore(ATTACHMENTS_STORE, { keyPath: 'id' })
      }
      if (oldVersion < 4) {
        database.createObjectStore(FILE_HANDLES_STORE, { keyPath: 'docId' })
      }
      transaction.objectStore(META_STORE).put({ key: 'schema', version: DB_VERSION })
    },
    blocked(currentVersion, blockedVersion, event) {
      onBlocked?.(currentVersion, blockedVersion, event)
    },
    // 이 연결이 새 버전 열기를 막고 있을 때 불린다. 정리(저장 시도)를 기다린 뒤 연결을
    // 닫고, 닫힌 뒤에 알림 표시용 콜백을 부른다 (F-136.md 3.3)
    blocking() {
      Promise.resolve()
        .then(() => onBlocking?.())
        .catch(() => {})
        .finally(() => {
          db.close()
          onClosed?.()
        })
    },
  })

  return {
    kind: 'idb',

    async list() {
      const all: StoredDoc[] = await db.getAll(DOCS_STORE)
      return all.map(normalizeDoc).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async get(id) {
      const doc: StoredDoc | undefined = await db.get(DOCS_STORE, id)
      return doc ? normalizeDoc(doc) : null
    },

    // id 가 이미 있으면 던진다(덮지 않는다). 가져오기(F-282)가 id·시각·고정을 유지할 때만 준다 (F-282.md 3.11)
    async create({ title, content, lineEnding, folderId = null, id, createdAt, updatedAt, pinnedAt }) {
      // folderId 가 null 또는 존재하는 폴더가 아니면 문서를 만들지 않는다 (F-136.md 3.1·3.2)
      const folders: Folder[] = await db.getAll(FOLDERS_STORE)
      if (!isValidFolderId(folders, folderId)) {
        throw new Error(`유효하지 않은 folderId: ${String(folderId)}`)
      }
      if (id !== undefined) {
        const existing = await db.get(DOCS_STORE, id)
        if (existing) throw new Error(`이미 있는 id: ${id}`)
      }
      const now = Date.now()
      const doc: Doc = {
        id: id ?? crypto.randomUUID(),
        title,
        content,
        lineEnding,
        createdAt: createdAt ?? now,
        updatedAt: updatedAt ?? now,
        folderId,
        pinnedAt: pinnedAt ?? null,
      }
      await db.put(DOCS_STORE, doc)
      return doc
    },

    // 한 트랜잭션 안에서 읽고 쓴다 (architecture.md 2장)
    async update(id, patch) {
      const tx = db.transaction(DOCS_STORE, 'readwrite')
      const store = tx.objectStore(DOCS_STORE)
      const existing: StoredDoc | undefined = await store.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = applyPatch(normalizeDoc(existing), patch)
      await store.put(updated)
      await tx.done
      return updated
    },

    // 연결된 fileHandles 항목도 함께 지운다 — 고아 방지 (F-231.md 3.1)
    async remove(id) {
      await db.delete(DOCS_STORE, id)
      await db.delete(FILE_HANDLES_STORE, id)
    },

    // moveDoc 은 folderId 만 바꾼다. updatedAt 은 바꾸지 않는다 — 편집이 아니므로 최근
    // 수정순을 흔들지 않는다 (F-126.md 3장)
    async moveDoc(id, folderId) {
      const resolvedFolderId = folderId ?? null
      const tx = db.transaction([DOCS_STORE, FOLDERS_STORE], 'readwrite')
      const docStore = tx.objectStore(DOCS_STORE)
      const folderStore = tx.objectStore(FOLDERS_STORE)
      const existing: StoredDoc | undefined = await docStore.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      // folderId 가 null 이 아니고 존재하는 폴더가 아니면 오류를 던지고 아무것도 바꾸지
      // 않는다 (F-136.md 3.2) — 다른 문서 위에 놓아 그 문서 id 가 folderId 로 들어오는
      // 경우 등을 저장소 수준에서도 막는다
      const folders: Folder[] = await folderStore.getAll()
      if (!isValidFolderId(folders, resolvedFolderId)) {
        await tx.done
        throw new Error(`유효하지 않은 folderId: ${resolvedFolderId}`)
      }
      const updated = { ...normalizeDoc(existing), folderId: resolvedFolderId }
      await docStore.put(updated)
      await tx.done
      return updated
    },

    // pinned 가 true 면 pinnedAt = 지금 시각, false 면 null. updatedAt 은 바꾸지 않는다
    // — 고정은 내용 수정이 아니다 (F-132.md 2장)
    async setPinned(id, pinned) {
      const tx = db.transaction(DOCS_STORE, 'readwrite')
      const store = tx.objectStore(DOCS_STORE)
      const existing: StoredDoc | undefined = await store.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = { ...normalizeDoc(existing), pinnedAt: pinned ? Date.now() : null }
      await store.put(updated)
      await tx.done
      return updated
    },

    async listFolders() {
      return db.getAll(FOLDERS_STORE)
    },

    // id 가 이미 있으면 던진다. 가져오기(F-282)가 id·시각을 유지할 때만 준다 (F-282.md 3.11)
    async createFolder({ name, parentId = null, id, createdAt, updatedAt }) {
      const folders: Folder[] = await db.getAll(FOLDERS_STORE)
      if (!canCreateFolder({ folders, parentId })) {
        throw new Error(`상위 폴더가 될 수 없음: ${parentId}`)
      }
      if (id !== undefined) {
        const existing = await db.get(FOLDERS_STORE, id)
        if (existing) throw new Error(`이미 있는 id: ${id}`)
      }
      const now = Date.now()
      const folder: Folder = {
        id: id ?? crypto.randomUUID(),
        name: name || '새 폴더',
        parentId,
        createdAt: createdAt ?? now,
        updatedAt: updatedAt ?? now,
      }
      await db.put(FOLDERS_STORE, folder)
      return folder
    },

    async renameFolder(id, name) {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite')
      const store = tx.objectStore(FOLDERS_STORE)
      const existing: Folder | undefined = await store.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const updated = { ...existing, name: name || '새 폴더', updatedAt: Date.now() }
      await store.put(updated)
      await tx.done
      return updated
    },

    // 자기 자신·자기 자손·없는 부모면 reject (F-2017.md 3.2)
    async moveFolder(id, parentId) {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite')
      const store = tx.objectStore(FOLDERS_STORE)
      const allFolders: Folder[] = await store.getAll()
      const existing = allFolders.find((f) => f.id === id)
      if (!existing) {
        await tx.done
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const resolvedParentId = parentId ?? null
      if (!canMoveFolder({ folders: allFolders, id, parentId: resolvedParentId })) {
        await tx.done
        throw new Error(`이동할 수 없음: ${id} → ${resolvedParentId}`)
      }
      const updated = { ...existing, parentId: resolvedParentId, updatedAt: Date.now() }
      await store.put(updated)
      await tx.done
      return updated
    },

    // move-up: 문서·하위 폴더를 부모로 옮기고 폴더만 삭제. delete-all: 하위 폴더·그 안 문서까지 삭제 (F-126.md 3장, F-242.md 3.1·3.2)
    async removeFolder(id, mode: FolderDeleteMode = 'move-up') {
      const tx = db.transaction([DOCS_STORE, FOLDERS_STORE], 'readwrite')
      const folderStore = tx.objectStore(FOLDERS_STORE)
      const docStore = tx.objectStore(DOCS_STORE)

      const existing: Folder | undefined = await folderStore.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }

      if (mode === 'delete-all') {
        const allFolders: Folder[] = await folderStore.getAll()
        const ids = new Set(descendantFolderIds(allFolders, id))

        const allDocs: StoredDoc[] = await docStore.getAll()
        await Promise.all(
          allDocs.filter((d) => d.folderId !== undefined && d.folderId !== null && ids.has(d.folderId)).map((d) => docStore.delete(d.id)),
        )
        await Promise.all([...ids].map((fid) => folderStore.delete(fid)))
        await tx.done
        return
      }

      const parentId = existing.parentId

      const allDocs: StoredDoc[] = await docStore.getAll()
      await Promise.all(
        allDocs
          .filter((d) => d.folderId === id)
          .map((d) => docStore.put({ ...normalizeDoc(d), folderId: parentId })),
      )

      const allFolders: Folder[] = await folderStore.getAll()
      await Promise.all(
        allFolders.filter((f) => f.parentId === id).map((f) => folderStore.put({ ...f, parentId })),
      )

      await folderStore.delete(id)
      await tx.done
    },

    // 첨부는 문서와 연결 필드가 없다 — id 만으로 찾는다. id 를 주면 그 id 로, 없으면 자동 채번(F-156.md 2.1·2.3). 이미 있는 id 면 덮지 않고 기존 것을 그대로 돌려준다 (F-282.md 3.11)
    async putAttachment({
      blob,
      mime,
      ext,
      width,
      height,
      id: givenId,
    }: {
      blob: Blob
      mime: string
      ext: AttachmentExt
      width: number
      height: number
      id?: string
    }) {
      if (givenId !== undefined) {
        const existing: Attachment | undefined = await db.get(ATTACHMENTS_STORE, givenId)
        if (existing) return { id: existing.id, ext: existing.ext }
        const record: Attachment = { id: givenId, mime, ext, size: blob.size, width, height, createdAt: Date.now(), blob }
        await db.put(ATTACHMENTS_STORE, record)
        return { id: givenId, ext }
      }
      let id = randomAttachmentId()
      while (await db.get(ATTACHMENTS_STORE, id)) {
        id = randomAttachmentId()
      }
      const record: Attachment = { id, mime, ext, size: blob.size, width, height, createdAt: Date.now(), blob }
      await db.put(ATTACHMENTS_STORE, record)
      return { id, ext }
    },

    async getAttachment(id) {
      const record: Attachment | undefined = await db.get(ATTACHMENTS_STORE, id)
      return record ?? null
    },

    async listAttachments() {
      const all: Attachment[] = await db.getAll(ATTACHMENTS_STORE)
      return all.map(({ id, ext, size, createdAt }) => ({ id, ext, size, createdAt }))
    },

    async removeAttachment(id) {
      await db.delete(ATTACHMENTS_STORE, id)
    },

    // 저장된 handle 을 돌며 isSameEntry 로 첫 매치를 찾는다 — 지워진 문서면 정리하고 계속, 예외면 건너뛴다 (F-231.md 3.1)
    async findDocByFileHandle(handle: FileSystemFileHandle) {
      const tx = db.transaction([FILE_HANDLES_STORE, DOCS_STORE], 'readwrite')
      const handleStore = tx.objectStore(FILE_HANDLES_STORE)
      const docStore = tx.objectStore(DOCS_STORE)
      let cursor = await handleStore.openCursor()
      let result: string | null = null
      while (cursor) {
        const stored = cursor.value as StoredFileHandle
        let same = false
        try {
          same = await stored.handle.isSameEntry(handle)
        } catch {
          same = false
        }
        if (same) {
          const doc = await docStore.get(stored.docId)
          if (!doc) {
            await cursor.delete()
          } else {
            result = stored.docId
            break
          }
        }
        cursor = await cursor.continue()
      }
      await tx.done
      return result
    },

    // upsert — 문서가 지워졌다 같은 파일로 다시 만들어진 경우를 덮어쓴다 (F-231.md 3.1)
    async linkFileHandle(docId: string, handle: FileSystemFileHandle) {
      const record: StoredFileHandle = { docId, handle }
      await db.put(FILE_HANDLES_STORE, record)
    },
  }
}
