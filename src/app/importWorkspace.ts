// F-282 가져오기 — zip 읽기·파일명 디코딩·판별·계획(순수)·적용 (specs/features/F-282.md 3장)
import { Unzip, UnzipInflate } from 'fflate'

import { decodeMarkdown } from '../lib/decodeMarkdown'
import { inspectImageBytes } from '../lib/imageFile'
import type { AttachmentExt, Doc, Folder, LineEnding } from '../types'
import type { WorkspaceManifest } from './exportWorkspace'

// worker/ 를 import 하지 않는다 — 값을 다시 적는다 (F-282.md 3.10)
export const MAX_CONTENT_BYTES = 1_000_000 // worker/validate.ts MAX_CONTENT_BYTES
export const MAX_ATTACHMENT_BYTES = 5_242_880 // worker/attachments.ts MAX_ATTACHMENT_BYTES
export const MAX_TITLE_CHARS = 500 // worker/validate.ts MAX_TITLE_CHARS

// ---------- 3.4 파일명 인코딩 ----------
export function decodeZipName(raw: string): string {
  const codePoints = Array.from(raw, (ch) => ch.codePointAt(0) as number)
  if (codePoints.some((cp) => cp > 0xff)) return raw
  if (codePoints.every((cp) => cp <= 0x7f)) return raw

  const bytes = new Uint8Array(codePoints)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // 3-2 로 이어간다
  }
  try {
    return new TextDecoder('euc-kr', { fatal: true }).decode(bytes)
  } catch {
    return raw
  }
}

// ---------- 3.3 zip 스트리밍 읽기 ----------
export type ZipEntry = { name: string; bytes: Uint8Array | null }

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

// bytes 가 null 이면 want() 가 false 라 읽지 않고 건너뛴 항목이다. 같은 이름이 두 번 나오면 처음 것만 나온다
export async function* readZipEntries(
  chunks: AsyncIterable<Uint8Array>,
  opts?: { want?: (name: string) => boolean },
): AsyncGenerator<ZipEntry> {
  const want = opts?.want ?? (() => true)
  const seen = new Set<string>()
  const queue: ZipEntry[] = []

  const unzipper = new Unzip((file) => {
    const name = decodeZipName(file.name)
    if (seen.has(name)) return // 같은 이름 두 번째는 조용히 버린다
    seen.add(name)
    if (!want(name)) {
      queue.push({ name, bytes: null })
      return
    }
    const parts: Uint8Array[] = []
    file.ondata = (err, chunk, final) => {
      if (err) throw err
      if (chunk && chunk.length) parts.push(chunk)
      if (final) queue.push({ name, bytes: concatChunks(parts) })
    }
    file.start()
  })
  unzipper.register(UnzipInflate)

  for await (const chunk of chunks) {
    unzipper.push(chunk, false)
    while (queue.length) yield queue.shift() as ZipEntry
  }
  unzipper.push(new Uint8Array(0), true)
  while (queue.length) yield queue.shift() as ZipEntry
}

// ---------- 경로 정규화·잡음 항목 (3.7). 볼트 가져오기(F-2019)도 같은 규칙을 쓴다 ----------
export function isNoiseEntry(path: string): boolean {
  if (path.startsWith('__MACOSX/')) return true
  const base = path.split('/').pop() ?? ''
  if (/^thumbs\.db$/i.test(base) || /^desktop\.ini$/i.test(base)) return true
  if (path.split('/').some((seg) => seg.startsWith('.'))) return true
  return false
}

// ---------- 3.5 판별과 거부 ----------
export type ZipKindResult =
  | { kind: 'workspace'; manifest: WorkspaceManifest }
  | { kind: 'plain' }
  | { kind: 'rejected'; message: string }

export function detectZipKind(manifestBytes: Uint8Array | null): ZipKindResult {
  if (!manifestBytes) return { kind: 'plain' }

  let parsed: unknown
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'plain' } // JSON 이 깨지면 우연히 이름이 같은 남의 파일로 본다
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'plain' }

  const format = (parsed as Record<string, unknown>).format
  const folders = (parsed as Record<string, unknown>).folders
  const docs = (parsed as Record<string, unknown>).docs

  if (typeof format === 'number' && format !== 1) {
    return { kind: 'rejected', message: `이 zip 은 모르는 형식(format ${format})이라 가져올 수 없습니다.` }
  }
  if (format === 1 && Array.isArray(folders) && Array.isArray(docs)) {
    return { kind: 'workspace', manifest: parsed as WorkspaceManifest }
  }
  return { kind: 'plain' }
}

export const ZIP_UNREADABLE_MESSAGE = 'zip 파일을 읽지 못했습니다. 파일이 손상되었을 수 있습니다.'

// ---------- 계획 공통 타입 (3.6) ----------
export type PlanFolder = {
  id: string // workspace: 유지할 실제 id. plain: 계획 안에서만 쓰는 식별자(적용 때 실제 id 로 바뀐다)
  name: string
  parentId: string | null // 다른 PlanFolder.id 또는 실제 존재하는 폴더 id
  action: 'existing' | 'create'
  preserveId: boolean // create 일 때 store.createFolder 에 id 를 실어 보낼지
}

type PlanDocBase = {
  path: string
  title: string
  lineEnding: LineEnding | 'auto' // 'auto' 면 적용 때 .md 바이트로 판정한다
  folderId: string | null // PlanFolder.id 또는 실제 폴더 id, null 이면 최상위
}

export type PlanDoc =
  | (PlanDocBase & {
      action: 'create' | 'create-new-id'
      id?: string
      createdAt?: number
      updatedAt?: number
      pinnedAt?: number | null
    })
  | (PlanDocBase & { action: 'update'; id: string })

export type PlanAttachment = { id: string; ext: AttachmentExt; path: string }

export type ImportPlan = {
  kind: 'workspace' | 'plain'
  folders: PlanFolder[]
  docs: PlanDoc[]
  attachments: PlanAttachment[]
  warnings: string[]
  counts: { created: number; updated: number; skipped: number; images: number }
}

// ---------- 3.6 workspace 계획 ----------
export type ExistingDocInfo = { id: string; updatedAt: number; role?: 'owner' | 'edit' | 'view' }
export type ExistingFolderInfo = { id: string; parentId: string | null }

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v > 0
}

// 볼트 가져오기(F-2019)도 같은 규칙을 쓴다 (11장)
export function titleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path
  const withoutExt = base.replace(/\.(md|markdown)$/i, '')
  return withoutExt || '제목 없는 문서'
}

type RawManifestFolder = { id?: unknown; name?: unknown; parentId?: unknown }

function buildWorkspaceFolderPlan(
  manifest: WorkspaceManifest,
  existingFolders: ExistingFolderInfo[],
): { folders: PlanFolder[]; warnings: string[] } {
  const existingIds = new Set(existingFolders.map((f) => f.id))

  const rawFoldersUnknown = (Array.isArray(manifest.folders) ? manifest.folders : []) as unknown as RawManifestFolder[]
  const rawFolders = rawFoldersUnknown.filter((f) => Boolean(f) && typeof f.id === 'string' && f.id !== '') as Array<
    RawManifestFolder & { id: string }
  >
  const manifestIds = new Set(rawFolders.map((f) => f.id))

  // scope:'folder' 인데 rootFolderId 가 내게 있으면 zip 루트를 그 폴더 안으로 넣는다 (3.6)
  let attachRootTo: string | null = null
  if (manifest.scope === 'folder' && typeof manifest.rootFolderId === 'string' && existingIds.has(manifest.rootFolderId)) {
    attachRootTo = manifest.rootFolderId
  }

  const parentOf = new Map<string, string | null>()
  for (const f of rawFolders) {
    let p = typeof f.parentId === 'string' ? f.parentId : null
    if (p != null && !existingIds.has(p) && !manifestIds.has(p)) p = null
    if (p === null && attachRootTo) p = attachRootTo
    parentOf.set(f.id, p)
  }

  // manifest 폴더끼리 부모 사슬이 순환이면 그 순환에 든 폴더를 최상위(또는 붙일 루트)로 본다 (F-2017 6장)
  const manifestParentOf = new Map<string, string | null>()
  for (const f of rawFolders) {
    const p = parentOf.get(f.id) ?? null
    manifestParentOf.set(f.id, p != null && manifestIds.has(p) ? p : null)
  }
  function inCycle(id: string): boolean {
    const seen = new Set<string>()
    let current = manifestParentOf.get(id) ?? null
    while (current !== null && !seen.has(current)) {
      if (current === id) return true
      seen.add(current)
      current = manifestParentOf.get(current) ?? null
    }
    return false
  }
  const cyclicIds = rawFolders.filter((f) => inCycle(f.id)).map((f) => f.id)
  for (const id of cyclicIds) parentOf.set(id, attachRootTo)

  // 부모가 자식보다 먼저 오도록 위상 정렬한다 (manifest.folders 순서를 믿지 않는다, 3.6)
  const order: string[] = []
  const visited = new Set<string>()
  function visit(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const p = parentOf.get(id) ?? null
    if (p != null && manifestIds.has(p)) visit(p)
    order.push(id)
  }
  for (const f of rawFolders) visit(f.id)

  const byId = new Map(rawFolders.map((f) => [f.id, f]))
  const folders: PlanFolder[] = order.map((id) => {
    const raw = byId.get(id) as RawManifestFolder & { id: string }
    const parentId = parentOf.get(id) ?? null
    const name = typeof raw.name === 'string' && raw.name ? raw.name : '새 폴더'
    if (existingIds.has(id)) {
      return { id, name, parentId, action: 'existing', preserveId: true }
    }
    return { id, name, parentId, action: 'create', preserveId: true }
  })

  return { folders, warnings: [] }
}

type RawManifestDoc = {
  id?: unknown
  path?: unknown
  title?: unknown
  lineEnding?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  pinnedAt?: unknown
  folderId?: unknown
}

function buildWorkspaceDocPlan({
  manifest,
  existingDocs,
  zipPaths,
  folderIds,
  now,
}: {
  manifest: WorkspaceManifest
  existingDocs: ExistingDocInfo[]
  zipPaths: Set<string>
  folderIds: Set<string>
  now: number
}): { docs: PlanDoc[]; warnings: string[]; counts: { created: number; updated: number; skipped: number } } {
  const existingById = new Map(existingDocs.map((d) => [d.id, d]))
  const myDocIds = new Set(existingDocs.filter((d) => d.role === 'owner' || d.role === undefined).map((d) => d.id))
  const sharedDocIds = new Set(existingDocs.filter((d) => d.role === 'edit' || d.role === 'view').map((d) => d.id))

  const docs: PlanDoc[] = []
  let created = 0
  let updated = 0
  let skipped = 0
  let invalidCount = 0
  let missingInZipCount = 0
  let sharedIdCount = 0

  const rawDocs = (Array.isArray(manifest.docs) ? manifest.docs : []) as RawManifestDoc[]
  for (const raw of rawDocs) {
    if (!raw || typeof raw.id !== 'string' || raw.id === '' || typeof raw.path !== 'string' || raw.path === '') {
      invalidCount++
      continue
    }
    if (!zipPaths.has(raw.path)) {
      missingInZipCount++
      continue
    }

    const title = typeof raw.title === 'string' && raw.title ? raw.title : titleFromPath(raw.path)
    const lineEnding: LineEnding | 'auto' = raw.lineEnding === 'crlf' || raw.lineEnding === 'lf' ? raw.lineEnding : 'auto'
    const createdAt = isPositiveInt(raw.createdAt) ? raw.createdAt : now
    const updatedAt = isPositiveInt(raw.updatedAt) ? raw.updatedAt : now
    const pinnedAt = isPositiveInt(raw.pinnedAt) ? raw.pinnedAt : null
    const rawFolderId = typeof raw.folderId === 'string' ? raw.folderId : null
    const folderId = rawFolderId && folderIds.has(rawFolderId) ? rawFolderId : null

    if (sharedDocIds.has(raw.id)) {
      docs.push({ action: 'create-new-id', path: raw.path, title, lineEnding, folderId, createdAt, updatedAt, pinnedAt })
      sharedIdCount++
      created++
      continue
    }
    if (!myDocIds.has(raw.id)) {
      docs.push({ action: 'create', id: raw.id, path: raw.path, title, lineEnding, folderId, createdAt, updatedAt, pinnedAt })
      created++
      continue
    }
    const existing = existingById.get(raw.id) as ExistingDocInfo
    if (updatedAt > existing.updatedAt) {
      docs.push({ action: 'update', id: raw.id, path: raw.path, title, lineEnding, folderId })
      updated++
    } else {
      skipped++
    }
  }

  const warnings: string[] = []
  if (invalidCount > 0) warnings.push(`문서 정보가 잘못돼 건너뛴 항목 ${invalidCount}개`)
  if (missingInZipCount > 0) warnings.push(`zip 에 없는 문서 ${missingInZipCount}개`)
  if (sharedIdCount > 0) warnings.push(`공유받은 문서와 id 가 같아 새 문서로 만든 것 ${sharedIdCount}개`)

  return { docs, warnings, counts: { created, updated, skipped } }
}

const WORKSPACE_ATTACHMENT_RE = /(?:^|\/)attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)$/

function collectWorkspaceAttachments(zipPaths: Set<string>, existingAttachmentIds: Set<string>): PlanAttachment[] {
  const seen = new Map<string, PlanAttachment>()
  for (const path of zipPaths) {
    const m = WORKSPACE_ATTACHMENT_RE.exec(path)
    if (!m) continue
    const id = m[1]
    if (existingAttachmentIds.has(id) || seen.has(id)) continue
    seen.set(id, { id, ext: m[2] as AttachmentExt, path })
  }
  return [...seen.values()]
}

// manifest.folders·manifest.docs 를 훑어 계획을 만든다. 전부 순수 함수 (3.6)
export function planWorkspaceImport({
  manifest,
  existingDocs,
  existingFolders,
  zipPaths,
  existingAttachmentIds,
  now,
}: {
  manifest: WorkspaceManifest
  existingDocs: ExistingDocInfo[]
  existingFolders: ExistingFolderInfo[]
  zipPaths: Set<string>
  existingAttachmentIds: Set<string>
  now: number
}): ImportPlan {
  const { folders, warnings: folderWarnings } = buildWorkspaceFolderPlan(manifest, existingFolders)
  const folderIds = new Set([...existingFolders.map((f) => f.id), ...folders.map((f) => f.id)])
  const { docs, warnings: docWarnings, counts: docCounts } = buildWorkspaceDocPlan({
    manifest,
    existingDocs,
    zipPaths,
    folderIds,
    now,
  })
  const attachments = collectWorkspaceAttachments(zipPaths, existingAttachmentIds)

  return {
    kind: 'workspace',
    folders,
    docs,
    attachments,
    warnings: [...folderWarnings, ...docWarnings],
    counts: { created: docCounts.created, updated: docCounts.updated, skipped: docCounts.skipped, images: attachments.length },
  }
}

// ---------- 3.9 적용 ----------
export type ApplyStore = {
  get(id: string): Promise<Doc | null>
  create(input: {
    title: string
    content: string
    lineEnding: LineEnding
    folderId?: string | null
    id?: string
    createdAt?: number
    updatedAt?: number
    pinnedAt?: number | null
  }): Promise<Doc>
  update(id: string, patch: { title?: string; content?: string }): Promise<Doc>
  createFolder(input: { name: string; parentId?: string | null; id?: string }): Promise<Folder>
  putAttachment(input: {
    blob: Blob
    mime: string
    ext: AttachmentExt
    width: number
    height: number
    id?: string
  }): Promise<{ id: string; ext: AttachmentExt }>
  kind?: 'idb' | 'memory' | 'server'
}

export type ApplyEntry = { name: string; bytes: Uint8Array | null }

export type ApplyResult = {
  createdCount: number
  updatedCount: number
  cancelled: boolean
  failures: string[]
  quotaSkippedCount: number
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

// 볼트 가져오기(F-2019)도 같은 규칙을 쓴다 (11장, F-282.md 3.9)
export function truncatedCopyTitle(originalTitle: string): string {
  const suffix = ' (가져오기 전)'
  const full = `${originalTitle}${suffix}`
  const chars = Array.from(full)
  if (chars.length <= MAX_TITLE_CHARS) return full
  const keep = MAX_TITLE_CHARS - suffix.length
  const titleChars = Array.from(originalTitle)
  return `${titleChars.slice(Math.max(0, titleChars.length - keep)).join('')}${suffix}`
}

// 순서: 폴더(부모 먼저) → 문서(create → update 순, 계획 순서) → 첨부. 원자성 없음 — 항목 하나 실패는 그 항목만 실패 목록에 (3.9)
export async function applyImportPlan({
  plan,
  entries,
  store,
  isCancelled,
  onProgress,
}: {
  plan: ImportPlan
  entries: AsyncIterable<ApplyEntry>
  store: ApplyStore
  isCancelled?: () => boolean
  onProgress?: (p: { done: number; total: number }) => void
}): Promise<ApplyResult> {
  const failures: string[] = []
  const folderIdMap = new Map<string, string | null>()

  for (const f of plan.folders) {
    if (f.action === 'existing') {
      folderIdMap.set(f.id, f.id)
      continue
    }
    const resolvedParent = f.parentId != null ? (folderIdMap.get(f.parentId) ?? null) : null
    try {
      const created = await store.createFolder({
        name: f.name,
        parentId: resolvedParent,
        ...(f.preserveId ? { id: f.id } : {}),
      })
      folderIdMap.set(f.id, created.id)
    } catch {
      failures.push(`${f.name} — 폴더를 만들지 못했습니다`)
      folderIdMap.set(f.id, null)
    }
  }

  function resolveFolderId(id: string | null): string | null {
    if (id == null) return null
    return folderIdMap.has(id) ? (folderIdMap.get(id) as string | null) : null
  }

  const docsByPath = new Map(plan.docs.map((d) => [d.path, d]))
  const attachmentsByPath = new Map(plan.attachments.map((a) => [a.path, a]))
  const total = plan.docs.length + plan.attachments.length

  let done = 0
  let createdCount = 0
  let updatedCount = 0
  let quotaExceeded = false
  let quotaSkippedCount = 0
  let cancelled = false

  const isServer = store.kind === 'server'

  async function processDoc(planDoc: PlanDoc, bytes: Uint8Array) {
    let decoded
    try {
      decoded = decodeMarkdown(bytes)
    } catch {
      failures.push(`${planDoc.title} — 이 문서는 UTF-8 로 읽을 수 없어 가져오지 못했습니다`)
      return
    }
    const content = decoded.text

    if (planDoc.action === 'update') {
      let existing: Doc | null = null
      try {
        existing = await store.get(planDoc.id)
      } catch {
        existing = null
      }
      if (!existing) {
        failures.push(`${planDoc.title} — 가져오지 못했습니다`)
        return
      }
      if (isServer && utf8ByteLength(content) > MAX_CONTENT_BYTES) {
        failures.push(`${planDoc.title} — 내용이 1MB 를 넘어 건너뛰었습니다`)
        return
      }
      try {
        await store.create({
          title: truncatedCopyTitle(existing.title),
          content: existing.content,
          lineEnding: existing.lineEnding,
          folderId: existing.folderId,
        })
      } catch {
        failures.push(`${planDoc.title} — 사본을 만들지 못해 갱신하지 않았습니다`)
        return
      }
      try {
        await store.update(planDoc.id, { title: planDoc.title, content })
        updatedCount++
      } catch {
        failures.push(`${planDoc.title} — 가져오지 못했습니다`)
      }
      return
    }

    if (isServer && utf8ByteLength(content) > MAX_CONTENT_BYTES) {
      failures.push(`${planDoc.title} — 내용이 1MB 를 넘어 건너뛰었습니다`)
      return
    }

    const lineEnding: LineEnding = planDoc.lineEnding === 'auto' ? decoded.lineEnding : planDoc.lineEnding
    try {
      await store.create({
        title: planDoc.title,
        content,
        lineEnding,
        folderId: resolveFolderId(planDoc.folderId),
        ...(planDoc.id !== undefined ? { id: planDoc.id } : {}),
        ...(planDoc.createdAt !== undefined ? { createdAt: planDoc.createdAt } : {}),
        ...(planDoc.updatedAt !== undefined ? { updatedAt: planDoc.updatedAt } : {}),
        ...(planDoc.pinnedAt !== undefined ? { pinnedAt: planDoc.pinnedAt } : {}),
      })
      createdCount++
    } catch {
      failures.push(`${planDoc.title} — 가져오지 못했습니다`)
    }
  }

  async function processAttachment(planAtt: PlanAttachment, bytes: Uint8Array) {
    if (quotaExceeded) {
      quotaSkippedCount++
      return
    }
    const inspected = inspectImageBytes(bytes)
    if (!inspected) {
      failures.push(`이미지(${planAtt.id})를 알 수 없는 형식이라 가져오지 못했습니다`)
      return
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      failures.push(`이미지(${planAtt.id})가 5MB 를 넘어 가져오지 못했습니다`)
      return
    }
    try {
      await store.putAttachment({
        blob: new Blob([bytes as unknown as BlobPart]),
        mime: inspected.mime,
        ext: planAtt.ext,
        width: inspected.width,
        height: inspected.height,
        id: planAtt.id,
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'quota_exceeded') {
        quotaExceeded = true
        quotaSkippedCount++
      } else {
        failures.push(`이미지(${planAtt.id})를 가져오지 못했습니다`)
      }
    }
  }

  for await (const entry of entries) {
    if (isCancelled?.()) {
      cancelled = true
      break
    }
    if (entry.bytes === null) continue

    const planDoc = docsByPath.get(entry.name)
    if (planDoc) {
      await processDoc(planDoc, entry.bytes)
      done++
      onProgress?.({ done, total })
      continue
    }
    const planAtt = attachmentsByPath.get(entry.name)
    if (planAtt) {
      await processAttachment(planAtt, entry.bytes)
      done++
      onProgress?.({ done, total })
    }
  }

  return { createdCount, updatedCount, cancelled, failures, quotaSkippedCount }
}
