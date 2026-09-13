// IndexedDB 저장소 (specs/architecture.md 2장, specs/features/F-110.md 3.1)
// 이름에 제품명을 쓰지 않는다. 제품명이 바뀌어도 사용자 문서가 남아야 한다 (CLAUDE.md 불변조건)
import { openDB } from 'idb'

const DEFAULT_DB_NAME = 'md-docs'
const DB_VERSION = 1
const DOCS_STORE = 'docs'
const META_STORE = 'meta'

function applyPatch(existing, patch) {
  return {
    ...existing,
    ...('title' in patch ? { title: patch.title } : {}),
    ...('content' in patch ? { content: patch.content } : {}),
    updatedAt: Date.now(),
  }
}

/**
 * @param {string} [dbName] 기본값 `md-docs`. 테스트에서만 다른 이름을 넘겨 DB 를 격리한다
 * @returns {Promise<store>} architecture.md 2장 인터페이스, kind: 'idb'
 */
export async function createIdbStore(dbName = DEFAULT_DB_NAME) {
  const db = await openDB(dbName, DB_VERSION, {
    upgrade(database, _oldVersion, _newVersion, transaction) {
      if (!database.objectStoreNames.contains(DOCS_STORE)) {
        database.createObjectStore(DOCS_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'key' })
      }
      transaction.objectStore(META_STORE).put({ key: 'schema', version: DB_VERSION })
    },
  })

  return {
    kind: 'idb',

    async list() {
      const all = await db.getAll(DOCS_STORE)
      return all.sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async get(id) {
      const doc = await db.get(DOCS_STORE, id)
      return doc ?? null
    },

    async create({ title, content, lineEnding }) {
      const now = Date.now()
      const doc = {
        id: crypto.randomUUID(),
        title,
        content,
        lineEnding,
        createdAt: now,
        updatedAt: now,
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
      const updated = applyPatch(existing, patch)
      await store.put(updated)
      await tx.done
      return updated
    },

    async remove(id) {
      await db.delete(DOCS_STORE, id)
    },
  }
}
