// 저장소 위 한 겹 — 금고 문서의 제목·본문을 봉투로 쓰고 읽을 때 푼다 (specs/features/F-405.md 4장)
import type { Doc, Folder, Store } from '../types'
import type { E2eeCopyResult, E2eeCopySource, ServerStore } from '../storage/serverStore'
import { E2EE_MAX_ATTACHMENT_REFS, isPlainContentTooLarge } from '../lib/e2eeLimits'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { createDocKey, decryptDocField, encryptDocField, openDocKey } from './crypto'

export type E2eeStoreErrorCode = 'locked' | 'too-large' | 'too-many-refs' | 'e2ee-folder'

export class E2eeStoreError extends Error {
  readonly code: E2eeStoreErrorCode
  constructor(code: E2eeStoreErrorCode) {
    super(code)
    this.code = code
    this.name = 'E2eeStoreError'
  }
}

export function isE2eeStoreError(err: unknown, code?: E2eeStoreErrorCode): err is E2eeStoreError {
  return err instanceof E2eeStoreError && (code === undefined || err.code === code)
}

export type E2eeStoreDeps = {
  // App 이 keyring.getMasterKey 를 ref 로 늦게 잇는다
  getMasterKey: () => CryptoKey | null
}

export type E2eeStore = Store & {
  // 잠그기 indexes 단계 — 복호화 기억·문서 키 기억을 버린다
  clearPlainCache(): void
  // 금고가 열리면 App 이 부른다 — 서버 저장소면 멈춘 충돌을 다시 보낸다
  resumeAfterUnlock(): void
}

const CONFLICT_COPY_SUFFIX = ' (충돌 사본)'

// extractAttachmentRefs 를 정렬한 배열 (4.3)
export function attachmentRefsOf(content: string): string[] {
  return [...extractAttachmentRefs(content)].sort()
}

// 잠그기 unmount 단계 — 열린 금고 문서만 잠긴 모양으로, 나머지는 같은 객체 (4.6)
export function lockDocMetas<T extends { title: string; e2ee?: 'locked' | 'open' }>(docs: T[]): T[] {
  return docs.map((doc) => (doc.e2ee === 'open' ? { ...doc, title: '', e2ee: 'locked' as const } : doc))
}

// 금고 초기화 — 맨 바깥 금고 폴더와 그 밖에 있는 금고 문서 (4.6)
export function planE2eeReset(input: {
  docs: Array<Pick<Doc, 'id' | 'folderId' | 'e2ee'>>
  folders: Array<Pick<Folder, 'id' | 'parentId' | 'e2ee'>>
}): { folderIds: string[]; docIds: string[] } {
  const byId = new Map(input.folders.map((f) => [f.id, f]))
  const folderIds = input.folders
    .filter((f) => f.e2ee === true && !(f.parentId && byId.get(f.parentId)?.e2ee === true))
    .map((f) => f.id)
  const covered = new Set<string>(folderIds)
  let grew = true
  while (grew) {
    grew = false
    for (const f of input.folders) {
      if (!covered.has(f.id) && f.parentId && covered.has(f.parentId)) {
        covered.add(f.id)
        grew = true
      }
    }
  }
  const docIds = input.docs.filter((d) => d.e2ee !== undefined && !(d.folderId && covered.has(d.folderId))).map((d) => d.id)
  return { folderIds, docIds }
}

// 충돌 사본 — 원본 문서 키로 풀고 새 문서 키·사본 id AAD 로 다시 봉투 (5.4). 풀지 못하면 던진다
export async function makeE2eeConflictCopy(masterKey: CryptoKey, source: E2eeCopySource, copyId: string): Promise<E2eeCopyResult> {
  const sourceKey = await openDocKey(masterKey, source.e2eeKey)
  const title = await decryptDocField(sourceKey, source.id, 'title', source.title)
  const content = await decryptDocField(sourceKey, source.id, 'content', source.content)
  const { docKey, wrappedDocKey } = await createDocKey(masterKey)
  return {
    title: await encryptDocField(docKey, copyId, 'title', `${title}${CONFLICT_COPY_SUFFIX}`),
    content: await encryptDocField(docKey, copyId, 'content', content),
    e2eeKey: wrappedDocKey,
    attachmentRefs: attachmentRefsOf(content),
  }
}

// 평문 본문 판정 — 크기 뒤 첨부 id 수 (4.2)
function checkPlainContent(content: string): string[] {
  if (isPlainContentTooLarge(content)) throw new E2eeStoreError('too-large')
  const refs = attachmentRefsOf(content)
  if (refs.length > E2EE_MAX_ATTACHMENT_REFS) throw new E2eeStoreError('too-many-refs')
  return refs
}

type PlainMemo = { e2eeKey: string; titleEnvelope: string; contentEnvelope: string; title: string; content: string }

export function withE2ee<S extends Store>(inner: S, deps: E2eeStoreDeps): S & E2eeStore {
  // 메모리에만 둔다 (4.4) — 문서 키는 감싼 키마다, 평문은 문서마다 한 벌
  const docKeys = new Map<string, Promise<CryptoKey>>()
  const plainMemo = new Map<string, PlainMemo>()
  const failureLogged = new Set<string>()
  let lastMasterKey: CryptoKey | null = null

  function clearPlainCache() {
    docKeys.clear()
    plainMemo.clear()
  }

  // 전에 쓴 MK 와 다른 객체(또는 null)면 기억을 버린다 (4.4)
  function currentMasterKey(): CryptoKey | null {
    const mk = deps.getMasterKey()
    if (mk !== lastMasterKey) {
      clearPlainCache()
      lastMasterKey = mk
    }
    return mk
  }

  function docKeyFor(mk: CryptoKey, wrapped: string): Promise<CryptoKey> {
    let pending = docKeys.get(wrapped)
    if (!pending) {
      pending = openDocKey(mk, wrapped)
      docKeys.set(wrapped, pending)
      pending.catch(() => {
        if (docKeys.get(wrapped) === pending) docKeys.delete(wrapped)
      })
    }
    return pending
  }

  function lockedShape(rest: Doc, refs: string[]): Doc {
    return { ...rest, title: '', content: '', e2ee: 'locked', attachmentRefs: refs }
  }

  // 저장소 층 → 앱 층 (4.1). 일반 문서는 그대로
  async function decode(row: Doc): Promise<Doc> {
    if (row.e2eeKey === undefined) return row
    const { e2eeKey, ...rest } = row
    const refs = row.attachmentRefs ?? []
    const mk = currentMasterKey()
    if (!mk) return lockedShape(rest, refs)
    const memo = plainMemo.get(row.id)
    if (memo && memo.e2eeKey === e2eeKey && memo.titleEnvelope === row.title && memo.contentEnvelope === row.content) {
      return { ...rest, title: memo.title, content: memo.content, e2ee: 'open', attachmentRefs: refs }
    }
    try {
      const key = await docKeyFor(mk, e2eeKey)
      const title = await decryptDocField(key, row.id, 'title', row.title)
      const content = await decryptDocField(key, row.id, 'content', row.content)
      plainMemo.set(row.id, { e2eeKey, titleEnvelope: row.title, contentEnvelope: row.content, title, content })
      return { ...rest, title, content, e2ee: 'open', attachmentRefs: refs }
    } catch {
      if (!failureLogged.has(row.id)) {
        failureLogged.add(row.id)
        console.error('e2ee_decrypt_failed', row.id)
      }
      return lockedShape(rest, refs)
    }
  }

  async function isE2eeFolder(folderId: string | null | undefined): Promise<boolean> {
    if (!folderId) return false
    const folders = await inner.listFolders()
    return folders.some((f) => f.id === folderId && f.e2ee === true)
  }

  const create: Store['create'] = async (input) => {
    const { e2ee, e2eeKey: _ignoredKey, attachmentRefs: _ignoredRefs, ...rest } = input
    const asE2ee = e2ee === true || (await isE2eeFolder(rest.folderId))
    if (!asE2ee) return decode(await inner.create(rest))
    const mk = currentMasterKey()
    if (!mk) throw new E2eeStoreError('locked')
    const refs = checkPlainContent(rest.content)
    // AAD 에 id 가 들어가므로 여기서 정한다 (4.2)
    const id = rest.id ?? crypto.randomUUID()
    const { docKey, wrappedDocKey } = await createDocKey(mk)
    const titleEnvelope = await encryptDocField(docKey, id, 'title', rest.title)
    const contentEnvelope = await encryptDocField(docKey, id, 'content', rest.content)
    const row = await inner.create({ ...rest, id, title: titleEnvelope, content: contentEnvelope, e2eeKey: wrappedDocKey, attachmentRefs: refs })
    docKeys.set(wrappedDocKey, Promise.resolve(docKey))
    plainMemo.set(id, { e2eeKey: wrappedDocKey, titleEnvelope, contentEnvelope, title: rest.title, content: rest.content })
    return decode(row)
  }

  const update: Store['update'] = async (id, patch) => {
    // 앱이 준 attachmentRefs 는 버리고 본문에서 다시 만든다 (4.2)
    const { attachmentRefs: _ignoredRefs, ...textPatch } = patch
    const row = await inner.get(id)
    if (!row || row.e2eeKey === undefined) return decode(await inner.update(id, textPatch))
    const mk = currentMasterKey()
    if (!mk) throw new E2eeStoreError('locked')
    const refs = textPatch.content !== undefined ? checkPlainContent(textPatch.content) : undefined
    const before = await decode(row)
    const key = await docKeyFor(mk, row.e2eeKey)
    const next: { title?: string; content?: string; attachmentRefs?: string[] } = {}
    if (textPatch.title !== undefined) next.title = await encryptDocField(key, id, 'title', textPatch.title)
    if (textPatch.content !== undefined) {
      next.content = await encryptDocField(key, id, 'content', textPatch.content)
      next.attachmentRefs = refs
    }
    const updated = await inner.update(id, next)
    if (before.e2ee === 'open' && updated.e2eeKey === row.e2eeKey) {
      plainMemo.set(id, {
        e2eeKey: row.e2eeKey,
        titleEnvelope: updated.title,
        contentEnvelope: updated.content,
        title: textPatch.title ?? before.title,
        content: textPatch.content ?? before.content,
      })
    }
    return decode(updated)
  }

  const moveDoc: Store['moveDoc'] = async (id, folderId) => {
    if (folderId) {
      const row = await inner.get(id)
      if (row && row.e2eeKey === undefined && (await isE2eeFolder(folderId))) throw new E2eeStoreError('e2ee-folder')
    }
    return decode(await inner.moveDoc(id, folderId))
  }

  const createFolder: Store['createFolder'] = async (input) => {
    const { e2ee, ...rest } = input
    const asE2ee = e2ee === true || (await isE2eeFolder(rest.parentId))
    return inner.createFolder(asE2ee ? { ...rest, e2ee: true } : rest)
  }

  const moveFolder: Store['moveFolder'] = async (id, parentId) => {
    if (parentId) {
      const folders = await inner.listFolders()
      const folder = folders.find((f) => f.id === id)
      const parent = folders.find((f) => f.id === parentId)
      if (parent?.e2ee === true && folder?.e2ee !== true) throw new E2eeStoreError('e2ee-folder')
    }
    return inner.moveFolder(id, parentId)
  }

  // move-up 으로 금고 폴더 아래에 일반 문서·폴더가 올라가면 막는다 (4.5)
  const removeFolder: Store['removeFolder'] = async (id, mode) => {
    if (mode !== 'delete-all') {
      const folders = await inner.listFolders()
      const folder = folders.find((f) => f.id === id)
      const parent = folder?.parentId ? folders.find((f) => f.id === folder.parentId) : undefined
      if (parent?.e2ee === true) {
        const plainChildFolder = folders.some((f) => f.parentId === id && f.e2ee !== true)
        const docs = plainChildFolder ? [] : await inner.list()
        if (plainChildFolder || docs.some((d) => d.folderId === id && d.e2eeKey === undefined)) throw new E2eeStoreError('e2ee-folder')
      }
    }
    return inner.removeFolder(id, mode)
  }

  const serverInner = inner as Partial<ServerStore>
  serverInner.setE2eeCopyMaker?.(async (source, copyId) => {
    const mk = currentMasterKey()
    if (!mk) return null
    return makeE2eeConflictCopy(mk, source, copyId)
  })

  const wrapped = {
    ...inner,
    list: async () => Promise.all((await inner.list()).map(decode)),
    get: async (id: string) => {
      const row = await inner.get(id)
      return row ? decode(row) : null
    },
    create,
    update,
    moveDoc,
    setPinned: async (id: string, pinned: boolean) => decode(await inner.setPinned(id, pinned)),
    createFolder,
    moveFolder,
    removeFolder,
    clearPlainCache,
    resumeAfterUnlock: () => {
      serverInner.resumeE2eeConflicts?.()
    },
  } as S & E2eeStore
  if (serverInner.refreshDocFromServer) {
    const refresh = serverInner.refreshDocFromServer
    ;(wrapped as unknown as ServerStore).refreshDocFromServer = async (id: string) => {
      const row = await refresh(id)
      return row ? decode(row) : null
    }
  }
  // 펼치면 게터가 값이 되므로 syncState 는 아래 저장소를 계속 읽게 둔다
  if ('syncState' in inner) {
    Object.defineProperty(wrapped, 'syncState', { get: () => inner.syncState, enumerable: true, configurable: true })
  }
  return wrapped
}
