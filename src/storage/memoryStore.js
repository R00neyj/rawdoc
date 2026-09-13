// 메모리 저장소 — 저장소를 못 쓸 때의 대체 (specs/architecture.md 2장, specs/features/F-126.md 3장)
// B1 은 IndexedDB 가 없으므로 이 저장소로만 동작한다 (F-110 이 idbStore 로 교체)
import { canCreateFolder, canMoveFolder } from '../lib/folderTree.js'

function clone(doc) {
  return { ...doc }
}

// folderId 가 없는 옛 문서(F-126 이전)는 null 로 취급한다
function withFolderId(doc) {
  if (!doc) return doc
  return doc.folderId === undefined ? { ...doc, folderId: null } : doc
}

/** @returns {import('../../specs/architecture.md') 2장 인터페이스를 따르는 저장소 인스턴스} */
export function createMemoryStore() {
  const docs = new Map()
  const folders = new Map()

  return {
    kind: 'memory',

    async list() {
      return [...docs.values()].map(withFolderId).sort((a, b) => b.updatedAt - a.updatedAt).map(clone)
    },

    async get(id) {
      const doc = docs.get(id)
      return doc ? clone(withFolderId(doc)) : null
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
      docs.set(doc.id, doc)
      return clone(doc)
    },

    async update(id, patch) {
      const existing = docs.get(id)
      if (!existing) {
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = {
        ...withFolderId(existing),
        ...('title' in patch ? { title: patch.title } : {}),
        ...('content' in patch ? { content: patch.content } : {}),
        updatedAt: Date.now(),
      }
      docs.set(id, updated)
      return clone(updated)
    },

    async remove(id) {
      docs.delete(id)
    },

    // moveDoc 은 folderId 만 바꾼다. updatedAt 은 바꾸지 않는다 (F-126.md 3장)
    async moveDoc(id, folderId) {
      const existing = docs.get(id)
      if (!existing) {
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = { ...withFolderId(existing), folderId: folderId ?? null }
      docs.set(id, updated)
      return clone(updated)
    },

    async listFolders() {
      return [...folders.values()].map(clone)
    },

    async createFolder({ name, parentId = null }) {
      const allFolders = [...folders.values()]
      if (!canCreateFolder({ folders: allFolders, parentId })) {
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
      folders.set(folder.id, folder)
      return clone(folder)
    },

    async renameFolder(id, name) {
      const existing = folders.get(id)
      if (!existing) {
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const updated = { ...existing, name: name || '새 폴더', updatedAt: Date.now() }
      folders.set(id, updated)
      return clone(updated)
    },

    // 결과 깊이가 2단계를 넘으면 reject (F-126.md 3장)
    async moveFolder(id, parentId) {
      const existing = folders.get(id)
      if (!existing) {
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const allFolders = [...folders.values()]
      const resolvedParentId = parentId ?? null
      if (!canMoveFolder({ folders: allFolders, id, parentId: resolvedParentId })) {
        throw new Error(`이동할 수 없음: ${id} → ${resolvedParentId}`)
      }
      const updated = { ...existing, parentId: resolvedParentId, updatedAt: Date.now() }
      folders.set(id, updated)
      return clone(updated)
    },

    // 안의 문서 folderId 와 하위 폴더 parentId 를 지운 폴더의 parentId 로 바꾸고 폴더 삭제
    // (F-126.md 3장)
    async removeFolder(id) {
      const existing = folders.get(id)
      if (!existing) {
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }
      const parentId = existing.parentId

      for (const doc of docs.values()) {
        const normalized = withFolderId(doc)
        if (normalized.folderId === id) {
          docs.set(doc.id, { ...normalized, folderId: parentId })
        }
      }

      for (const folder of folders.values()) {
        if (folder.parentId === id) {
          folders.set(folder.id, { ...folder, parentId })
        }
      }

      folders.delete(id)
    },
  }
}
