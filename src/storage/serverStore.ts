// F-207 서버 저장소 — 캐시에 먼저 쓰고 즉시 resolve, 보낼 목록(outbox)을 순서대로 보낸다 (2.3)
// F-209 2.5: 첨부는 캐시에 blob 을 두고 서버로 올린다(변환은 toWebp)
import { createIdbStore } from './idbStore'
import { createRemoteCache, docIdOf, type CachedAttachment, type CachedDoc, type CachedFolder, type OutboxEntry, type OutboxItem, type RemoteCache } from './remoteCache'
import * as api from './docsApi'
import { ApiError, type ServerDoc } from './docsApi'
import { uploadAttachment, fetchAttachment, AttachmentApiError } from './attachmentsApi'
import { toWebp } from './toWebp'
import { extractAttachmentRefs } from '../lib/imageBlock'
import type { Attachment, AttachmentExt, Doc, Folder, LineEnding, Store, SyncState } from '../types'

const RETRY_INTERVAL_MS = 30000
const TOO_LARGE_MESSAGE = '문서가 너무 커서 서버에 저장하지 못했습니다(1MB 초과).'
const ATTACHMENT_UPLOAD_FAIL_MESSAGE = '이미지를 서버에 올리지 못했습니다.'
const ATTACHMENT_EXT_RE = '(png|jpg|gif|webp)'

type StoreNotice = { type: 'info' | 'error' | 'update' | 'warn'; message: string }

export type ServerStoreHandlers = {
  onConflict?: (event: { docId: string; copyId: string }) => void
  onNotice?: (notice: StoreNotice) => void
  // 편집 권한이 있어 저장을 대기하던 문서가 서버에서 403 을 받았다 — 앱이 읽기 전용으로 내린다 (F-212.md 2.4)
  onForbidden?: (docId: string) => void
  dbName?: string
}

// server 저장소에만 있는 로컬 이관(F-208 2.2) 진입점 — Store 표준 타입엔 없어 이 타입으로 좁혀 쓴다
export type ServerStore = Store & {
  importLocal(input: { folders: Folder[]; docs: Doc[] }): Promise<{ importedCount: number }>
}

// 폴더를 부모가 먼저 오도록 정렬한다 (2.2) — 순환 참조는 만들 수 없으므로 방어적으로만 끊는다
function sortFoldersParentFirst(folders: Folder[]): Folder[] {
  function depthOf(folder: Folder): number {
    let depth = 0
    let current: Folder | undefined = folder
    const seen = new Set<string>()
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id)
      current = folders.find((f) => f.id === current!.parentId)
      depth++
    }
    return depth
  }
  return [...folders].sort((a, b) => depthOf(a) - depthOf(b))
}

function toDoc(cached: Doc & { version: number; userId?: string }): Doc {
  const { userId: _userId, version: _version, ...doc } = cached
  return doc
}

function toFolder(cached: CachedFolder): Folder {
  const { userId: _userId, ...folder } = cached
  return folder
}

function sortByUpdatedAtDesc<T extends { updatedAt: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
}

let sharedLocalAttachmentStore: Promise<Store> | null = null
// 옮겨 온 로컬 첨부(F-208)를 읽어올 때만 쓰는 로컬 md-docs 첨부 스토어 (2.5)
function getLocalAttachmentStore(): Promise<Store> {
  if (!sharedLocalAttachmentStore) sharedLocalAttachmentStore = createIdbStore()
  return sharedLocalAttachmentStore
}

// 소문자 16진수 16자 (F-156 2.1 과 같은 형식)
function randomAttachmentId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function cachedToAttachment(record: CachedAttachment): Attachment {
  return { id: record.id, mime: record.mime, ext: record.ext, size: record.size, width: record.width, height: record.height, createdAt: record.createdAt, blob: record.blob }
}

// 캐시에 있는 문서 원문에서 이 id 의 확장자를 찾는다 — GET 은 원문 없이 id 만으로는 확장자를 모른다 (2.5)
// 어느 문서에서 찾았는지도 같이 준다 — 내 것이 아닌 첨부는 그 문서 id 를 ?doc= 로 붙여야 한다 (F-212.md 2.2)
function findExtInDocs(docs: CachedDoc[], id: string): { ext: AttachmentExt; docId: string } | null {
  const re = new RegExp(`attachments/${id}\\.${ATTACHMENT_EXT_RE}`)
  for (const doc of docs) {
    const m = re.exec(doc.content)
    if (m) return { ext: m[1] as AttachmentExt, docId: doc.id }
  }
  return null
}

async function decodeDims(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob)
    const { width, height } = bitmap
    bitmap.close?.()
    return { width, height }
  } catch {
    return { width: 0, height: 0 }
  }
}

export async function createServerStore(userId: string, handlers: ServerStoreHandlers = {}): Promise<ServerStore> {
  const cache: RemoteCache = await createRemoteCache(handlers.dbName)
  const listeners = new Set<(state: SyncState) => void>()
  let state: SyncState = { pending: 0, online: typeof navigator === 'undefined' ? true : navigator.onLine, signedOut: false }
  let sending = false
  let inFlightKey: number | null = null

  function notify() {
    for (const listener of listeners) listener(state)
  }

  function patchState(patch: Partial<SyncState>) {
    state = { ...state, ...patch }
    notify()
  }

  function notice(n: StoreNotice) {
    handlers.onNotice?.(n)
  }

  async function refreshPending() {
    const n = await cache.countOutbox(userId)
    if (n !== state.pending) patchState({ pending: n })
  }

  async function kickSend(): Promise<void> {
    if (sending) return
    sending = true
    try {
      for (;;) {
        const entries = await cache.getOutbox(userId)
        if (entries.length === 0) break
        const entry = entries[0]
        inFlightKey = entry.key
        const proceed = await sendOne(entry)
        inFlightKey = null
        if (!proceed) break
      }
    } finally {
      sending = false
      await refreshPending()
    }
  }

  async function handleConflict(entry: Extract<OutboxEntry, { type: 'updateDoc' }>, serverDoc: ServerDoc | undefined) {
    const myDoc = await cache.getDoc(userId, entry.docId)
    const now = Date.now()
    const copyId = crypto.randomUUID()
    const title = `${myDoc?.title ?? serverDoc?.title ?? ''} (충돌 사본)`
    const content = myDoc?.content ?? ''
    const lineEnding: LineEnding = myDoc?.lineEnding ?? serverDoc?.lineEnding ?? 'lf'
    const folderId = myDoc?.folderId ?? serverDoc?.folderId ?? null
    const copyDoc: Omit<CachedDoc, 'userId'> = {
      id: copyId,
      title,
      content,
      lineEnding,
      folderId,
      pinnedAt: null,
      createdAt: now,
      updatedAt: now,
      version: 0,
    }
    await cache.putDoc(userId, copyDoc)
    await cache.addOutbox(userId, { type: 'createDoc', docId: copyId, title, content, lineEnding, folderId })

    if (serverDoc) {
      await cache.putDoc(userId, { ...serverDoc, id: entry.docId })
    }

    handlers.onConflict?.({ docId: entry.docId, copyId })
  }

  // true 면 계속 보낸다. false 면 이 회차 보내기를 멈춘다(네트워크·5xx·401) (2.3)
  async function sendOne(entry: OutboxEntry): Promise<boolean> {
    try {
      switch (entry.type) {
        case 'createDoc': {
          const created = await api.createDoc({
            id: entry.docId,
            title: entry.title,
            content: entry.content,
            lineEnding: entry.lineEnding,
            folderId: entry.folderId,
            // 로컬 이관(F-208 2.2)이 넣은 값만 있다 — 보통 생성은 이 필드들이 없다
            ...(entry.createdAt !== undefined ? { createdAt: entry.createdAt } : {}),
            ...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {}),
            ...(entry.pinnedAt !== undefined ? { pinnedAt: entry.pinnedAt } : {}),
          })
          await cache.putDoc(userId, created)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'updateDoc': {
          const cachedDoc = await cache.getDoc(userId, entry.docId)
          const baseVersion = cachedDoc?.version ?? 0
          const updated = await api.updateDoc(entry.docId, { ...entry.patch, baseVersion })
          await cache.putDoc(userId, updated)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'moveDoc': {
          const updated = await api.moveDocFolder(entry.docId, entry.folderId)
          await cache.putDoc(userId, updated)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'setPinned': {
          const updated = await api.setPinned(entry.docId, entry.pinned)
          await cache.putDoc(userId, updated)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'removeDoc': {
          await api.removeDoc(entry.docId)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'createFolder': {
          const created = await api.createFolder({ id: entry.folderId, name: entry.name, parentId: entry.parentId })
          await cache.putFolder(userId, created)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'renameFolder': {
          const updated = await api.updateFolder(entry.folderId, { name: entry.name })
          await cache.putFolder(userId, updated)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'moveFolder': {
          const updated = await api.updateFolder(entry.folderId, { parentId: entry.parentId })
          await cache.putFolder(userId, updated)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'removeFolder': {
          await api.removeFolder(entry.folderId)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'upload': {
          const cachedAttachment = await cache.getAttachment(userId, entry.attachmentId)
          if (!cachedAttachment) {
            await cache.removeOutbox(entry.key)
            break
          }
          await uploadAttachment(entry.attachmentId, entry.ext, cachedAttachment.blob)
          await cache.markAttachmentUploaded(userId, entry.attachmentId)
          await cache.removeOutbox(entry.key)
          break
        }
        default:
          break
      }
      // 여기 도달했다는 건 fetch 가 응답을 줬다는 뜻이다 — 온라인
      patchState({ online: true })
      return true
    } catch (err) {
      if (err instanceof AttachmentApiError) {
        if (err.kind === 'network') {
          patchState({ online: false })
          return false
        }
        patchState({ online: true })
        if (err.kind === 'unauthorized') {
          patchState({ signedOut: true })
          return false
        }
        if (err.kind === 'too_large' || err.kind === 'unsupported' || err.kind === 'type_mismatch') {
          await cache.removeOutbox(entry.key)
          notice({ type: 'error', message: ATTACHMENT_UPLOAD_FAIL_MESSAGE })
          return true
        }
        // server_error·other — 재시도해도 될 수 있으니 이번 회차는 멈춘다
        return false
      }
      if (!(err instanceof ApiError)) throw err

      if (err.kind === 'network') {
        patchState({ online: false })
        return false
      }
      // network 가 아닌 모든 오류는 서버가 실제로 응답한 것이다 — 온라인
      patchState({ online: true })
      if (err.kind === 'server_error') {
        return false
      }
      if (err.kind === 'unauthorized') {
        patchState({ signedOut: true })
        return false
      }
      if (err.kind === 'too_large') {
        await cache.removeOutbox(entry.key)
        notice({ type: 'error', message: TOO_LARGE_MESSAGE })
        return true
      }
      if (err.kind === 'not_found') {
        const docId = docIdOf(entry)
        if (docId) {
          await cache.deleteDoc(userId, docId)
          await cache.removeOutboxForDoc(userId, docId)
        } else if (entry.type === 'createFolder' || entry.type === 'renameFolder' || entry.type === 'moveFolder' || entry.type === 'removeFolder') {
          await cache.deleteFolder(userId, entry.folderId)
          await cache.removeOutboxForFolder(userId, entry.folderId)
        } else {
          await cache.removeOutbox(entry.key)
        }
        return true
      }
      if (err.kind === 'conflict' && entry.type === 'updateDoc') {
        await handleConflict(entry, err.doc)
        await cache.removeOutbox(entry.key)
        return true
      }
      if (err.kind === 'forbidden' && entry.type === 'updateDoc') {
        // 편집 권한이 사라졌다 — 이 문서로 대기 중인 나머지 편집 요청도 함께 버린다 (F-212.md 2.4)
        await cache.removeOutboxForDoc(userId, entry.docId, entry.key)
        await cache.removeOutbox(entry.key)
        handlers.onForbidden?.(entry.docId)
        notice({ type: 'error', message: '이 문서를 편집할 권한이 없어졌습니다.' })
        return true
      }
      // id_taken·invalid·other — 재시도해도 성공하지 못하므로 버리고 계속 진행한다
      await cache.removeOutbox(entry.key)
      notice({ type: 'error', message: '동기화하지 못했습니다.' })
      return true
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      patchState({ online: true })
      kickSend()
    })
    window.addEventListener('offline', () => {
      patchState({ online: false })
    })
    setInterval(() => {
      kickSend()
    }, RETRY_INTERVAL_MS)
  }

  // 옮겨 온 로컬 첨부(F-208): 캐시 문서가 참조하는 첨부 중 서버 캐시에 없고 로컬에 있는 것을 변환 없이 그대로 캐시에 복사 + 올리기 (2.5)
  async function migrateLocalAttachments() {
    const docs = await cache.getDocs(userId)
    const referenced = new Set<string>()
    for (const doc of docs) for (const id of extractAttachmentRefs(doc.content)) referenced.add(id)
    if (referenced.size === 0) return

    const local = await getLocalAttachmentStore()
    let migrated = false
    for (const id of referenced) {
      const existing = await cache.getAttachment(userId, id)
      if (existing) continue
      const localAttachment = await local.getAttachment(id)
      if (!localAttachment) continue
      await cache.putAttachment(userId, {
        id: localAttachment.id,
        ext: localAttachment.ext,
        mime: localAttachment.mime,
        size: localAttachment.size,
        width: localAttachment.width,
        height: localAttachment.height,
        blob: localAttachment.blob,
        uploaded: false,
        createdAt: localAttachment.createdAt,
      })
      await cache.addOutbox(userId, { type: 'upload', attachmentId: localAttachment.id, ext: localAttachment.ext })
      migrated = true
    }
    if (migrated) {
      await refreshPending()
      kickSend()
    }
  }

  refreshPending()
  kickSend()
  migrateLocalAttachments()

  async function enqueueUpdateDoc(docId: string, patch: { title?: string; content?: string }) {
    const entries = await cache.getOutbox(userId)
    const existing = entries.find((e): e is OutboxEntry & { type: 'updateDoc' } => e.type === 'updateDoc' && e.docId === docId && e.key !== inFlightKey)
    if (existing) {
      await cache.putOutboxEntry({ ...existing, patch: { ...existing.patch, ...patch } })
    } else {
      await cache.addOutbox(userId, { type: 'updateDoc', docId, patch })
    }
    await refreshPending()
    kickSend()
  }

  async function enqueueCoalesced(item: OutboxItem, matchesExisting: (e: OutboxEntry) => boolean) {
    const entries = await cache.getOutbox(userId)
    const existing = entries.find((e) => e.type === item.type && matchesExisting(e) && e.key !== inFlightKey)
    if (existing) {
      await cache.putOutboxEntry({ ...existing, ...item })
    } else {
      await cache.addOutbox(userId, item)
    }
    await refreshPending()
    kickSend()
  }

  return {
    kind: 'server',

    get syncState() {
      return state
    },

    subscribeSync(listener) {
      listeners.add(listener)
      listener(state)
      return () => listeners.delete(listener)
    },

    async list() {
      let summaries: api.ServerDocSummary[] | null = null
      try {
        summaries = await api.listDocs()
        patchState({ online: true })
      } catch (err) {
        if (!(err instanceof ApiError)) throw err
        if (err.kind === 'unauthorized') patchState({ signedOut: true })
        if (err.kind === 'network') patchState({ online: false })
        summaries = null
      }

      if (summaries) {
        const outbox = await cache.getOutbox(userId)
        const pendingDocIds = new Set(outbox.map(docIdOf).filter((v): v is string => Boolean(v)))
        const serverIds = new Set(summaries.map((d) => d.id))
        await cache.deleteDocsNotIn(userId, new Set([...serverIds, ...pendingDocIds]))

        for (const summary of summaries) {
          if (pendingDocIds.has(summary.id)) continue
          const cached = await cache.getDoc(userId, summary.id)
          if (cached && cached.version === summary.version) continue
          try {
            const full = await api.getDoc(summary.id)
            await cache.putDoc(userId, full)
          } catch {
            // 네트워크 문제 등은 다음 기회에 다시 시도한다
          }
        }
      }

      const cached = await cache.getDocs(userId)
      await refreshPending()
      const owned = cached.map((d) => ({ ...toDoc(d), role: 'owner' as const }))

      // 공유받은 문서(F-212.md 2.4) — 캐시하지 않고 매번 새로 읽는다. 오프라인·오류면 빈 목록으로 조용히 건너뛴다
      let shared: Doc[] = []
      try {
        const sharedMeta = await api.getShared()
        shared = sharedMeta.map((d) => ({
          id: d.id,
          title: d.title,
          content: '',
          lineEnding: d.lineEnding,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          folderId: d.folderId,
          pinnedAt: d.pinnedAt,
          role: d.role,
          ownerEmail: d.ownerEmail,
          viaFolder: d.viaFolder ?? null,
        }))
      } catch {
        shared = []
      }

      return sortByUpdatedAtDesc([...owned, ...shared])
    },

    async get(id) {
      const cached = await cache.getDoc(userId, id)
      if (cached) return toDoc(cached)
      try {
        const full = await api.getDoc(id)
        await cache.putDoc(userId, full)
        return toDoc(full)
      } catch {
        return null
      }
    },

    async create({ title, content, lineEnding, folderId = null }) {
      const id = crypto.randomUUID()
      const now = Date.now()
      const doc: Omit<CachedDoc, 'userId'> = { id, title, content, lineEnding, folderId, pinnedAt: null, createdAt: now, updatedAt: now, version: 0 }
      await cache.putDoc(userId, doc)
      await cache.addOutbox(userId, { type: 'createDoc', docId: id, title, content, lineEnding, folderId })
      await refreshPending()
      kickSend()
      return toDoc({ ...doc, userId })
    },

    async update(id, patch) {
      const existing = await cache.getDoc(userId, id)
      if (!existing) throw new Error(`문서를 찾을 수 없음: ${id}`)
      const updated: CachedDoc = {
        ...existing,
        ...('title' in patch ? { title: patch.title as string } : {}),
        ...('content' in patch ? { content: patch.content as string } : {}),
        updatedAt: Date.now(),
      }
      await cache.putDoc(userId, updated)
      await enqueueUpdateDoc(id, patch)
      return toDoc(updated)
    },

    async remove(id) {
      const existing = await cache.getDoc(userId, id)
      await cache.deleteDoc(userId, id)
      await cache.removeOutboxForDoc(userId, id, inFlightKey)
      if (existing && existing.version > 0) {
        await cache.addOutbox(userId, { type: 'removeDoc', docId: id })
      }
      await refreshPending()
      kickSend()
    },

    async moveDoc(id, folderId) {
      const existing = await cache.getDoc(userId, id)
      if (!existing) throw new Error(`문서를 찾을 수 없음: ${id}`)
      const resolvedFolderId = folderId ?? null
      const updated = { ...existing, folderId: resolvedFolderId }
      await cache.putDoc(userId, updated)
      await enqueueCoalesced(
        { type: 'moveDoc', docId: id, folderId: resolvedFolderId },
        (e) => e.type === 'moveDoc' && e.docId === id,
      )
      return toDoc(updated)
    },

    async setPinned(id, pinned) {
      const existing = await cache.getDoc(userId, id)
      if (!existing) throw new Error(`문서를 찾을 수 없음: ${id}`)
      const updated = { ...existing, pinnedAt: pinned ? Date.now() : null }
      await cache.putDoc(userId, updated)
      await enqueueCoalesced(
        { type: 'setPinned', docId: id, pinned },
        (e) => e.type === 'setPinned' && e.docId === id,
      )
      return toDoc(updated)
    },

    async listFolders() {
      const cached = await cache.getFolders(userId)
      return cached.map(toFolder)
    },

    async createFolder({ name, parentId = null }) {
      const id = crypto.randomUUID()
      const now = Date.now()
      const folder: Omit<CachedFolder, 'userId'> = { id, name: name || '새 폴더', parentId, createdAt: now, updatedAt: now }
      await cache.putFolder(userId, folder)
      await cache.addOutbox(userId, { type: 'createFolder', folderId: id, name: folder.name, parentId })
      await refreshPending()
      kickSend()
      return toFolder({ ...folder, userId })
    },

    async renameFolder(id, name) {
      const existing = await cache.getFolder(userId, id)
      if (!existing) throw new Error(`폴더를 찾을 수 없음: ${id}`)
      const nextName = name || '새 폴더'
      const updated = { ...existing, name: nextName, updatedAt: Date.now() }
      await cache.putFolder(userId, updated)
      await enqueueCoalesced(
        { type: 'renameFolder', folderId: id, name: nextName },
        (e) => e.type === 'renameFolder' && e.folderId === id,
      )
      return toFolder(updated)
    },

    async moveFolder(id, parentId) {
      const existing = await cache.getFolder(userId, id)
      if (!existing) throw new Error(`폴더를 찾을 수 없음: ${id}`)
      const resolvedParentId = parentId ?? null
      const updated = { ...existing, parentId: resolvedParentId, updatedAt: Date.now() }
      await cache.putFolder(userId, updated)
      await enqueueCoalesced(
        { type: 'moveFolder', folderId: id, parentId: resolvedParentId },
        (e) => e.type === 'moveFolder' && e.folderId === id,
      )
      return toFolder(updated)
    },

    async removeFolder(id) {
      const existing = await cache.getFolder(userId, id)
      if (!existing) throw new Error(`폴더를 찾을 수 없음: ${id}`)
      const parentId = existing.parentId

      const docs = await cache.getDocs(userId)
      await Promise.all(docs.filter((d) => d.folderId === id).map((d) => cache.putDoc(userId, { ...d, folderId: parentId })))

      const folders = await cache.getFolders(userId)
      await Promise.all(folders.filter((f) => f.parentId === id).map((f) => cache.putFolder(userId, { ...f, parentId })))

      await cache.deleteFolder(userId, id)
      await cache.removeOutboxForFolder(userId, id, inFlightKey)
      await cache.addOutbox(userId, { type: 'removeFolder', folderId: id })
      await refreshPending()
      kickSend()
    },

    // GIF 가 아니면 WebP 로 변환해 본다(더 커지거나 실패하면 원본). 캐시에 먼저 넣고 즉시 반환, 올리기는 보낼 목록으로 (2.5)
    async putAttachment({ blob, mime, ext, width, height }) {
      const converted = ext === 'gif' ? blob : await toWebp(blob)
      const finalExt: AttachmentExt = converted === blob ? ext : 'webp'
      const finalMime = converted === blob ? mime : 'image/webp'

      let id = randomAttachmentId()
      while (await cache.getAttachment(userId, id)) {
        id = randomAttachmentId()
      }

      await cache.putAttachment(userId, { id, ext: finalExt, mime: finalMime, size: converted.size, width, height, blob: converted, uploaded: false, createdAt: Date.now() })
      await cache.addOutbox(userId, { type: 'upload', attachmentId: id, ext: finalExt })
      await refreshPending()
      kickSend()
      return { id, ext: finalExt }
    },

    async getAttachment(id) {
      const cached = await cache.getAttachment(userId, id)
      if (cached) return cachedToAttachment(cached)

      const docs = await cache.getDocs(userId)
      const found = findExtInDocs(docs, id)
      if (!found) return null
      const { ext, docId } = found

      try {
        const blob = await fetchAttachment(id, ext, docId)
        const { width, height } = await decodeDims(blob)
        const record: Omit<CachedAttachment, 'userId'> = {
          id,
          ext,
          mime: blob.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          size: blob.size,
          width,
          height,
          blob,
          uploaded: true,
          createdAt: Date.now(),
        }
        await cache.putAttachment(userId, record)
        return cachedToAttachment({ ...record, userId })
      } catch {
        return null
      }
    },

    // 캐시만(서버 삭제·GC 는 범위 밖, 2.5)
    async listAttachments() {
      const all = await cache.listAttachments(userId)
      return all.map(({ id, ext, size, createdAt }) => ({ id, ext, size, createdAt }))
    },

    async removeAttachment(id) {
      await cache.deleteAttachment(userId, id)
    },

    // 로컬 → 계정 이관 (F-208 2.2) — id 를 그대로 캐시에 쓰고 보낼 목록에 넣는다.
    // 캐시에 같은 id 가 이미 있으면(서버에 이미 있음) 건너뛴다
    async importLocal({ folders, docs }) {
      for (const folder of sortFoldersParentFirst(folders)) {
        const existing = await cache.getFolder(userId, folder.id)
        if (existing) continue
        await cache.putFolder(userId, { id: folder.id, name: folder.name, parentId: folder.parentId, createdAt: folder.createdAt, updatedAt: folder.updatedAt })
        await cache.addOutbox(userId, { type: 'createFolder', folderId: folder.id, name: folder.name, parentId: folder.parentId })
      }

      let importedCount = 0
      for (const doc of docs) {
        const existing = await cache.getDoc(userId, doc.id)
        if (existing) continue
        const cachedDoc: Omit<CachedDoc, 'userId'> = {
          id: doc.id,
          title: doc.title,
          content: doc.content,
          lineEnding: doc.lineEnding,
          folderId: doc.folderId,
          pinnedAt: doc.pinnedAt,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          version: 0,
        }
        await cache.putDoc(userId, cachedDoc)
        await cache.addOutbox(userId, {
          type: 'createDoc',
          docId: doc.id,
          title: doc.title,
          content: doc.content,
          lineEnding: doc.lineEnding,
          folderId: doc.folderId,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          pinnedAt: doc.pinnedAt,
        })
        importedCount++
      }

      await refreshPending()
      kickSend()
      return { importedCount }
    },
  }
}
