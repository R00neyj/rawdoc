// 메모리 저장소 — 저장소를 못 쓸 때의 대체 (specs/architecture.md 2장, specs/features/F-126.md 3장)
// B1 은 IndexedDB 가 없으므로 이 저장소로만 동작한다 (F-110 이 idbStore 로 교체)
import { canCreateFolder, canMoveFolder, descendantFolderIds } from '../lib/folderTree'
import type { Store, Doc, Folder, Attachment, AttachmentExt, LineEnding, FolderDeleteMode } from '../types'

function clone<T extends object>(doc: T): T {
  return { ...doc }
}

// 저장소에 실제로 든 문서 모양 — 옛 스키마 문서는 folderId·pinnedAt 이 없을 수 있다
type StoredDoc = Omit<Doc, 'folderId' | 'pinnedAt'> & {
  folderId?: string | null
  pinnedAt?: number | null
}

// folderId 가 없는 옛 문서(F-126 이전)는 null 로 취급한다
function withFolderId(doc: StoredDoc): StoredDoc {
  if (!doc) return doc
  return doc.folderId === undefined ? { ...doc, folderId: null } : doc
}

// pinnedAt 이 없는 옛 문서(F-132 이전)는 null 로 취급한다
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

// 소문자 16진수 16자 (crypto.getRandomValues 8바이트, F-156.md 2.1) — idbStore.js 와 같은 규칙
function randomAttachmentId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createMemoryStore(): Store {
  const docs = new Map<string, Doc>()
  const folders = new Map<string, Folder>()
  const attachments = new Map<string, Attachment>() // F-156.md 2.3 — 새로고침하면 사라진다(메모리 저장소 특성 그대로)

  return {
    kind: 'memory',

    async list() {
      return [...docs.values()].map(normalizeDoc).sort((a, b) => b.updatedAt - a.updatedAt).map(clone)
    },

    async get(id) {
      const doc = docs.get(id)
      return doc ? clone(normalizeDoc(doc)) : null
    },

    async create({ title, content, lineEnding, folderId = null }: { title: string; content: string; lineEnding: LineEnding; folderId?: string | null }) {
      // folderId 가 null 또는 존재하는 폴더가 아니면 문서를 만들지 않는다 (F-136.md 3.1·3.2)
      if (!isValidFolderId([...folders.values()], folderId)) {
        throw new Error(`유효하지 않은 folderId: ${String(folderId)}`)
      }
      const now = Date.now()
      const doc: Doc = {
        id: crypto.randomUUID(),
        title,
        content,
        lineEnding,
        createdAt: now,
        updatedAt: now,
        folderId,
        pinnedAt: null,
      }
      docs.set(doc.id, doc)
      return clone(doc)
    },

    async update(id, patch) {
      const existing = docs.get(id)
      if (!existing) {
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated: Doc = {
        ...normalizeDoc(existing),
        ...('title' in patch ? { title: patch.title as string } : {}),
        ...('content' in patch ? { content: patch.content as string } : {}),
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
      // folderId 가 null 이 아니고 존재하는 폴더가 아니면 오류를 던지고 아무것도 바꾸지
      // 않는다 (F-136.md 3.2)
      const resolvedFolderId = folderId ?? null
      if (!isValidFolderId([...folders.values()], resolvedFolderId)) {
        throw new Error(`유효하지 않은 folderId: ${resolvedFolderId}`)
      }
      const updated = { ...normalizeDoc(existing), folderId: resolvedFolderId }
      docs.set(id, updated)
      return clone(updated)
    },

    // pinned 가 true 면 pinnedAt = 지금 시각, false 면 null. updatedAt 은 바꾸지 않는다
    // (F-132.md 2장)
    async setPinned(id, pinned) {
      const existing = docs.get(id)
      if (!existing) {
        throw new Error(`문서를 찾을 수 없음: ${id}`)
      }
      const updated = { ...normalizeDoc(existing), pinnedAt: pinned ? Date.now() : null }
      docs.set(id, updated)
      return clone(updated)
    },

    async listFolders() {
      return [...folders.values()].map(clone)
    },

    async createFolder({ name, parentId = null }: { name: string; parentId?: string | null }) {
      const allFolders = [...folders.values()]
      if (!canCreateFolder({ folders: allFolders, parentId })) {
        throw new Error(`상위 폴더가 될 수 없음: ${parentId}`)
      }
      const now = Date.now()
      const folder: Folder = {
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

    // move-up: 문서·하위 폴더를 부모로 옮기고 폴더만 삭제. delete-all: 하위 폴더·그 안 문서까지 삭제 (F-126.md 3장, F-242.md 3.1·3.2)
    async removeFolder(id, mode: FolderDeleteMode = 'move-up') {
      const existing = folders.get(id)
      if (!existing) {
        throw new Error(`폴더를 찾을 수 없음: ${id}`)
      }

      if (mode === 'delete-all') {
        const ids = new Set(descendantFolderIds([...folders.values()], id))
        for (const doc of docs.values()) {
          const normalized = normalizeDoc(doc)
          if (normalized.folderId && ids.has(normalized.folderId)) {
            docs.delete(doc.id)
          }
        }
        for (const fid of ids) folders.delete(fid)
        return
      }

      const parentId = existing.parentId

      for (const doc of docs.values()) {
        const normalized = normalizeDoc(doc)
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

    // F-156.md 2.3 — idbStore 와 같은 모양. 새로고침하면 사라진다
    async putAttachment({ blob, mime, ext, width, height }: { blob: Blob; mime: string; ext: AttachmentExt; width: number; height: number }) {
      let id = randomAttachmentId()
      while (attachments.has(id)) {
        id = randomAttachmentId()
      }
      const record: Attachment = { id, mime, ext, size: blob.size, width, height, createdAt: Date.now(), blob }
      attachments.set(id, record)
      return { id, ext }
    },

    async getAttachment(id) {
      const record = attachments.get(id)
      return record ? clone(record) : null
    },

    async listAttachments() {
      return [...attachments.values()].map(({ id, ext, size, createdAt }) => ({ id, ext, size, createdAt }))
    },

    async removeAttachment(id) {
      attachments.delete(id)
    },
  }
}
