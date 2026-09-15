// F-207 서버 저장소 — 캐시에 먼저 쓰고 즉시 resolve, 보낼 목록(outbox)을 순서대로 보낸다 (2.3)
import { createIdbStore } from './idbStore'
import { createRemoteCache, docIdOf, type CachedDoc, type CachedFolder, type OutboxEntry, type OutboxItem, type RemoteCache } from './remoteCache'
import * as api from './docsApi'
import { ApiError, type ServerDoc } from './docsApi'
import type { Doc, Folder, LineEnding, Store, SyncState } from '../types'

const RETRY_INTERVAL_MS = 30000
const TOO_LARGE_MESSAGE = '문서가 너무 커서 서버에 저장하지 못했습니다(1MB 초과).'

type StoreNotice = { type: 'info' | 'error' | 'update' | 'warn'; message: string }

export type ServerStoreHandlers = {
  onConflict?: (event: { docId: string; copyId: string }) => void
  onNotice?: (notice: StoreNotice) => void
  dbName?: string
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
// 첨부는 로그인 여부와 무관하게 로컬 md-docs 첨부 스토어를 그대로 쓴다 (2.5)
function getLocalAttachmentStore(): Promise<Store> {
  if (!sharedLocalAttachmentStore) sharedLocalAttachmentStore = createIdbStore()
  return sharedLocalAttachmentStore
}

export async function createServerStore(userId: string, handlers: ServerStoreHandlers = {}): Promise<Store> {
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
          const created = await api.createDoc({ id: entry.docId, title: entry.title, content: entry.content, lineEnding: entry.lineEnding, folderId: entry.folderId })
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
        default:
          break
      }
      // 여기 도달했다는 건 fetch 가 응답을 줬다는 뜻이다 — 온라인
      patchState({ online: true })
      return true
    } catch (err) {
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

  refreshPending()
  kickSend()

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
      return sortByUpdatedAtDesc(cached.map(toDoc))
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

    async putAttachment(input) {
      const local = await getLocalAttachmentStore()
      return local.putAttachment(input)
    },

    async getAttachment(id) {
      const local = await getLocalAttachmentStore()
      return local.getAttachment(id)
    },

    async listAttachments() {
      const local = await getLocalAttachmentStore()
      return local.listAttachments()
    },

    async removeAttachment(id) {
      const local = await getLocalAttachmentStore()
      return local.removeAttachment(id)
    },
  }
}
