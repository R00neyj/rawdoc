// IndexedDB 저장소 (specs/architecture.md 2장, specs/features/F-110.md 3.1, F-126.md 3장)
// 이름에 제품명을 쓰지 않는다. 제품명이 바뀌어도 사용자 문서가 남아야 한다 (CLAUDE.md 불변조건)
import { openDB } from 'idb'
import { canCreateFolder, canMoveFolder } from '../lib/folderTree.js'

const DEFAULT_DB_NAME = 'md-docs'
const DB_VERSION = 2
const DOCS_STORE = 'docs'
const META_STORE = 'meta'
const FOLDERS_STORE = 'folders'

function applyPatch(existing, patch) {
  return {
    ...existing,
    ...('title' in patch ? { title: patch.title } : {}),
    ...('content' in patch ? { content: patch.content } : {}),
    updatedAt: Date.now(),
  }
}

// folderId 가 없는 옛 문서(F-126 이전)는 null 로 취급한다. 읽을 때만 이렇게 채우고
// 저장소를 일괄 다시 쓰지 않는다 (F-126.md 3장)
function withFolderId(doc) {
  if (!doc) return doc
  return doc.folderId === undefined ? { ...doc, folderId: null } : doc
}

/**
 * @param {string} [dbName] 기본값 `md-docs`. 테스트에서만 다른 이름을 넘겨 DB 를 격리한다
 * @returns {Promise<store>} architecture.md 2장 인터페이스, kind: 'idb'
 */
export async function createIdbStore(dbName = DEFAULT_DB_NAME) {
  const db = await openDB(dbName, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      if (oldVersion < 1) {
        database.createObjectStore(DOCS_STORE, { keyPath: 'id' })
        database.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      if (oldVersion < 2) {
        database.createObjectStore(FOLDERS_STORE, { keyPath: 'id' })
      }
      transaction.objectStore(META_STORE).put({ key: 'schema', version: DB_VERSION })
    },
  })

  return {
    kind: 'idb',

    async list() {
      const all = await db.getAll(DOCS_STORE)
      return all.map(withFolderId).sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async get(id) {
      const doc = await db.get(DOCS_STORE, id)
      return doc ? withFolderId(doc) : null
    },

    async create({ title, content, lineEnding, folderId = null }) {
      const now = Date.now()
      const doc = {
        id: crypto.randomUUID(),
        title,
        content,
        lineEnding,
        createdAt: now,
        updatedAt: now,
        folderId,
      }
      await db.put(DOCS_STORE, doc)
      return doc
    },

    // 한 트랜잭션 안에서 읽고 쓴다 (architecture.md 2장)
    async update(id, patch) {
      const tx = db.transaction(DOCS_STORE, 'readwrite')
      const store = tx.objectStore(DOCS_STORE)
      const existing = await store.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = applyPatch(withFolderId(existing), patch)
      await store.put(updated)
      await tx.done
      return updated
    },

    async remove(id) {
      await db.delete(DOCS_STORE, id)
    },

    // moveDoc 은 folderId 만 바꾼다. updatedAt 은 바꾸지 않는다 — 편집이 아니므로 최근
    // 수정순을 흔들지 않는다 (F-126.md 3장)
    async moveDoc(id, folderId) {
      const tx = db.transaction(DOCS_STORE, 'readwrite')
      const store = tx.objectStore(DOCS_STORE)
      const existing = await store.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = { ...withFolderId(existing), folderId: folderId ?? null }
      await store.put(updated)
      await tx.done
      return updated
    },

    async listFolders() {
      return db.getAll(FOLDERS_STORE)
    },

    async createFolder({ name, parentId = null }) {
      const folders = await db.getAll(FOLDERS_STORE)
      if (!canCreateFolder({ folders, parentId })) {
        throw new Error(`상위 폴더가 될 수 없음: ${parentId}`)
      }
      const now = Date.now()
      const folder = {
        id: crypto.randomUUID(),
        name: name || '새 폴더',
        parentId,
        createdAt: now,
        updatedAt: now,
      }
      await db.put(FOLDERS_STORE, folder)
      return folder
    },

    async renameFolder(id, name) {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite')
      const store = tx.objectStore(FOLDERS_STORE)
      const existing = await store.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const updated = { ...existing, name: name || '새 폴더', updatedAt: Date.now() }
      await store.put(updated)
      await tx.done
      return updated
    },

    // 결과 깊이가 2단계를 넘으면 reject (하위 폴더를 가진 폴더는 다른 폴더 안으로 못 감,
    // 자기 자신 안으로 못 감) (F-126.md 3장)
    async moveFolder(id, parentId) {
      const tx = db.transaction(FOLDERS_STORE, 'readwrite')
      const store = tx.objectStore(FOLDERS_STORE)
      const allFolders = await store.getAll()
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

    // 한 트랜잭션: 안의 문서 folderId 와 하위 폴더 parentId 를 지운 폴더의 parentId 로
    // 바꾸고 폴더 삭제. 문서는 지우지 않는다 (F-126.md 3장)
    async removeFolder(id) {
      const tx = db.transaction([DOCS_STORE, FOLDERS_STORE], 'readwrite')
      const folderStore = tx.objectStore(FOLDERS_STORE)
      const docStore = tx.objectStore(DOCS_STORE)

      const existing = await folderStore.get(id)
      if (!existing) {
        await tx.done
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const parentId = existing.parentId

      const allDocs = await docStore.getAll()
      await Promise.all(
        allDocs
          .filter((d) => d.folderId === id)
          .map((d) => docStore.put({ ...withFolderId(d), folderId: parentId })),
      )

      const allFolders = await folderStore.getAll()
      await Promise.all(
        allFolders.filter((f) => f.parentId === id).map((f) => folderStore.put({ ...f, parentId })),
      )

      await folderStore.delete(id)
      await tx.done
    },
  }
}
