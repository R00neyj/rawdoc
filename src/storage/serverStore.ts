// F-207 서버 저장소 — 캐시에 먼저 쓰고 즉시 resolve, 보낼 목록(outbox)을 순서대로 보낸다 (2.3)
// F-209 2.5: 첨부는 캐시에 blob 을 두고 서버로 올린다(변환은 toWebp)
import { createIdbStore } from './idbStore'
import { createRemoteCache, docIdOf, folderIdOf, type CachedAttachment, type CachedDoc, type CachedFolder, type OutboxEntry, type OutboxItem, type RemoteCache } from './remoteCache'
import * as api from './docsApi'
import { ApiError, type ServerDoc } from './docsApi'
import { uploadAttachment, fetchAttachment, fetchUsage, AttachmentApiError } from './attachmentsApi'
import { toWebp } from './toWebp'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { canCreateFolder, canMoveFolder, descendantFolderIds } from '../lib/folderTree'
import { QUOTA_HOLD_MS, RATE_LIMITED_MINUTE_MESSAGE, rateLimitedDayMessage, docQuotaMessage, nextUtcMidnight } from '../lib/usageLimits'
import type { Attachment, AttachmentExt, Doc, Folder, FolderDeleteMode, LineEnding, Store, SyncState } from '../types'

const RETRY_INTERVAL_MS = 30000
const TOO_LARGE_MESSAGE = '문서가 너무 커서 서버에 저장하지 못했습니다(1MB 초과).'
const ATTACHMENT_UPLOAD_FAIL_MESSAGE = '이미지를 서버에 올리지 못했습니다.'
const ATTACHMENT_QUOTA_MESSAGE = '이미지 저장 공간(300MB)이 가득 찼습니다. 문서에서 지운 이미지는 하루 뒤 정리됩니다.'
const ATTACHMENT_EXT_RE = '(png|jpg|gif|webp)'
const FORBIDDEN_DOC_MESSAGE = '이 문서를 편집할 권한이 없어졌습니다.'
// 금고 문서 알림 E19·E21~E24 (specs/features/F-405.md 8장)
const E2EE_FOLDER_RULE_MESSAGE = '금고 폴더에는 금고 문서와 금고 폴더만 넣을 수 있습니다.'
const E2EE_CONFLICT_LOCKED_MESSAGE = '다른 곳에서 먼저 바뀐 금고 문서가 있습니다. 금고를 열면 이 기기의 편집을 충돌 사본으로 저장합니다.'
const E2EE_DOC_ELSEWHERE_MESSAGE = '다른 곳에서 이 문서를 금고로 옮겨, 이 기기에서 아직 올리지 못한 편집은 저장하지 않았습니다.'
const E2EE_FOLDER_MOVED_UP_MESSAGE = '금고 폴더로 바뀐 폴더에 만든 문서·폴더를 맨 위로 옮겨 저장했습니다.'
const E2EE_NO_VAULT_MESSAGE = '금고가 초기화되어 이 기기에서 만든 금고 문서를 올리지 못했습니다.'

// 금고 문서 하나의 createDoc·updateDoc 응답 뒤 다음 updateDoc 까지 최소 간격 (F-405 5.2)
export const E2EE_SERVER_SAVE_INTERVAL_MS = 10_000

type StoreNotice = { type: 'info' | 'error' | 'update' | 'warn'; message: string }

// putAttachment 사전 검사가 한도 초과를 알릴 때 던진다 — attachImages 가 name 으로 구분한다 (F-221.md 2.3)
export class QuotaExceededError extends Error {
  constructor() {
    super('quota_exceeded')
    this.name = 'quota_exceeded'
  }
}

export type ServerStoreHandlers = {
  // reason:'locked' 면 F-213.md 2.4 — 다른 세션이 편집 중이라 내 편집을 사본으로 돌렸다
  onConflict?: (event: { docId: string; copyId: string; reason?: 'locked'; email?: string }) => void
  onNotice?: (notice: StoreNotice) => void
  // 편집 권한이 있어 저장을 대기하던 문서가 서버에서 403 을 받았다 — 앱이 읽기 전용으로 내린다 (F-212.md 2.4)
  onForbidden?: (docId: string) => void
  dbName?: string
  // 쓰기가 403 account_blocked 를 받아 보내기를 멈췄다 — App 이 /api/me 로 누구의 차단인지 확인한다 (F-2030 4.4)
  onAccountBlocked?: () => void
  // 시계 — 단위 테스트가 30초·Retry-After 를 기다리지 않게 주입한다. 기본 Date.now (F-2030 3.3)
  now?: () => number
}

// 금고 충돌 사본 — storage 는 e2ee 를 import 하지 않으므로 withE2ee 가 함수를 주입한다 (F-405 5.4)
export type E2eeCopySource = { id: string; title: string; content: string; e2eeKey: string }
export type E2eeCopyResult = { title: string; content: string; e2eeKey: string; attachmentRefs: string[] }
export type E2eeCopyMaker = (source: E2eeCopySource, copyId: string) => Promise<E2eeCopyResult | null>

// server 저장소에만 있는 로컬 이관(F-208 2.2) 진입점 — Store 표준 타입엔 없어 이 타입으로 좁혀 쓴다
export type ServerStore = Store & {
  // 오프라인 부팅에서도 md-yjs 를 이 사용자로 연다 (F-306 9.2)
  readonly userId: string
  importLocal(input: { folders: Folder[]; docs: Doc[] }): Promise<{ importedCount: number }>
  // 잠금을 되찾은 뒤 서버 값을 다시 받아 캐시에 반영한다(에디터 재마운트용) (F-213.md 2.3)
  refreshDocFromServer(id: string): Promise<Doc | null>
  // outbox 에 이 문서의 createDoc·updateDoc 이 남았는가 — 남았으면 실시간으로 붙지 않는다 (F-305 4.2)
  hasPendingChanges(docId: string): Promise<boolean>
  // App 이 /api/me 결과로 부른다. true 면 보내기를 멈추고, false 로 바뀌면 다시 보낸다 (F-2030 4.4)
  setAccountBlocked(blocked: boolean): void
  // withE2ee 가 만들 때 한 번 부른다. 없으면 금고 충돌은 늘 대기 (F-405 5.4)
  setE2eeCopyMaker(maker: E2eeCopyMaker | null): void
  // 금고가 열리면 대기 중인 금고 충돌을 다시 보낸다 (5.3)
  resumeE2eeConflicts(): void
  // 진행 중인 보내기 회차를 기다린 뒤 한 회차를 더 돌린다 (5.4)
  flushOutbox(): Promise<void>
}

// 안 보낸 removeFolder(delete-all) 이 지운 폴더 id 들(자신 포함) — 서버 목록 기준 자손 판정 (F-247.md 3.1)
function excludedByPendingDeleteAll(outbox: OutboxEntry[], serverFolders: api.ServerFolder[]): Set<string> {
  const excluded = new Set<string>()
  for (const entry of outbox) {
    if (entry.type !== 'removeFolder' || entry.mode !== 'delete-all') continue
    for (const id of descendantFolderIds(serverFolders, entry.folderId)) excluded.add(id)
  }
  return excluded
}

// 안 보낸 removeFolder(move-up) 이 위로 올린 폴더들의 옛 부모 id 집합 — 이 id 를 부모로 답하는 서버 값은 믿지 않는다 (3.1)
function pendingMoveUpParentIds(outbox: OutboxEntry[]): Set<string> {
  const ids = new Set<string>()
  for (const entry of outbox) {
    if (entry.type === 'removeFolder' && entry.mode !== 'delete-all') ids.add(entry.folderId)
  }
  return ids
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

// folderId 가 null 이거나 존재하는 폴더를 가리키는 문자열이면 유효하다 (idbStore.ts isValidFolderId 와 동일 규칙, F-136.md 3.1·3.2)
function isValidFolderId(folders: Folder[], folderId: unknown): folderId is string | null {
  if (folderId === null) return true
  if (typeof folderId !== 'string') return false
  return folders.some((f) => f.id === folderId)
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
  let sendingRound: Promise<void> | null = null
  let inFlightKey: number | null = null
  // 507 알림은 한 번 보내기 회차에 한 번만 (F-221.md 2.4)
  let quotaNoticeShownThisRound = false

  // ----- F-2030 4장 — 429 전체 멈춤·413 붙잡기·403 차단 멈춤 상태 -----
  const now = () => handlers.now?.() ?? Date.now()
  let rateLimitedUntil: number | null = null // 429 — 이 시각까지 회차를 시작하지 않는다 (4.2)
  let blockedStop = false // 403 account_blocked — setAccountBlocked(false) 가 불릴 때까지 (4.4)
  let pendingBlockedDocId: string | null = null // 차단 멈춤을 일으킨 항목의 docId
  const skipDocIds = new Set<string>() // 남의 막힌 문서로 확인된 뒤 이 페이지 동안 건너뛸 문서 (4.4)
  const bytesHoldUntil = new Map<number, number>() // 413 bytes — 그 항목만 (4.3)
  const docsHoldUntil = new Map<number, number>() // 413 docs — outbox 의 모든 createDoc (4.3)

  // ----- F-405 5.2·5.3 — 금고 문서 10초 간격·잠긴 동안 충돌 대기 -----
  const e2eeLastResponseAt = new Map<string, number>() // 문서 id → 마지막 응답 시각(페이지 메모리만)
  const e2eeConflictWaiting = new Set<string>() // 사본 함수가 null 이라 멈춘 문서
  const e2eeConflictNoticed = new Set<string>() // E21 을 이미 띄운 문서
  let e2eeCopyMaker: E2eeCopyMaker | null = null
  let e2eeReleaseTimer: ReturnType<typeof setTimeout> | null = null
  let e2eeFolderNoticeShownThisRound = false
  let e2eeRuleNoticeShownThisRound = false

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

  function isHeld(key: number): boolean {
    const t = now()
    const b = bytesHoldUntil.get(key)
    if (b !== undefined && b > t) return true
    const d = docsHoldUntil.get(key)
    if (d !== undefined && d > t) return true
    return false
  }

  // 금고 updateDoc 이 10초 간격에 걸렸으면 풀리는 시각, 아니면 null (F-405 5.2)
  function e2eeReleaseAt(e: OutboxEntry): number | null {
    if (e.type !== 'updateDoc' || !e.e2ee) return null
    const last = e2eeLastResponseAt.get(e.docId)
    if (last === undefined) return null
    const until = last + E2EE_SERVER_SAVE_INTERVAL_MS
    return now() < until ? until : null
  }

  function isEntryHeld(e: OutboxEntry): boolean {
    return isHeld(e.key) || e2eeReleaseAt(e) !== null
  }

  // 붙잡힌 항목·같은 문서의 뒤 항목·건너뛸 문서·금고 충돌 대기 문서를 뺀 첫 항목 (4.5, F-405 5.2·5.3)
  function findSendable(entries: OutboxEntry[]): OutboxEntry | null {
    const heldDocIds = new Set<string>()
    for (const e of entries) {
      if (isEntryHeld(e)) {
        const docId = docIdOf(e)
        if (docId) heldDocIds.add(docId)
      }
    }
    for (const e of entries) {
      if (isEntryHeld(e)) continue
      const docId = docIdOf(e)
      if (docId && heldDocIds.has(docId)) continue
      if (docId && skipDocIds.has(docId)) continue
      if (docId && e2eeConflictWaiting.has(docId)) continue
      return e
    }
    return null
  }

  // 10초 간격에 걸린 금고 항목이 있으면 가장 이른 풀림 시각에 보내기를 한 번 다시 시작한다 — 브라우저에서만 (F-405 5.2)
  function scheduleE2eeRelease(entries: OutboxEntry[]) {
    if (typeof window === 'undefined') return
    let earliest: number | null = null
    for (const e of entries) {
      if (e2eeConflictWaiting.has(docIdOf(e) ?? '')) continue
      const until = e2eeReleaseAt(e)
      if (until !== null && (earliest === null || until < earliest)) earliest = until
    }
    if (earliest === null) return
    if (e2eeReleaseTimer) clearTimeout(e2eeReleaseTimer)
    e2eeReleaseTimer = setTimeout(() => {
      e2eeReleaseTimer = null
      kickSend()
    }, Math.max(0, earliest - now()))
  }

  function isE2eeWrite(entry: OutboxEntry): boolean {
    return (entry.type === 'createDoc' && entry.e2eeKey !== undefined) || (entry.type === 'updateDoc' && entry.e2ee === true)
  }

  function recordE2eeResponse(entry: OutboxEntry) {
    if (isE2eeWrite(entry)) e2eeLastResponseAt.set(docIdOf(entry)!, now())
  }

  // 이 맵에 이 회차 시점에서 실제로 남아 있는(outbox 에 있는) 붙잡힌 항목이 있는가 — L3·L4 는 없다가 처음 생길 때만 (4.3)
  function hasActiveHold(map: Map<number, number>, presentKeys: Set<number>): boolean {
    const t = now()
    for (const [key, until] of map) {
      if (until > t && presentKeys.has(key)) return true
    }
    return false
  }

  // 진행 중인 회차가 있으면 그 약속을 돌려준다 — flushOutbox 가 기다린다 (F-405 5.4)
  function kickSend(): Promise<void> {
    if (sendingRound) return sendingRound
    if (blockedStop) return Promise.resolve()
    if (rateLimitedUntil !== null && now() < rateLimitedUntil) return Promise.resolve()
    quotaNoticeShownThisRound = false
    e2eeFolderNoticeShownThisRound = false
    e2eeRuleNoticeShownThisRound = false
    const round = (async () => {
      try {
        for (;;) {
          if (blockedStop) break
          if (rateLimitedUntil !== null && now() < rateLimitedUntil) break
          const entries = await cache.getOutbox(userId)
          const entry = findSendable(entries)
          if (!entry) {
            scheduleE2eeRelease(entries)
            break
          }
          inFlightKey = entry.key
          const proceed = await sendOne(entry)
          inFlightKey = null
          if (!proceed) break
        }
      } finally {
        sendingRound = null
        await refreshPending()
      }
    })()
    sendingRound = round
    return round
  }

  async function handleConflict(
    entry: Extract<OutboxEntry, { type: 'updateDoc' }>,
    serverDoc: ServerDoc | undefined,
    extra?: { reason: 'locked'; email?: string },
  ) {
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

    handlers.onConflict?.({ docId: entry.docId, copyId, ...extra })
  }

  // 금고 충돌 사본 — 주입된 함수로 새 id·새 문서 키로 다시 암호화한다. 값이 없으면 그 문서만 대기(E21) (F-405 5.3)
  async function handleE2eeConflict(entry: Extract<OutboxEntry, { type: 'updateDoc' }>, serverDoc: ServerDoc | undefined): Promise<boolean> {
    const myDoc = await cache.getDoc(userId, entry.docId)
    if (!myDoc?.e2eeKey) {
      if (serverDoc) await cache.putDoc(userId, { ...serverDoc, id: entry.docId })
      return true
    }
    const copyId = crypto.randomUUID()
    let result: E2eeCopyResult | null = null
    try {
      result = e2eeCopyMaker ? await e2eeCopyMaker({ id: myDoc.id, title: myDoc.title, content: myDoc.content, e2eeKey: myDoc.e2eeKey }, copyId) : null
    } catch {
      result = null
    }
    if (!result) {
      e2eeConflictWaiting.add(entry.docId)
      if (!e2eeConflictNoticed.has(entry.docId)) {
        e2eeConflictNoticed.add(entry.docId)
        notice({ type: 'warn', message: E2EE_CONFLICT_LOCKED_MESSAGE })
      }
      return false
    }
    const t = Date.now()
    const copyDoc: Omit<CachedDoc, 'userId'> = {
      id: copyId,
      title: result.title,
      content: result.content,
      lineEnding: myDoc.lineEnding,
      folderId: myDoc.folderId,
      pinnedAt: null,
      createdAt: t,
      updatedAt: t,
      version: 0,
      e2eeKey: result.e2eeKey,
      attachmentRefs: result.attachmentRefs,
    }
    await cache.putDoc(userId, copyDoc)
    await cache.addOutbox(userId, {
      type: 'createDoc',
      docId: copyId,
      title: result.title,
      content: result.content,
      lineEnding: myDoc.lineEnding,
      folderId: myDoc.folderId,
      e2eeKey: result.e2eeKey,
      attachmentRefs: result.attachmentRefs,
    })
    if (serverDoc) await cache.putDoc(userId, { ...serverDoc, id: entry.docId })
    handlers.onConflict?.({ docId: entry.docId, copyId })
    return true
  }

  async function fetchDocIntoCache(docId: string): Promise<void> {
    try {
      const full = await api.getDoc(docId)
      await cache.putDoc(userId, full)
    } catch {
      // 다음 list() 때 다시 맞춰진다
    }
  }

  function noticeE2eeFolderMovedUp() {
    if (e2eeFolderNoticeShownThisRound) return
    e2eeFolderNoticeShownThisRound = true
    notice({ type: 'info', message: E2EE_FOLDER_MOVED_UP_MESSAGE })
  }

  function noticeE2eeFolderRule() {
    if (e2eeRuleNoticeShownThisRound) return
    e2eeRuleNoticeShownThisRound = true
    notice({ type: 'error', message: E2EE_FOLDER_RULE_MESSAGE })
  }

  // 금고 409 갈래 (F-405 5.3 표). 처리했으면 계속 보낼지(true), 해당 없으면 null
  async function handleE2eeApiError(entry: OutboxEntry, err: ApiError): Promise<boolean | null> {
    const kind = err.kind
    if (entry.type === 'updateDoc' && entry.e2ee && (kind === 'conflict' || kind === 'not_e2ee')) {
      recordE2eeResponse(entry)
      let serverDoc = kind === 'conflict' ? err.doc : undefined
      if (kind === 'not_e2ee') {
        try {
          serverDoc = await api.getDoc(entry.docId)
        } catch {
          serverDoc = undefined
        }
      }
      if (await handleE2eeConflict(entry, serverDoc)) await cache.removeOutbox(entry.key)
      return true
    }
    if (entry.type === 'updateDoc' && !entry.e2ee && kind === 'e2ee_doc') {
      // 평문 사본을 만들지 않는다 — 그 문서의 남은 항목을 모두 버리고 서버 값(봉투)을 캐시에 (12장 Q3)
      await cache.removeOutboxForDoc(userId, entry.docId)
      await fetchDocIntoCache(entry.docId)
      notice({ type: 'warn', message: E2EE_DOC_ELSEWHERE_MESSAGE })
      return true
    }
    if (entry.type === 'createDoc' && kind === 'e2ee_folder') {
      const row = await cache.getDoc(userId, entry.docId)
      if (row) await cache.putDoc(userId, { ...row, folderId: null })
      await cache.putOutboxEntry({ ...entry, folderId: null })
      noticeE2eeFolderMovedUp()
      return true
    }
    if (entry.type === 'createDoc' && kind === 'no_vault') {
      await cache.deleteDoc(userId, entry.docId)
      await cache.removeOutboxForDoc(userId, entry.docId)
      notice({ type: 'error', message: E2EE_NO_VAULT_MESSAGE })
      return true
    }
    if (entry.type === 'createFolder' && kind === 'e2ee_folder') {
      const row = await cache.getFolder(userId, entry.folderId)
      if (row) await cache.putFolder(userId, { ...row, parentId: null })
      await cache.putOutboxEntry({ ...entry, parentId: null })
      noticeE2eeFolderMovedUp()
      return true
    }
    if (entry.type === 'moveDoc' && kind === 'e2ee_folder') {
      await cache.removeOutbox(entry.key)
      await fetchDocIntoCache(entry.docId)
      noticeE2eeFolderRule()
      return true
    }
    if ((entry.type === 'moveFolder' || entry.type === 'renameFolder') && kind === 'e2ee_folder') {
      await cache.removeOutbox(entry.key)
      noticeE2eeFolderRule()
      return true
    }
    return null
  }

  // 429 — outbox 전체를 재개 시각까지 멈춘다. 멈출 때마다 L1·L2 를 한 번만 (F-2030 4.2)
  function applyRateLimitStop(scope: 'minute' | 'day' | undefined, retryAfter: number | undefined, limit: number | undefined) {
    const retryMs = (retryAfter ?? 60) * 1000
    rateLimitedUntil = now() + retryMs
    if (scope === 'day') {
      notice({ type: 'error', message: rateLimitedDayMessage(limit, nextUtcMidnight(now())) })
    } else {
      notice({ type: 'info', message: RATE_LIMITED_MINUTE_MESSAGE })
    }
    // 재개 시각에 한 번 보내기를 시작한다 — 브라우저에서만(탭이 잠들면 30초 재시도가 이어받는다)
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        kickSend()
      }, retryMs)
    }
  }

  // 413 doc_quota_exceeded — bytes 는 그 항목만, docs 는 outbox 의 모든 createDoc 을 30초 붙잡는다 (F-2030 4.3)
  async function applyQuotaHold(entry: OutboxEntry, resource: 'bytes' | 'docs', limit: number | undefined) {
    const currentEntries = await cache.getOutbox(userId)
    const presentKeys = new Set(currentEntries.map((e) => e.key))
    const until = now() + QUOTA_HOLD_MS
    if (resource === 'docs') {
      const had = hasActiveHold(docsHoldUntil, presentKeys)
      for (const e of currentEntries) if (e.type === 'createDoc') docsHoldUntil.set(e.key, until)
      if (!had) notice({ type: 'error', message: docQuotaMessage('docs', limit) })
    } else {
      const had = hasActiveHold(bytesHoldUntil, presentKeys)
      bytesHoldUntil.set(entry.key, until)
      if (!had) notice({ type: 'error', message: docQuotaMessage('bytes', limit) })
    }
  }

  // 403 account_blocked — 차단 멈춤. 누구의 차단인지는 App 이 /api/me 로 확인해 setAccountBlocked 를 부른다 (F-2030 4.4)
  function applyAccountBlockedStop(docId: string | undefined) {
    blockedStop = true
    pendingBlockedDocId = docId ?? null
    handlers.onAccountBlocked?.()
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
            // 금고 문서만 (F-405 5.1)
            ...(entry.e2eeKey !== undefined ? { e2eeKey: entry.e2eeKey, attachmentRefs: entry.attachmentRefs ?? [] } : {}),
          })
          recordE2eeResponse(entry)
          await cache.putDoc(userId, created)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'updateDoc': {
          const cachedDoc = await cache.getDoc(userId, entry.docId)
          const baseVersion = cachedDoc?.version ?? 0
          const updated = await api.updateDoc(entry.docId, { ...entry.patch, baseVersion, ...(entry.e2ee ? { e2ee: true as const } : {}) })
          recordE2eeResponse(entry)
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
          // in-flight 로 살아남은 createDoc/updateDoc 등이 먼저 끝나 캐시를 되살렸을 수 있다 — 서버는 확실히 지워졌으니 캐시도 맞춘다
          await cache.deleteDoc(userId, entry.docId)
          await cache.removeOutbox(entry.key)
          break
        }
        case 'createFolder': {
          const created = await api.createFolder({ id: entry.folderId, name: entry.name, parentId: entry.parentId, ...(entry.e2ee ? { e2ee: true as const } : {}) })
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
          await api.removeFolder(entry.folderId, entry.mode ?? 'move-up')
          // in-flight 로 살아남은 createFolder/moveFolder 등이 먼저 끝나 캐시를 되살렸을 수 있다 — 서버는 확실히 지워졌으니 캐시도 맞춘다
          await cache.deleteFolder(userId, entry.folderId)
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
        if (err.kind === 'quota_exceeded') {
          // 원문·캐시는 그대로 두고 올리기 항목만 뺀다 — 다른 기기에선 '이미지를 찾을 수 없습니다' (F-221.md 2.4)
          await cache.removeOutbox(entry.key)
          if (!quotaNoticeShownThisRound) {
            quotaNoticeShownThisRound = true
            notice({ type: 'error', message: ATTACHMENT_QUOTA_MESSAGE })
          }
          return true
        }
        if (err.kind === 'too_large' || err.kind === 'unsupported' || err.kind === 'type_mismatch') {
          await cache.removeOutbox(entry.key)
          notice({ type: 'error', message: ATTACHMENT_UPLOAD_FAIL_MESSAGE })
          return true
        }
        // 분당·하루 몫은 사용자 하나에 하나 — docsApi 와 같은 규칙 (F-2030 4.2)
        if (err.kind === 'rate_limited') {
          applyRateLimitStop(err.scope, err.retryAfter, err.limit)
          return false
        }
        if (err.kind === 'account_blocked') {
          applyAccountBlockedStop(undefined)
          return false
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
      if (err.kind === 'rate_limited') {
        applyRateLimitStop(err.scope, err.retryAfter, err.limit)
        return false
      }
      if (err.kind === 'doc_quota_exceeded') {
        await applyQuotaHold(entry, err.resource ?? 'bytes', err.limit)
        return true
      }
      if (err.kind === 'account_blocked') {
        applyAccountBlockedStop(docIdOf(entry))
        return false
      }
      const e2eeHandled = await handleE2eeApiError(entry, err)
      if (e2eeHandled !== null) return e2eeHandled
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
      if (err.kind === 'locked' && entry.type === 'updateDoc' && !entry.e2ee) {
        // 423 에는 문서 본문이 없다 — 서버 값을 따로 받아 원본 캐시에 반영한다 (F-213.md 2.4)
        let serverDoc: ServerDoc | undefined
        try {
          serverDoc = await api.getDoc(entry.docId)
        } catch {
          // 못 받아도 사본은 만든다 — 원본 캐시는 다음 list() 때 다시 맞춰진다
        }
        await handleConflict(entry, serverDoc, { reason: 'locked', email: err.email })
        await cache.removeOutbox(entry.key)
        return true
      }
      if (err.kind === 'forbidden' && entry.type === 'updateDoc') {
        // 편집 권한이 사라졌다 — 이 문서로 대기 중인 나머지 편집 요청도 함께 버린다 (F-212.md 2.4)
        await cache.removeOutboxForDoc(userId, entry.docId, entry.key)
        await cache.removeOutbox(entry.key)
        handlers.onForbidden?.(entry.docId)
        notice({ type: 'error', message: FORBIDDEN_DOC_MESSAGE })
        return true
      }
      // id_taken·invalid·other — 재시도해도 성공하지 못하므로 버리고 계속 진행한다
      await cache.removeOutbox(entry.key)
      // id_taken 만 원인을 알려준다 — 재발급은 F-289 로 미룬다 (F-282.md 3.14)
      if (err.kind === 'id_taken') {
        notice({ type: 'error', message: '다른 사람이 만든 문서·폴더와 번호가 겹쳐 서버에 올리지 못했습니다. 이 기기에는 남아 있습니다.' })
      } else {
        notice({ type: 'error', message: '동기화하지 못했습니다.' })
      }
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

  // e2ee 표지는 넣을 때 정하고 합칠 때는 앞 항목 것을 유지한다 (F-405 3.3)
  async function enqueueUpdateDoc(docId: string, patch: { title?: string; content?: string; attachmentRefs?: string[] }, e2ee: boolean) {
    const entries = await cache.getOutbox(userId)
    const existing = entries.find((e): e is OutboxEntry & { type: 'updateDoc' } => e.type === 'updateDoc' && e.docId === docId && e.key !== inFlightKey)
    if (existing) {
      await cache.putOutboxEntry({ ...existing, patch: { ...existing.patch, ...patch } })
    } else {
      await cache.addOutbox(userId, { type: 'updateDoc', docId, patch, ...(e2ee ? { e2ee: true as const } : {}) })
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
    userId,

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

        // 아직 안 보낸 delete-all 이 있으면 그 하위 폴더의 문서를 재조정에서 제외한다 — 자손 판정은 서버 폴더 목록 기준 (F-247.md 3.1)
        const hasPendingDeleteAll = outbox.some((e) => e.type === 'removeFolder' && e.mode === 'delete-all')
        let excludedDocIds = new Set<string>()
        if (hasPendingDeleteAll) {
          let serverFolders: api.ServerFolder[] = []
          try {
            serverFolders = await api.listFolders()
          } catch {
            serverFolders = []
          }
          const excludedFolderIds = excludedByPendingDeleteAll(outbox, serverFolders)
          excludedDocIds = new Set(
            summaries.filter((d) => d.folderId && excludedFolderIds.has(d.folderId)).map((d) => d.id),
          )
        }

        const serverIds = new Set(summaries.map((d) => d.id))
        const keepIds = new Set([...serverIds, ...pendingDocIds])
        for (const id of excludedDocIds) keepIds.delete(id)
        await cache.deleteDocsNotIn(userId, keepIds)

        for (const summary of summaries) {
          if (pendingDocIds.has(summary.id)) continue
          if (excludedDocIds.has(summary.id)) continue
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

    // setPinned·moveDoc 은 세지 않는다 — baseVersion 을 보내지 않아 실시간과 부딪치지 않는다 (F-305 4.2)
    async hasPendingChanges(docId) {
      const entries = await cache.getOutbox(userId)
      return entries.some((e) => (e.type === 'createDoc' || e.type === 'updateDoc') && e.docId === docId)
    },

    // App 이 /api/me 결과로 부른다 (F-2030 4.4)
    setAccountBlocked(blocked) {
      if (blocked) {
        blockedStop = true
        return
      }
      // 차단 멈춤 중이 아닐 때 불리면 아무것도 하지 않는다 (4.4 4번)
      if (!blockedStop) return
      blockedStop = false
      if (pendingBlockedDocId) {
        const docId = pendingBlockedDocId
        pendingBlockedDocId = null
        // 남의 문서 소유자가 막힌 것으로 확인됐다 — 이 페이지 동안 그 문서만 건너뛴다. 항목은 지우지 않는다
        skipDocIds.add(docId)
        handlers.onForbidden?.(docId)
        notice({ type: 'error', message: FORBIDDEN_DOC_MESSAGE })
      }
      kickSend()
    },

    setE2eeCopyMaker(maker) {
      e2eeCopyMaker = maker
    },

    resumeE2eeConflicts() {
      if (e2eeConflictWaiting.size === 0) return
      e2eeConflictWaiting.clear()
      kickSend()
    },

    async flushOutbox() {
      if (sendingRound) await sendingRound
      await kickSend()
    },

    async refreshDocFromServer(id) {
      try {
        const full = await api.getDoc(id)
        await cache.putDoc(userId, full)
        return toDoc(full)
      } catch {
        return null
      }
    },

    // id 가 이미 있으면 던진다(덮지 않는다). 가져오기(F-282)가 id·시각·고정을 유지할 때만 준다 (F-282.md 3.11)
    async create({ title, content, lineEnding, folderId = null, id: givenId, createdAt, updatedAt, pinnedAt, e2eeKey, attachmentRefs }) {
      const folders = await cache.getFolders(userId)
      if (!isValidFolderId(folders, folderId)) {
        throw new Error(`유효하지 않은 folderId: ${String(folderId)}`)
      }
      if (givenId !== undefined) {
        const existing = await cache.getDoc(userId, givenId)
        if (existing) throw new Error(`이미 있는 id: ${givenId}`)
      }
      const id = givenId ?? crypto.randomUUID()
      const now = Date.now()
      const doc: Omit<CachedDoc, 'userId'> = {
        id,
        title,
        content,
        lineEnding,
        folderId,
        pinnedAt: pinnedAt ?? null,
        createdAt: createdAt ?? now,
        updatedAt: updatedAt ?? now,
        version: 0,
        ...(e2eeKey !== undefined ? { e2eeKey, attachmentRefs: attachmentRefs ?? [] } : {}),
      }
      await cache.putDoc(userId, doc)
      await cache.addOutbox(userId, {
        type: 'createDoc',
        docId: id,
        title,
        content,
        lineEnding,
        folderId,
        ...(createdAt !== undefined ? { createdAt } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(pinnedAt !== undefined ? { pinnedAt } : {}),
        ...(e2eeKey !== undefined ? { e2eeKey, attachmentRefs: attachmentRefs ?? [] } : {}),
      })
      await refreshPending()
      kickSend()
      return toDoc({ ...doc, userId })
    },

    async update(id, patch) {
      const existing = await cache.getDoc(userId, id)
      if (!existing) throw new Error(`문서를 찾을 수 없음: ${id}`)
      const isE2ee = existing.e2eeKey !== undefined
      // attachmentRefs 는 금고 문서만 싣는다 (F-405 3.1)
      const { attachmentRefs, ...textPatch } = patch
      const sendPatch = isE2ee && attachmentRefs !== undefined ? { ...textPatch, attachmentRefs } : textPatch
      const updated: CachedDoc = {
        ...existing,
        ...('title' in patch ? { title: patch.title as string } : {}),
        ...('content' in patch ? { content: patch.content as string } : {}),
        ...(isE2ee && attachmentRefs !== undefined ? { attachmentRefs } : {}),
        updatedAt: Date.now(),
      }
      await cache.putDoc(userId, updated)
      await enqueueUpdateDoc(id, sendPatch, isE2ee)
      return toDoc(updated)
    },

    async remove(id) {
      const existing = await cache.getDoc(userId, id)
      // in-flight createDoc 은 removeOutboxForDoc 이 건드리지 않으므로, 그게 나중에 성공하면 서버에 남는다 — removeDoc 을 같이 큐잉해야 한다
      const outboxBefore = await cache.getOutbox(userId)
      const hasInFlightCreate = outboxBefore.some((e) => e.type === 'createDoc' && e.docId === id && e.key === inFlightKey)
      await cache.deleteDoc(userId, id)
      await cache.removeOutboxForDoc(userId, id, inFlightKey)
      if (existing && (existing.version > 0 || hasInFlightCreate)) {
        await cache.addOutbox(userId, { type: 'removeDoc', docId: id })
      }
      await refreshPending()
      kickSend()
    },

    async moveDoc(id, folderId) {
      const existing = await cache.getDoc(userId, id)
      if (!existing) throw new Error(`문서를 찾을 수 없음: ${id}`)
      const resolvedFolderId = folderId ?? null
      const folders = await cache.getFolders(userId)
      if (!isValidFolderId(folders, resolvedFolderId)) {
        throw new Error(`유효하지 않은 folderId: ${resolvedFolderId}`)
      }
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

    // list() 와 같은 방식 — 서버 목록으로 캐시를 맞추고 캐시에서 돌려준다 (F-207.md 2.2)
    async listFolders() {
      let serverFolders: api.ServerFolder[] | null = null
      try {
        serverFolders = await api.listFolders()
        patchState({ online: true })
      } catch (err) {
        if (!(err instanceof ApiError)) throw err
        if (err.kind === 'unauthorized') patchState({ signedOut: true })
        if (err.kind === 'network') patchState({ online: false })
        serverFolders = null
      }

      if (serverFolders) {
        const outbox = await cache.getOutbox(userId)
        const pendingFolderIds = new Set(outbox.map(folderIdOf).filter((v): v is string => Boolean(v)))
        // 안 보낸 delete-all 의 하위 트리, move-up 이 위로 올린 값을 서버의 옛 값이 덮지 못하게 한다 (F-247.md 3.1)
        const excludedFolderIds = excludedByPendingDeleteAll(outbox, serverFolders)
        const moveUpParentIds = pendingMoveUpParentIds(outbox)

        const serverIds = new Set(serverFolders.map((f) => f.id))
        const keepIds = new Set([...serverIds, ...pendingFolderIds])
        for (const id of excludedFolderIds) keepIds.delete(id)
        await cache.deleteFoldersNotIn(userId, keepIds)

        for (const folder of serverFolders) {
          if (pendingFolderIds.has(folder.id)) continue
          if (excludedFolderIds.has(folder.id)) continue
          if (folder.parentId && moveUpParentIds.has(folder.parentId)) {
            const cachedFolder = await cache.getFolder(userId, folder.id)
            await cache.putFolder(userId, cachedFolder ? { ...folder, parentId: cachedFolder.parentId } : folder)
            continue
          }
          await cache.putFolder(userId, folder)
        }
      }

      const cached = await cache.getFolders(userId)
      return cached.map(toFolder)
    },

    // id 가 이미 있으면 던진다. createdAt·updatedAt 은 서버가 받지 않는다 — 캐시에만 쓴다(F-282.md 3.11·3.12)
    async createFolder({ name, parentId = null, id: givenId, createdAt, updatedAt, e2ee }) {
      const existingFolders = await cache.getFolders(userId)
      if (!canCreateFolder({ folders: existingFolders, parentId })) {
        throw new Error(`상위 폴더가 될 수 없음: ${parentId}`)
      }
      if (givenId !== undefined) {
        const existing = await cache.getFolder(userId, givenId)
        if (existing) throw new Error(`이미 있는 id: ${givenId}`)
      }
      const id = givenId ?? crypto.randomUUID()
      const now = Date.now()
      const folder: Omit<CachedFolder, 'userId'> = {
        id,
        name: name || '새 폴더',
        parentId,
        createdAt: createdAt ?? now,
        updatedAt: updatedAt ?? now,
        ...(e2ee === true ? { e2ee: true as const } : {}),
      }
      await cache.putFolder(userId, folder)
      await cache.addOutbox(userId, { type: 'createFolder', folderId: id, name: folder.name, parentId, ...(e2ee === true ? { e2ee: true as const } : {}) })
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
      const allFolders = await cache.getFolders(userId)
      if (!canMoveFolder({ folders: allFolders, id, parentId: resolvedParentId })) {
        throw new Error(`이동할 수 없음: ${id} → ${resolvedParentId}`)
      }
      const updated = { ...existing, parentId: resolvedParentId, updatedAt: Date.now() }
      await cache.putFolder(userId, updated)
      await enqueueCoalesced(
        { type: 'moveFolder', folderId: id, parentId: resolvedParentId },
        (e) => e.type === 'moveFolder' && e.folderId === id,
      )
      return toFolder(updated)
    },

    async removeFolder(id, mode: FolderDeleteMode = 'move-up') {
      const existing = await cache.getFolder(userId, id)
      // 캐시에 없으면 이미 지워진 것으로 본다 — 되살아난 폴더의 행이 남아 삭제를 눌렀을 때 등 (F-247.md 3.2)
      if (!existing) return

      if (mode === 'delete-all') {
        const allFolders = await cache.getFolders(userId)
        const ids = descendantFolderIds(allFolders, id)

        const docs = await cache.getDocs(userId)
        for (const doc of docs) {
          if (doc.folderId && ids.includes(doc.folderId)) {
            await cache.deleteDoc(userId, doc.id)
            await cache.removeOutboxForDoc(userId, doc.id, inFlightKey)
          }
        }
        for (const fid of ids) {
          await cache.deleteFolder(userId, fid)
          await cache.removeOutboxForFolder(userId, fid, inFlightKey)
        }
        await cache.addOutbox(userId, { type: 'removeFolder', folderId: id, mode: 'delete-all' })
        await refreshPending()
        kickSend()
        return
      }

      const parentId = existing.parentId

      const docs = await cache.getDocs(userId)
      await Promise.all(docs.filter((d) => d.folderId === id).map((d) => cache.putDoc(userId, { ...d, folderId: parentId })))

      const folders = await cache.getFolders(userId)
      await Promise.all(folders.filter((f) => f.parentId === id).map((f) => cache.putFolder(userId, { ...f, parentId })))

      await cache.deleteFolder(userId, id)
      await cache.removeOutboxForFolder(userId, id, inFlightKey)
      await cache.addOutbox(userId, { type: 'removeFolder', folderId: id, mode: 'move-up' })
      await refreshPending()
      kickSend()
    },

    // GIF·이미 WebP 면 변환을 건너뛴다(이중 인코딩 방지, F-220.md 2.3). 그 외는 WebP 로 변환해 본다(더 커지거나 실패하면 원본). 캐시에 먼저 넣고 즉시 반환, 올리기는 보낼 목록으로 (2.5)
    // 넣기 전 사전 검사(F-221.md 2.3) — used + 아직 안 올린 캐시 합 + 새 크기 > limit 면 던진다. 조회 실패(오프라인 등)면 건너뛴다(서버가 최종 판정)
    // id 를 주면 그 id 로 저장하고 WebP 변환을 건너뛴다(원문 attachments/{id}.{ext} 를 고치지 않으려면 ext 가 그대로여야 한다). 이미 있으면 덮지 않고 그대로 돌려준다 (F-282.md 3.11)
    async putAttachment({ blob, mime, ext, width, height, id: givenId }) {
      if (givenId !== undefined) {
        const existing = await cache.getAttachment(userId, givenId)
        if (existing) return { id: existing.id, ext: existing.ext }
      }

      const converted = givenId !== undefined || ext === 'gif' || ext === 'webp' ? blob : await toWebp(blob)
      const finalExt: AttachmentExt = converted === blob ? ext : 'webp'
      const finalMime = converted === blob ? mime : 'image/webp'

      let usage: { used: number; limit: number } | null = null
      try {
        usage = await fetchUsage()
      } catch {
        usage = null
      }
      if (usage) {
        const cachedAttachments = await cache.listAttachments(userId)
        const unsent = cachedAttachments.reduce((sum, a) => sum + (a.uploaded ? 0 : a.size), 0)
        if (usage.used + unsent + converted.size > usage.limit) {
          throw new QuotaExceededError()
        }
      }

      let id = givenId
      if (id === undefined) {
        id = randomAttachmentId()
        while (await cache.getAttachment(userId, id)) {
          id = randomAttachmentId()
        }
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
      return all.map(({ id, ext, size, createdAt, uploaded }) => ({ id, ext, size, createdAt, uploaded }))
    },

    async removeAttachment(id) {
      await cache.deleteAttachment(userId, id)
    },

    // 로컬 → 계정 이관 (F-208 2.2) — id 를 그대로 캐시에 쓰고 보낼 목록에 넣는다.
    // 캐시에 같은 id 가 이미 있으면(서버에 이미 있음) 건너뛴다
    // 로컬 금고 폴더·문서는 건너뛴다 — 키 없이 일반 문서로 올라가면 봉투가 본문이 된다 (F-405 5.5)
    async importLocal({ folders: allFolders, docs: allDocs }) {
      const folders = allFolders.filter((f) => f.e2ee !== true)
      const docs = allDocs.filter((d) => d.e2eeKey === undefined)
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
