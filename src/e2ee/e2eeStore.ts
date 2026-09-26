// 저장소 위 한 겹 — 금고 문서의 제목·본문을 봉투로 쓰고 읽을 때 푼다 (specs/features/F-405.md 4장, F-406.md 2·3·4장 첨부)
import type { Attachment, AttachmentExt, Doc, Folder, Store } from '../types'
import type { E2eeCopyResult, E2eeCopySource, ServerStore } from '../storage/serverStore'
import { toWebp } from '../storage/toWebp'
import { E2EE_MAX_ATTACHMENT_REFS, isPlainAttachmentTooLarge, isPlainContentTooLarge } from '../lib/e2eeLimits'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { inspectImageBytes } from '../lib/imageFile'
import { createDocKey, decryptDocField, encryptDocField, openDocKey, decryptAttachment, encryptAttachment } from './crypto'

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

// 소문자 16진수 16자 (F-156 2.1·F-406 2.2 4번과 같은 형식)
function randomAttachmentId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// 평문 이미지 mime (F-402 11장 ③, F-406 3.3 7번)
function imageMimeOf(ext: AttachmentExt): string {
  return `image/${ext === 'jpg' ? 'jpeg' : ext}`
}

export function withE2ee<S extends Store>(inner: S, deps: E2eeStoreDeps): S & E2eeStore {
  // 메모리에만 둔다 (4.4) — 문서 키는 감싼 키마다, 평문은 문서마다 한 벌
  const docKeys = new Map<string, Promise<CryptoKey>>()
  const plainMemo = new Map<string, PlainMemo>()
  const failureLogged = new Set<string>()
  // 첨부 복호화 실패 로그는 페이지 수명에 첨부 id 당 한 번 (F-406 3.3 4번)
  const attachmentFailureLogged = new Set<string>()
  let lastMasterKey: CryptoKey | null = null
  // indexes 단계가 clearPlainCache 로 올린다 — indexes 뒤에 끝난 복호화는 버린다 (F-406 3.3, 3.4)
  let generation = 0

  function clearPlainCache() {
    docKeys.clear()
    plainMemo.clear()
    generation++
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

  function logAttachmentFailure(id: string) {
    if (attachmentFailureLogged.has(id)) return
    attachmentFailureLogged.add(id)
    console.error('e2ee_attachment_decrypt_failed', id)
  }

  // 기억 속 금고 문서 평문에서 attachments/{id}.{ext} 를 찾는다 — 못 찾으면 힌트 없이 (4.3, 3.3 1번)
  function findAttachmentExtHint(id: string): { ext: AttachmentExt } | undefined {
    const re = new RegExp(`attachments/${id}\\.(png|jpg|gif|webp)`)
    for (const memo of plainMemo.values()) {
      const m = re.exec(memo.content)
      if (m) return { ext: m[1] as AttachmentExt }
    }
    return undefined
  }

  // 금고 첨부 올리기 — 판정 순서는 2.2, 계약은 2.1
  const putAttachment: Store['putAttachment'] = async (input) => {
    if (!input.e2ee) return inner.putAttachment(input)
    const mk = currentMasterKey()
    if (!mk) throw new E2eeStoreError('locked')

    let blob = input.blob
    let ext = input.ext
    let mime = input.mime
    // 아래 저장소가 server 이고 png·jpg 면 암호화 전에 WebP 로 — 서버 저장소 평문 경로와 같은 규칙 (2.2 4번 2단계)
    if (inner.kind === 'server' && (ext === 'png' || ext === 'jpg')) {
      const converted = await toWebp(blob)
      if (converted !== blob) {
        blob = converted
        ext = 'webp'
        mime = 'image/webp'
      }
    }

    const plainBytes = new Uint8Array(await blob.arrayBuffer())
    if (isPlainAttachmentTooLarge(plainBytes.length)) throw new E2eeStoreError('too-large')

    // 첨부 id 를 여기서 정한다 — AAD 에 id 가 들어가므로 아래 저장소가 정하게 두지 않는다 (2.2 4번 4단계)
    let id = randomAttachmentId()
    while (await inner.getAttachment(id)) {
      id = randomAttachmentId()
    }

    const envelope = await encryptAttachment(mk, id, plainBytes)
    const envelopeBlob = new Blob([envelope as BlobPart], { type: 'application/octet-stream' })
    await inner.putAttachment({ blob: envelopeBlob, mime, ext, width: input.width, height: input.height, id, e2ee: true })
    return { id, ext }
  }

  // 금고 첨부 받기 — 계약은 3.3
  const getAttachment: Store['getAttachment'] = async (id, hint) => {
    // 시작할 때의 MK 와 세대 값을 적는다 — 부르고 기다리는 동안 clearPlainCache 가 끼어들 수 있다 (3.3 3번·7.1 U7)
    const startGeneration = generation
    const startMk = currentMasterKey()
    const record = await inner.getAttachment(id, hint ?? findAttachmentExtHint(id))
    if (!record || !record.e2ee) return record
    if (!startMk) return null

    let plainBytes: Uint8Array
    try {
      const envelopeBytes = new Uint8Array(await record.blob.arrayBuffer())
      plainBytes = await decryptAttachment(startMk, id, envelopeBytes)
    } catch {
      logAttachmentFailure(id)
      return null
    }

    const info = inspectImageBytes(plainBytes)
    if (!info) {
      logAttachmentFailure(id)
      return null
    }

    // 끝날 때 다시 본다 — indexes 단계 뒤 끝난 복호화는 버린다 (3.3 6번)
    if (generation !== startGeneration || deps.getMasterKey() !== startMk) return null

    const result: Attachment = {
      ...record,
      blob: new Blob([plainBytes as BlobPart], { type: imageMimeOf(record.ext) }),
      size: plainBytes.length,
      width: info.width,
      height: info.height,
      e2ee: true,
    }
    return result
  }

  // 금고로 옮기기·빼기 — 옮기기는 이 id 를 AAD 로 봉투, 빼기는 평문 그대로 (F-407 5.1)
  const setDocE2ee: NonNullable<Store['setDocE2ee']> = async (id, input) => {
    const innerSet = inner.setDocE2ee!
    if (!input.e2ee) {
      const res = await innerSet(id, { e2ee: false, title: input.title, content: input.content, e2eeKey: null, attachmentRefs: null })
      plainMemo.delete(id)
      return { doc: await decode(res.doc), purged: res.purged }
    }
    const mk = currentMasterKey()
    if (!mk) throw new E2eeStoreError('locked')
    const refs = checkPlainContent(input.content)
    const { docKey, wrappedDocKey } = await createDocKey(mk)
    const titleEnvelope = await encryptDocField(docKey, id, 'title', input.title)
    const contentEnvelope = await encryptDocField(docKey, id, 'content', input.content)
    const res = await innerSet(id, { e2ee: true, title: titleEnvelope, content: contentEnvelope, e2eeKey: wrappedDocKey, attachmentRefs: refs })
    docKeys.set(wrappedDocKey, Promise.resolve(docKey))
    plainMemo.set(id, { e2eeKey: wrappedDocKey, titleEnvelope, contentEnvelope, title: input.title, content: input.content })
    return { doc: await decode(res.doc), purged: res.purged }
  }

  // 곧바로 올리기 — 금고면 암호화하되 WebP 로 바꾸지 않는다, 바이트·확장자 그대로 (F-407 5.1)
  const putAttachmentNow: NonNullable<Store['putAttachmentNow']> = async (input) => {
    const innerPut = inner.putAttachmentNow!
    if (!input.e2ee) return innerPut(input)
    const mk = currentMasterKey()
    if (!mk) throw new E2eeStoreError('locked')
    const plainBytes = new Uint8Array(await input.blob.arrayBuffer())
    if (isPlainAttachmentTooLarge(plainBytes.length)) throw new E2eeStoreError('too-large')
    let { width, height } = input
    if (!(width >= 1 && height >= 1)) {
      const info = inspectImageBytes(plainBytes)
      if (info) ({ width, height } = info)
    }
    let id = randomAttachmentId()
    while (await inner.getAttachment(id)) {
      id = randomAttachmentId()
    }
    const envelope = await encryptAttachment(mk, id, plainBytes)
    const envelopeBlob = new Blob([envelope as BlobPart], { type: 'application/octet-stream' })
    await innerPut({ blob: envelopeBlob, mime: input.mime, ext: input.ext, width, height, id, e2ee: true })
    return { id, ext: input.ext }
  }

  const wrapped = {
    ...inner,
    ...(inner.setDocE2ee ? { setDocE2ee } : {}),
    ...(inner.putAttachmentNow ? { putAttachmentNow } : {}),
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
    putAttachment,
    getAttachment,
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
  // 캐시 먼저 셸 — listCached 는 문서를 decode 로 풀어 내보낸다. 폴더는 그대로 넘긴다 (F-2042 3.6)
  if (serverInner.listCached) {
    const listCached = serverInner.listCached
    ;(wrapped as unknown as ServerStore).listCached = async () => {
      const { docs, folders } = await listCached()
      return { docs: await Promise.all(docs.map(decode)), folders }
    }
  }
  // 펼치면 게터가 값이 되므로 syncState 는 아래 저장소를 계속 읽게 둔다
  if ('syncState' in inner) {
    Object.defineProperty(wrapped, 'syncState', { get: () => inner.syncState, enumerable: true, configurable: true })
  }
  return wrapped
}
