// 전체·폴더 내보내기 — 경로·이름·manifest 계획(순수 함수)과 스트리밍 zip 만들기·내려받기 (specs/features/F-281.md 2·3장)
import { Zip, ZipPassThrough } from 'fflate'

import { toFileName, toFolderName } from '../lib/filename'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { fromEditorText } from '../lib/lineEnding'
import { descendantFolderIds, type FolderLike } from '../lib/folderTree'
import { downloadBlob } from './exportDoc'
import type { Doc, Folder } from '../types'
import type { Notice } from './notice'

export type ExportScope = { kind: 'all' } | { kind: 'folder'; folderId: string }

export type WorkspaceManifestFolder = { id: string; name: string; parentId: string | null; path: string }
export type WorkspaceManifestDoc = {
  id: string
  path: string
  title: string
  folderId: string | null
  lineEnding: Doc['lineEnding']
  createdAt: number
  updatedAt: number
  pinnedAt: number | null
}
export type WorkspaceManifest = {
  format: 1
  exportedAt: number
  scope: 'all' | 'folder'
  rootFolderId: string | null
  folders: WorkspaceManifestFolder[]
  docs: WorkspaceManifestDoc[]
}

export type PlanDirectory = {
  folderId: string | null // null 은 zip 루트
  path: string // '' 는 zip 루트
  docs: Array<{ doc: Doc; path: string }>
}

export type WorkspacePlan = {
  zipFilename: string
  manifest: WorkspaceManifest
  directories: PlanDirectory[] // 루트 먼저, 그다음 폴더가 부모 → 자식 순 (3.5 스트리밍 순서와 같다)
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// createdAt 오름차순, 같으면 id 사전순 (3.2)
function byCreatedThenId<T extends { createdAt: number; id: string }>(a: T, b: T): number {
  return a.createdAt - b.createdAt || compareId(a.id, b.id)
}

// 같은 디렉터리 안 같은 종류(폴더끼리/문서끼리) 이름 충돌을 훑은 순서대로 " (n)" 을 붙여 해소한다 (3.2)
function resolveSiblingNames<T>(
  itemsInOrder: T[],
  baseName: (item: T) => string,
  withSuffix: (base: string, n: number) => string,
  reserved: string[] = [],
): Map<T, string> {
  const used = new Set(reserved.map((r) => r.toLowerCase()))
  const result = new Map<T, string>()
  for (const item of itemsInOrder) {
    const base = baseName(item)
    let candidate = base
    let n = 2
    while (used.has(candidate.toLowerCase())) {
      candidate = withSuffix(base, n)
      n += 1
    }
    used.add(candidate.toLowerCase())
    result.set(item, candidate)
  }
  return result
}

function docFileSuffix(base: string, n: number): string {
  return base.replace(/\.md$/, ` (${n}).md`)
}

function folderNameSuffix(base: string, n: number): string {
  return `${base} (${n})`
}

// rootFolderId 아래 폴더 트리를 훑어 폴더 id → zip 경로를 만든다. 부모가 자식보다 먼저 오는 순서로 반환한다 (3.4)
function buildFolderPaths(
  folders: Folder[],
  rootFolderId: string | null,
): { pathById: Map<string, string>; orderedFolders: Folder[] } {
  const byParent = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const list = byParent.get(f.parentId) ?? []
    list.push(f)
    byParent.set(f.parentId, list)
  }
  for (const list of byParent.values()) list.sort(byCreatedThenId)

  const pathById = new Map<string, string>()
  const orderedFolders: Folder[] = []

  function walk(parentId: string | null, parentPath: string) {
    const children = byParent.get(parentId) ?? []
    // 생성할 attachments/ 와 섞이지 않게 예약어로 민다 (3.2)
    const names = resolveSiblingNames(children, (f) => toFolderName(f.name), folderNameSuffix, ['attachments'])
    for (const f of children) {
      const name = names.get(f)!
      const path = parentPath ? `${parentPath}/${name}` : name
      pathById.set(f.id, path)
      orderedFolders.push(f)
      walk(f.id, path)
    }
  }
  walk(rootFolderId, '')

  return { pathById, orderedFolders }
}

// 문서를 디렉터리(폴더 id, 루트는 rootFolderId)별로 묶어 zip 경로를 만든다 (3.2)
function buildDocPaths(
  docs: Doc[],
  folderPaths: Map<string, string>,
  rootFolderId: string | null,
): Map<string, string> {
  const sorted = [...docs].sort(byCreatedThenId)
  const byDir = new Map<string, Doc[]>() // key: folder id, 루트는 ''
  for (const d of sorted) {
    const key = d.folderId === rootFolderId ? '' : (d.folderId as string)
    const list = byDir.get(key) ?? []
    list.push(d)
    byDir.set(key, list)
  }

  const result = new Map<string, string>()
  for (const [dirKey, list] of byDir) {
    const dirPath = dirKey === '' ? '' : (folderPaths.get(dirKey) ?? '')
    const names = resolveSiblingNames(list, (d) => toFileName(d.title), docFileSuffix)
    for (const d of list) {
      const name = names.get(d)!
      result.set(d.id, dirPath ? `${dirPath}/${name}` : name)
    }
  }
  return result
}

function formatLocalDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 대상 고르기·경로·이름 충돌·manifest 계획 — 순수 함수 (F-281.md 2장·6장 2단계)
export function planWorkspaceExport({
  docs,
  folders,
  scope,
  now,
}: {
  docs: Doc[]
  folders: Folder[]
  scope: ExportScope
  now: number
}): WorkspacePlan {
  // 내 소유 문서만 — role 이 'owner' 이거나 없는(undefined) 것 (3.1)
  const ownedDocs = docs.filter((d) => d.role === 'owner' || d.role === undefined)

  const rootFolderId = scope.kind === 'folder' ? scope.folderId : null

  let scopedFolders: Folder[]
  let scopedDocs: Doc[]
  if (scope.kind === 'all') {
    scopedFolders = folders
    scopedDocs = ownedDocs
  } else {
    const ids = new Set(descendantFolderIds(folders as FolderLike[], scope.folderId))
    scopedFolders = folders.filter((f) => ids.has(f.id) && f.id !== scope.folderId)
    scopedDocs = ownedDocs.filter((d) => d.folderId != null && ids.has(d.folderId))
  }

  const { pathById: folderPaths, orderedFolders } = buildFolderPaths(scopedFolders, rootFolderId)
  const docPaths = buildDocPaths(scopedDocs, folderPaths, rootFolderId)

  const directories: PlanDirectory[] = []
  const docsByDir = new Map<string, Array<{ doc: Doc; path: string }>>()
  for (const d of scopedDocs) {
    const key = d.folderId === rootFolderId ? '' : (d.folderId as string)
    const list = docsByDir.get(key) ?? []
    list.push({ doc: d, path: docPaths.get(d.id)! })
    docsByDir.set(key, list)
  }
  // 훑은 순서(createdAt 오름차순, 같으면 id) 그대로 zip 에 넣는다
  for (const list of docsByDir.values()) list.sort((a, b) => byCreatedThenId(a.doc, b.doc))

  directories.push({ folderId: rootFolderId, path: '', docs: docsByDir.get('') ?? [] })
  for (const f of orderedFolders) {
    directories.push({ folderId: f.id, path: folderPaths.get(f.id)!, docs: docsByDir.get(f.id) ?? [] })
  }

  let zipFilename: string
  if (scope.kind === 'all') {
    zipFilename = `${formatLocalDate(now)}-export.zip`
  } else {
    const rootFolder = folders.find((f) => f.id === scope.folderId)
    zipFilename = `${toFolderName(rootFolder?.name ?? '')}.zip`
  }

  const manifestFolders: WorkspaceManifestFolder[] = orderedFolders.map((f) => ({
    id: f.id,
    name: f.name,
    parentId: f.parentId,
    path: folderPaths.get(f.id)!,
  }))
  const manifestDocs: WorkspaceManifestDoc[] = scopedDocs
    .map((d) => ({
      id: d.id,
      path: docPaths.get(d.id)!,
      title: d.title,
      folderId: d.folderId,
      lineEnding: d.lineEnding,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      pinnedAt: d.pinnedAt ?? null,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const manifest: WorkspaceManifest = {
    format: 1,
    exportedAt: now,
    scope: scope.kind,
    rootFolderId,
    folders: manifestFolders,
    docs: manifestDocs,
  }

  return { zipFilename, manifest, directories }
}

export type WorkspaceExportStore = {
  getAttachment(id: string): Promise<{ id: string; ext: string; blob: { arrayBuffer(): Promise<ArrayBuffer> } } | null>
}

function concatChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

// 저장소를 읽어 스트리밍 zip 을 만든다. DOM 없이 단위 테스트할 수 있는 순수한 부분 (F-281.md 3.5, 6장 3단계)
export async function exportWorkspace({
  plan,
  store,
  onProgress,
  onChunk,
}: {
  plan: WorkspacePlan
  store: WorkspaceExportStore
  onProgress?: (p: { done: number; total: number }) => void
  onChunk?: (chunk: Uint8Array) => void
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; missingCount: number; docCount: number }> {
  const total = plan.directories.reduce((sum, d) => sum + d.docs.length, 0)
  const chunks: Uint8Array[] = []
  const zip = new Zip((_err, chunk) => {
    if (chunk) {
      chunks.push(chunk)
      onChunk?.(chunk)
    }
  })

  function addFile(path: string, bytes: Uint8Array) {
    const f = new ZipPassThrough(path)
    zip.add(f)
    f.push(bytes, true)
  }

  addFile('manifest.json', new TextEncoder().encode(JSON.stringify(plan.manifest, null, 2)))

  let done = 0
  const missingIds = new Set<string>()

  for (const dir of plan.directories) {
    const usedIds = new Set<string>()
    for (const { doc, path } of dir.docs) {
      const bytes = new TextEncoder().encode(fromEditorText(doc.content, doc.lineEnding))
      addFile(path, bytes)
      done += 1
      onProgress?.({ done, total })
      for (const id of extractAttachmentRefs(doc.content)) usedIds.add(id)
    }
    for (const id of usedIds) {
      const record = await store.getAttachment(id)
      if (!record) {
        missingIds.add(id)
        continue
      }
      const attBytes = new Uint8Array(await record.blob.arrayBuffer())
      const attPath = dir.path ? `${dir.path}/attachments/${record.id}.${record.ext}` : `attachments/${record.id}.${record.ext}`
      addFile(attPath, attBytes)
    }
  }

  zip.end()

  return { bytes: concatChunks(chunks), missingCount: missingIds.size, docCount: total }
}

export type WorkspaceExportSourceStore = WorkspaceExportStore & {
  list(): Promise<Doc[]>
  listFolders(): Promise<Folder[]>
}

// 진입점 — 목록 읽기 → 계획 → zip → 내려받기 → 알림. App.tsx 는 flush 대기·오프라인 판정만 하고 이 함수를 부른다 (3.1·3.8)
export async function downloadWorkspaceExport({
  store,
  scope,
  now = Date.now(),
  onProgress,
  onNotice,
}: {
  store: WorkspaceExportSourceStore
  scope: ExportScope
  now?: number
  onProgress?: (p: { done: number; total: number }) => void
  onNotice?: (notice: Notice) => void
}): Promise<void> {
  let docs: Doc[]
  let folders: Folder[]
  try {
    ;[docs, folders] = await Promise.all([store.list(), store.listFolders()])
  } catch {
    onNotice?.({ type: 'error', message: '내보내지 못했습니다. 연결을 확인하세요.' })
    return
  }

  const plan = planWorkspaceExport({ docs, folders, scope, now })
  const total = plan.directories.reduce((sum, d) => sum + d.docs.length, 0)
  if (total === 0) {
    onNotice?.({ type: 'info', message: '내보낼 문서가 없습니다.' })
    return
  }

  try {
    const result = await exportWorkspace({ plan, store, onProgress })
    downloadBlob(new Blob([result.bytes], { type: 'application/zip' }), plan.zipFilename)
    onNotice?.({ type: 'info', message: `문서 ${result.docCount}개를 내보냈습니다.` })
    if (result.missingCount > 0) {
      onNotice?.({ type: 'warn', message: `이미지 ${result.missingCount}개를 찾을 수 없어 빼고 내보냈습니다.` })
    }
  } catch {
    onNotice?.({ type: 'error', message: '내보내지 못했습니다.' })
  }
}
