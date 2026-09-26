// F-2019 볼트 가져오기 — 훑기·넣을 폴더·계획·적용 (specs/features/F-2019.md 4~9장)
import { decodeMarkdown } from '../lib/decodeMarkdown'
import { toEditorText, fromEditorText } from '../lib/lineEnding'
import { inspectImageBytes } from '../lib/imageFile'
import { findVaultEmbeds, embedsToImageBlocks, listImageBlocks, type VaultEmbed, type EmbedBlock } from '../lib/obsidianImage'
import { createWikiResolver, shortestWikiTarget, type WikiResolver, type WikiDocRef, type WikiFolderRef } from '../lib/wikiResolve'
import { scanWikiLinks } from '../lib/wikiGraph'
import { toObsidianFileName, toObsidianFolderName } from '../lib/filename'
import { selectExportScope, planExportPaths, type ExportScope } from './exportWorkspace'
import { flattenFolderTree } from '../lib/folderTree'
import { folderPathMap } from './searchIndex'
import { isNoiseEntry, titleFromPath, truncatedCopyTitle, MAX_CONTENT_BYTES, MAX_ATTACHMENT_BYTES } from './importWorkspace'
import type { AttachmentExt, Doc, Folder, LineEnding } from '../types'

// ---------- 공통 도우미 ----------
const nfc = (s: string): string => s.normalize('NFC')
const fold = (s: string): string => nfc(s).toLowerCase()
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}
function baseOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}
function stemOf(base: string): string {
  return base.replace(/\.(md|markdown)$/i, '')
}
// 이미지 파일 이름에서 확장자를 뗀다 (7.5 alt 기본값) — stemOf 는 .md/.markdown 만 떼므로 별도로 둔다
function imageStemOf(base: string): string {
  const i = base.lastIndexOf('.')
  return i <= 0 ? base : base.slice(0, i)
}

// 정확히 소문자 '-vault' 로 끝나고 나머지가 비지 않을 때만 뗀다 (F-2019.md 4.4, 17장 Q11)
function stripVaultSuffix(name: string): string {
  const suffix = '-vault'
  if (name.endsWith(suffix) && name.length > suffix.length) return name.slice(0, -suffix.length)
  return name
}

function isDocPath(p: string): boolean {
  return /\.(md|markdown)$/i.test(p)
}
function isImageExtPath(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p)
}

async function sha256Hex16(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  const arr = new Uint8Array(digest).slice(0, 8)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const ATTACHMENT_REF_RE = /attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)/g
function extractAttachmentRefPairs(content: string): Array<{ id: string; ext: AttachmentExt }> {
  const pairs = new Map<string, AttachmentExt>()
  let m: RegExpExecArray | null
  ATTACHMENT_REF_RE.lastIndex = 0
  while ((m = ATTACHMENT_REF_RE.exec(content))) pairs.set(m[1], m[2] as AttachmentExt)
  return [...pairs].map(([id, ext]) => ({ id, ext }))
}

// ---------- 6장 1차 훑기 ----------
export type VaultRoot = { kind: 'zip'; fileName: string } | { kind: 'folder' }
export type VaultEntry = { name: string; bytes: Uint8Array | null }

export function vaultWantsBytes(name: string): boolean {
  return /\.(md|markdown|png|jpe?g|gif|webp)$/i.test(name)
}

// 폴더 입구용 — want 가 참인 것만 arrayBuffer 로 읽어 흘린다
export function filesAsEntries(
  files: ReadonlyArray<{ path: string; file: Blob }>,
  want: (name: string) => boolean,
): AsyncIterable<VaultEntry> {
  return (async function* () {
    for (const { path, file } of files) {
      if (!want(path)) {
        yield { name: path, bytes: null }
        continue
      }
      const buf = await file.arrayBuffer()
      yield { name: path, bytes: new Uint8Array(buf) }
    }
  })()
}

export type ScannedEmbed = VaultEmbed & { resolvedImagePath: string | null }

export type VaultDocScan = {
  path: string // NFC, 볼트 루트 기준
  originalPath: string // 2차 훑기에서 찾을 원래 이름
  dirPath: string // NFC 디렉터리 경로. '' 는 루트
  title: string // NFC 줄기
  content: string // LF 로 정규화한 본문(읽기 성공했을 때만 의미 있음)
  lineEnding: LineEnding
  unreadable: boolean // UTF-8 로 못 읽음
  readFailed: boolean // 그 밖의 읽기 실패
  embeds: ScannedEmbed[]
  attachmentRefs: Array<{ id: string; ext: AttachmentExt }>
}

export type VaultImageScan = {
  path: string // NFC
  originalPath: string
  attachmentId: string | null
  ext: AttachmentExt | null
  size: number
  unreadable: boolean // 형식 모름 또는 읽기 실패
  tooLarge: boolean
}

export type VaultScan = {
  readonly vaultName: string
  readonly docs: readonly VaultDocScan[]
  readonly images: readonly VaultImageScan[]
  readonly dirs: readonly string[] // NFC 디렉터리 경로 전체(문서·이미지가 있는 디렉터리와 그 조상)
  readonly nonMdSkipped: number
  readonly traversalSkipped: number
  readonly vaultDocResolver: WikiResolver // 7.8 볼트 해석기
}

const HEX_NAME_RE = /^[0-9a-f]{16}\.(png|jpg|gif|webp)$/

async function classifyImage(
  nfcPath: string,
  originalPath: string,
  bytes: Uint8Array | null,
  digest: (b: Uint8Array) => Promise<string>,
): Promise<VaultImageScan> {
  if (bytes === null) {
    return { path: nfcPath, originalPath, attachmentId: null, ext: null, size: 0, unreadable: true, tooLarge: false }
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return { path: nfcPath, originalPath, attachmentId: null, ext: null, size: bytes.length, unreadable: false, tooLarge: true }
  }
  const inspected = inspectImageBytes(bytes)
  if (!inspected) {
    return { path: nfcPath, originalPath, attachmentId: null, ext: null, size: bytes.length, unreadable: true, tooLarge: false }
  }
  const base = baseOf(nfcPath)
  const m = HEX_NAME_RE.exec(base)
  if (m && m[1] === inspected.ext) {
    return { path: nfcPath, originalPath, attachmentId: base.slice(0, 16), ext: inspected.ext, size: bytes.length, unreadable: false, tooLarge: false }
  }
  const id = await digest(bytes)
  return { path: nfcPath, originalPath, attachmentId: id, ext: inspected.ext, size: bytes.length, unreadable: false, tooLarge: false }
}

function parentIdOfDir(d: string): string | null {
  const p = dirOf(d)
  return p === '' ? null : p
}

// '/' 로 나눈 조각, './' '../' 를 baseDir 기준으로 푼다. 루트를 벗어나면 null (7.3 markdown ①)
function resolveRelative(baseDir: string, rel: string): string | null {
  const stack = baseDir === '' ? [] : baseDir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (stack.length === 0) return null
      stack.pop()
    } else {
      stack.push(seg)
    }
  }
  return stack.join('/')
}

function lookupImageByPath(imagesByPath: Map<string, VaultImageScan>, path: string): VaultImageScan | null {
  const exact = imagesByPath.get(nfc(path))
  if (exact) return exact
  const key = fold(path)
  for (const [p, img] of imagesByPath) {
    if (fold(p) === key) return img
  }
  return null
}

// markdown 임베드 대상 찾기 — ① 문서 디렉터리 기준 → ② 볼트 루트 → ③ 이름이 하나뿐이면 그것 (7.3)
function resolveMarkdownEmbedTarget(
  target: string,
  docDir: string,
  imagesByPath: Map<string, VaultImageScan>,
  allImagePaths: readonly string[],
): VaultImageScan | null {
  const hasLeadingSlash = target.startsWith('/')
  if (!hasLeadingSlash) {
    const resolved = resolveRelative(docDir, target)
    if (resolved !== null) {
      const hit = lookupImageByPath(imagesByPath, resolved)
      if (hit) return hit
    }
  }
  const rootRelative = hasLeadingSlash ? target.slice(1) : target
  const hitRoot = lookupImageByPath(imagesByPath, rootRelative)
  if (hitRoot) return hitRoot

  const name = baseOf(rootRelative)
  const matches = allImagePaths.filter((p) => fold(baseOf(p)) === fold(name))
  return matches.length === 1 ? (imagesByPath.get(matches[0]) ?? null) : null
}

export async function scanVault(input: {
  root: VaultRoot
  entries: AsyncIterable<VaultEntry>
  digest?: (bytes: Uint8Array) => Promise<string>
}): Promise<VaultScan> {
  const digest = input.digest ?? sha256Hex16

  const cleaned: Array<{ path: string; bytes: Uint8Array | null }> = []
  let traversalSkipped = 0
  for await (const e of input.entries) {
    const p = e.name.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '')
    if (p === '' || p.endsWith('/')) continue
    if (p.split('/').includes('..')) {
      traversalSkipped++
      continue
    }
    if (isNoiseEntry(p)) continue
    cleaned.push({ path: p, bytes: e.bytes })
  }

  let vaultName: string
  // raw: 2차 훑기(applyVaultImport)에서 다시 찾을 원래(안 벗긴) 이름. rel: 볼트 루트 기준 상대 경로
  let stripped: Array<{ raw: string; rel: string; bytes: Uint8Array | null }>

  if (input.root.kind === 'folder') {
    const withFirst = cleaned.filter((e) => e.path.includes('/'))
    const first = withFirst[0]?.path.split('/')[0] ?? ''
    vaultName = first
    stripped = withFirst.map((e) => ({ raw: e.path, rel: e.path.slice(first.length + 1), bytes: e.bytes }))
  } else {
    const firstSegs = new Set(cleaned.map((e) => e.path.split('/')[0]))
    const hasRootFile = cleaned.some((e) => !e.path.includes('/'))
    let strip = ''
    if (cleaned.length > 0 && !hasRootFile && firstSegs.size === 1) strip = `${[...firstSegs][0]}/`
    vaultName = strip ? strip.slice(0, -1) : input.root.fileName.replace(/\.zip$/i, '')
    stripped = cleaned.map((e) => ({ raw: e.path, rel: strip ? e.path.slice(strip.length) : e.path, bytes: e.bytes }))
  }
  vaultName = stripVaultSuffix(nfc(vaultName))

  type RawDoc = { path: string; originalPath: string; dirPath: string; title: string; bytes: Uint8Array | null }
  const rawDocs: RawDoc[] = []
  const images: VaultImageScan[] = []
  let nonMdSkipped = 0

  for (const { raw, rel, bytes } of stripped) {
    const nfcPath = nfc(rel)
    if (isDocPath(nfcPath)) {
      rawDocs.push({ path: nfcPath, originalPath: raw, dirPath: dirOf(nfcPath), title: nfc(titleFromPath(nfcPath)), bytes })
    } else if (isImageExtPath(nfcPath)) {
      images.push(await classifyImage(nfcPath, raw, bytes, digest))
    } else {
      nonMdSkipped++
    }
  }

  const dirSet = new Set<string>()
  for (const p of [...rawDocs.map((d) => d.path), ...images.map((i) => i.path)]) {
    let d = dirOf(p)
    while (d !== '' && !dirSet.has(d)) {
      dirSet.add(d)
      d = dirOf(d)
    }
  }
  const dirs = [...dirSet]

  const imagesByPath = new Map(images.map((img) => [img.path, img]))
  const allImagePaths = images.map((img) => img.path)

  const sortedImages = images.slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const imageResolverDocs: WikiDocRef[] = sortedImages.map((img) => ({
    id: img.path,
    title: baseOf(img.path),
    folderId: dirOf(img.path) === '' ? null : dirOf(img.path),
  }))
  const imageResolverFolders: WikiFolderRef[] = dirs.map((d) => ({ id: d, name: baseOf(d), parentId: parentIdOfDir(d) }))
  const vaultImageResolver = createWikiResolver(imageResolverDocs, imageResolverFolders)

  const docs: VaultDocScan[] = rawDocs.map((d) => {
    if (d.bytes === null) {
      return { path: d.path, originalPath: d.originalPath, dirPath: d.dirPath, title: d.title, content: '', lineEnding: 'lf', unreadable: false, readFailed: true, embeds: [], attachmentRefs: [] }
    }
    let decoded
    try {
      decoded = decodeMarkdown(d.bytes)
    } catch {
      return { path: d.path, originalPath: d.originalPath, dirPath: d.dirPath, title: d.title, content: '', lineEnding: 'lf', unreadable: true, readFailed: false, embeds: [], attachmentRefs: [] }
    }
    const contentLF = toEditorText(decoded.text)
    const rawEmbeds = findVaultEmbeds(contentLF)
    const docFolderId = d.dirPath === '' ? null : d.dirPath
    const embeds: ScannedEmbed[] = rawEmbeds.map((embed) => {
      if (embed.kind !== 'image') return { ...embed, resolvedImagePath: null }
      if (embed.syntax === 'wiki') {
        const hit = vaultImageResolver.resolve(embed.target, docFolderId)
        return { ...embed, resolvedImagePath: hit ? hit.id : null }
      }
      const hit = resolveMarkdownEmbedTarget(embed.target, d.dirPath, imagesByPath, allImagePaths)
      return { ...embed, resolvedImagePath: hit ? hit.path : null }
    })
    return {
      path: d.path,
      originalPath: d.originalPath,
      dirPath: d.dirPath,
      title: d.title,
      content: contentLF,
      lineEnding: decoded.lineEnding,
      unreadable: false,
      readFailed: false,
      embeds,
      attachmentRefs: extractAttachmentRefPairs(contentLF),
    }
  })

  const docResolverDocs: WikiDocRef[] = docs.map((d) => ({ id: d.path, title: d.title, folderId: d.dirPath === '' ? null : d.dirPath }))
  const docResolverFolders: WikiFolderRef[] = dirs.map((d) => ({ id: d, name: baseOf(d), parentId: parentIdOfDir(d) }))
  const vaultDocResolver = createWikiResolver(docResolverDocs, docResolverFolders)

  return { vaultName, docs, images, dirs, nonMdSkipped, traversalSkipped, vaultDocResolver }
}

// ---------- 7.1 넣을 폴더 ----------
export type VaultTarget = { kind: 'new' } | { kind: 'top' } | { kind: 'folder'; folderId: string }

export function defaultVaultTarget(scan: VaultScan, folders: readonly Folder[]): VaultTarget {
  const key = fold(scan.vaultName)
  const matches = folders.filter((f) => f.parentId === null && fold(f.name) === key)
  return matches.length === 1 ? { kind: 'folder', folderId: matches[0].id } : { kind: 'new' }
}

export function vaultTargetOptions(
  scan: VaultScan,
  folders: readonly Folder[],
): Array<{ value: string; label: string }> {
  const paths = folderPathMap(folders as Folder[])
  const ordered = flattenFolderTree(folders as Folder[])
  return [
    { value: 'new', label: `새 폴더 "${scan.vaultName}"` },
    { value: 'top', label: '최상위' },
    ...ordered.map((f) => ({ value: `folder:${f.id}`, label: paths.get(f.id) ?? f.name })),
  ]
}

// ---------- 7장 계획 ----------
type FolderMatch = { existingId: string | null; placeholderId: string; name: string; parentDir: string | null }

type VaultDocJudgement =
  | {
      action: 'create'
      vaultDoc: VaultDocScan
      title: string
      folderPlaceholder: string | null
      linkRewrittenText: string
      blocksMap: ReadonlyMap<VaultEmbed, EmbedBlock>
    }
  | {
      action: 'update'
      vaultDoc: VaultDocScan
      id: string
      title: string
      renamed: boolean
      linkRewrittenText: string
      blocksMap: ReadonlyMap<VaultEmbed, EmbedBlock>
    }
  | { action: 'skip'; vaultDoc: VaultDocScan; id: string }

export type VaultPlan = {
  readonly target: VaultTarget
  readonly counts: { created: number; updated: number; skipped: number; images: number }
  readonly warnings: readonly string[]
  readonly folders: ReadonlyMap<string, FolderMatch> // vaultDir -> match
  readonly judgements: readonly VaultDocJudgement[]
  readonly finalContentByPath: ReadonlyMap<string, string> // vaultDoc.path -> 변환된 원문(LF)
  readonly uploadImages: ReadonlyMap<string, { path: string; originalPath: string; ext: AttachmentExt }> // attachmentId -> 올릴 이미지
  readonly vaultName: string
  readonly untouchedCount: number
}

export function planVaultImport(input: {
  scan: VaultScan
  target: VaultTarget
  docs: readonly Doc[]
  folders: readonly Folder[]
  attachments: ReadonlyMap<string, AttachmentExt>
  storeKind: 'idb' | 'memory' | 'server'
  remainingBytes?: number | null
}): VaultPlan {
  const { scan, target, docs, folders, attachments, storeKind, remainingBytes } = input
  const isServer = storeKind === 'server'

  const rootFolderId: string | null = target.kind === 'folder' ? target.folderId : null

  let existingDocsInScope: Doc[] = []
  let existingFoldersInScope: Folder[] = []
  let docPaths = new Map<string, string>()
  let folderPaths = new Map<string, string>()

  if (target.kind !== 'new') {
    const scope: ExportScope = target.kind === 'folder' ? { kind: 'folder', folderId: target.folderId } : { kind: 'all' }
    const selected = selectExportScope(docs as Doc[], folders as Folder[], scope)
    existingDocsInScope = selected.docs
    existingFoldersInScope = selected.folders
    const planned = planExportPaths(existingDocsInScope, existingFoldersInScope, rootFolderId, {
      fileName: toObsidianFileName,
      folderName: toObsidianFolderName,
    })
    docPaths = planned.docPaths
    folderPaths = planned.folderPaths
  }

  // ---- 폴더 맞추기 (7.4) ----
  const dirsWithDocs = new Set<string>()
  for (const d of scan.docs) {
    let cur: string | null = d.dirPath
    while (cur !== null) {
      if (dirsWithDocs.has(cur)) break
      dirsWithDocs.add(cur)
      cur = cur === '' ? null : dirOf(cur)
    }
  }

  const childrenOfDir = new Map<string, string[]>()
  for (const d of scan.dirs) {
    if (!dirsWithDocs.has(d)) continue
    const p = dirOf(d)
    const list = childrenOfDir.get(p) ?? []
    list.push(d)
    childrenOfDir.set(p, list)
  }
  for (const list of childrenOfDir.values()) list.sort()

  const existingFoldersByParent = new Map<string | null, Folder[]>()
  for (const f of existingFoldersInScope) {
    const list = existingFoldersByParent.get(f.parentId) ?? []
    list.push(f)
    existingFoldersByParent.set(f.parentId, list)
  }

  function exportNameOfFolder(f: Folder): string {
    const p = folderPaths.get(f.id)
    if (!p) return f.name
    const idx = p.lastIndexOf('/')
    return idx === -1 ? p : p.slice(idx + 1)
  }

  const folderMatches = new Map<string, FolderMatch>()

  function walkFolders(parentDir: string | null, existingParentId: string | null) {
    const vaultChildren = childrenOfDir.get(parentDir ?? '') ?? []
    const candidates = (existingFoldersByParent.get(existingParentId) ?? []).slice()
    const used = new Set<string>()
    const unmatched: string[] = []

    for (const d of vaultChildren) {
      const key = fold(baseOf(d))
      const hit = candidates.find((f) => !used.has(f.id) && fold(exportNameOfFolder(f)) === key)
      if (hit) {
        used.add(hit.id)
        folderMatches.set(d, { existingId: hit.id, placeholderId: hit.id, name: baseOf(d), parentDir })
      } else {
        unmatched.push(d)
      }
    }
    for (const d of unmatched) {
      const key = fold(baseOf(d))
      const hit = candidates.find((f) => !used.has(f.id) && fold(f.name.trim()) === key)
      if (hit) {
        used.add(hit.id)
        folderMatches.set(d, { existingId: hit.id, placeholderId: hit.id, name: baseOf(d), parentDir })
      }
    }
    for (const d of vaultChildren) {
      if (folderMatches.has(d)) continue
      folderMatches.set(d, { existingId: null, placeholderId: `vaultdir:${d}`, name: baseOf(d), parentDir })
    }
    for (const d of vaultChildren) {
      const m = folderMatches.get(d)!
      walkFolders(d, m.existingId)
    }
  }
  walkFolders(null, rootFolderId)

  // ---- 문서 맞추기 (7.4) ----
  const existingDocsByFolder = new Map<string | null, Doc[]>()
  for (const d of existingDocsInScope) {
    const key = d.folderId === rootFolderId ? null : d.folderId
    const list = existingDocsByFolder.get(key) ?? []
    list.push(d)
    existingDocsByFolder.set(key, list)
  }

  const docsByDir = new Map<string, VaultDocScan[]>()
  for (const d of scan.docs) {
    const list = docsByDir.get(d.dirPath) ?? []
    list.push(d)
    docsByDir.set(d.dirPath, list)
  }

  function exportStemOfDoc(d: Doc): string {
    const p = docPaths.get(d.id)
    if (!p) return stemOf(d.title)
    return stemOf(baseOf(p))
  }

  const matchedExistingDocIds = new Set<string>()
  const docMatches = new Map<string, Doc>() // vaultDoc.path -> matched Doc

  const allDirsWithDocsIncludingRoot = ['', ...[...dirsWithDocs].filter((d) => d !== '')]
  for (const dir of allDirsWithDocsIncludingRoot) {
    const vaultDocsHere = (docsByDir.get(dir) ?? []).slice().sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    if (vaultDocsHere.length === 0) continue
    const existingKey: string | null = dir === '' ? null : (folderMatches.get(dir)?.existingId ?? null)
    const candidates = (existingDocsByFolder.get(existingKey) ?? []).slice()
    const used = new Set<string>()
    const unmatched: VaultDocScan[] = []

    for (const vd of vaultDocsHere) {
      const stem = stemOf(baseOf(vd.path))
      const key = fold(stem)
      const hit = candidates.find((d) => !used.has(d.id) && fold(exportStemOfDoc(d)) === key)
      if (hit) {
        used.add(hit.id)
        docMatches.set(vd.path, hit)
        matchedExistingDocIds.add(hit.id)
      } else {
        unmatched.push(vd)
      }
    }
    for (const vd of unmatched) {
      const stem = stemOf(baseOf(vd.path))
      const key = fold(stem)
      const hit = candidates.find((d) => !used.has(d.id) && fold(d.title.trim()) === key)
      if (hit) {
        used.add(hit.id)
        docMatches.set(vd.path, hit)
        matchedExistingDocIds.add(hit.id)
      }
    }
  }

  // ---- 판정 준비: 제목(대소문자만 다른 이름은 바꾼다, 7.6) ----
  const titleOverride = new Map<string, string>() // doc id -> 새 제목
  for (const [vaultPath, existing] of docMatches) {
    const vd = scan.docs.find((d) => d.path === vaultPath)!
    const stem = stemOf(baseOf(vd.path))
    if (nfc(existing.title) !== nfc(stem) && fold(existing.title.trim()) === fold(stem)) {
      titleOverride.set(existing.id, stem)
    }
  }

  // ---- 앱 해석기 (7.8) ----
  const finalTitleOf = (d: Doc) => titleOverride.get(d.id) ?? d.title
  const finalFolderIdOf = (existingFolderId: string | null): string | null => existingFolderId

  const orderedVaultDocPaths = [...scan.docs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((d) => d.path)
  const includedExistingIds = new Set<string>()
  const appResolverDocs: WikiDocRef[] = []
  for (const vaultPath of orderedVaultDocPaths) {
    const vd = scan.docs.find((d) => d.path === vaultPath)!
    const existing = docMatches.get(vaultPath)
    if (existing) {
      includedExistingIds.add(existing.id)
      appResolverDocs.push({ id: existing.id, title: finalTitleOf(existing), folderId: finalFolderIdOf(existing.folderId) })
    } else {
      const folderPlaceholder = vd.dirPath === '' ? rootFolderId : folderMatches.get(vd.dirPath)!.placeholderId
      appResolverDocs.push({ id: `vault:${vd.path}`, title: vd.title, folderId: folderPlaceholder })
    }
  }
  for (const d of docs) {
    if (includedExistingIds.has(d.id)) continue
    appResolverDocs.push({ id: d.id, title: finalTitleOf(d), folderId: d.folderId })
  }

  const appResolverFolders: WikiFolderRef[] = [
    ...folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
    ...[...folderMatches.entries()].filter(([, m]) => m.existingId === null).map(([dir, m]) => ({
      id: m.placeholderId,
      name: m.name,
      parentId: dir === '' ? null : (folderMatches.get(dirOf(dir))?.placeholderId ?? rootFolderId),
    })),
  ]
  const appResolver = createWikiResolver(appResolverDocs, appResolverFolders)

  // ---- 문서마다 변환 원문 만들기 (7.6·7.8) ----
  const finalContentByPath = new Map<string, string>()
  const judgements: VaultDocJudgement[] = []
  const warnings: string[] = []
  let overSizeSkipped = 0
  let untouchedCount = 0
  let leftAsIsCount = 0 // 원문 그대로 둔 이미지·임베드
  let missingRefCount = 0
  const uploadImages = new Map<string, { path: string; originalPath: string; ext: AttachmentExt }>()

  function ensureImageUploadable(img: VaultImageScan): AttachmentExt | null {
    if (img.attachmentId === null) return null
    return img.ext
  }

  for (const vd of scan.docs) {
    const existing = docMatches.get(vd.path)
    const folderPlaceholder = vd.dirPath === '' ? rootFolderId : folderMatches.get(vd.dirPath)!.placeholderId
    const finalTitle = existing ? finalTitleOf(existing) : vd.title

    if (vd.readFailed || vd.unreadable) {
      // 적용 때 실패 목록에 들어간다 — 계획에는 만들 대상으로 둔다(6.1)
      if (existing) {
        judgements.push({ action: 'update', vaultDoc: vd, id: existing.id, title: finalTitle, renamed: finalTitle !== existing.title, linkRewrittenText: '', blocksMap: new Map() })
      } else {
        judgements.push({ action: 'create', vaultDoc: vd, title: finalTitle, folderPlaceholder, linkRewrittenText: '', blocksMap: new Map() })
      }
      finalContentByPath.set(vd.path, '')
      continue
    }

    // 링크 되돌리기 (7.8)
    let text = vd.content
    const links = scanWikiLinks(text)
    type Edit = { from: number; to: number; insert: string }
    const edits: Edit[] = []
    for (const link of links) {
      if (link.target === '') continue
      const V = scan.vaultDocResolver.resolve(link.target, vd.dirPath === '' ? null : vd.dirPath)
      if (!V) continue
      const D = docMatches.get(V.id) ?? null
      const dId = D ? D.id : `vault:${V.id}`
      const dFound = appResolverDocs.find((r) => r.id === dId)
      if (!dFound) continue
      const sourceFolderId = existing ? finalFolderIdOf(existing.folderId) : folderPlaceholder
      const F = shortestWikiTarget(appResolver, dFound, sourceFolderId)
      if (appResolver.resolve(F, sourceFolderId)?.id !== dId) continue

      const rawSlice = text.slice(link.targetFrom, link.targetTo)
      const hashIdx = rawSlice.indexOf('#')
      const H = hashIdx === -1 ? '' : rawSlice.slice(hashIdx)
      const N = F + H

      if (link.alias !== null && !link.inTable && link.alias.trim() === N) {
        edits.push({ from: link.from + 2, to: link.to - 2, insert: N })
        continue
      }
      if (appResolver.resolve(link.target, sourceFolderId)?.id === dId) continue

      edits.push({ from: link.targetFrom, to: link.targetTo, insert: N })
      if (link.alias === null && !link.inTable) {
        edits.push({ from: link.targetTo, to: link.targetTo, insert: `|${rawSlice.trim()}` })
      }
    }
    edits.sort((a, b) => a.from - b.from || a.to - b.to)
    let rewritten = ''
    let cursor = 0
    for (const e of edits) {
      rewritten += text.slice(cursor, e.from)
      rewritten += e.insert
      cursor = e.to
    }
    rewritten += text.slice(cursor)
    text = rewritten

    const linkRewrittenText = text

    // 이미지 블록으로 바꾸기 (5.2·5.3) — ext 가 나중에(9.3) 정해질 수 있어 blocksMap 은 계획에 남겨 적용 때 다시 쓴다
    const existingBlocks = existing ? new Map(listImageBlocks(existing.content).map((b) => [b.block.id, b.block])) : new Map()
    const blocksMap = new Map<VaultEmbed, EmbedBlock>()
    let unresolvedExt = false
    for (const embed of vd.embeds) {
      if (embed.kind !== 'image' || !embed.standalone) {
        leftAsIsCount++
        continue
      }
      if (!embed.resolvedImagePath) {
        leftAsIsCount++
        continue
      }
      const img = scan.images.find((i) => i.path === embed.resolvedImagePath)!
      if (img.unreadable || img.tooLarge || /\.(svg|bmp|avif)$/i.test(img.path)) {
        leftAsIsCount++
        continue
      }
      const ext = ensureImageUploadable(img)
      if (!ext || !img.attachmentId) {
        leftAsIsCount++
        continue
      }
      const existingBlock = existingBlocks.get(img.attachmentId)
      // ext 를 attachments(store.listAttachments())나 이어받을 블록으로 알면 이미 있는 것으로 보고 올리지 않는다 (7.5)
      const knownExt = attachments.get(img.attachmentId) ?? existingBlock?.ext
      let finalExt: AttachmentExt
      if (knownExt !== undefined) {
        finalExt = knownExt
      } else {
        unresolvedExt = true
        finalExt = ext
        uploadImages.set(img.attachmentId, { path: img.path, originalPath: img.originalPath, ext: finalExt })
      }
      blocksMap.set(embed, {
        id: img.attachmentId,
        ext: finalExt,
        alt: embed.caption ?? existingBlock?.alt ?? imageStemOf(baseOf(img.path)),
        width: embed.width,
        align: existingBlock?.align ?? 'left',
      })
    }

    // 원문 안 attachments/{16hex}.{ext} 참조(F-156 블록 등) — 볼트 안 파일을 찾아 함께 올린다 (7.3 셋째 줄)
    for (const ref of vd.attachmentRefs) {
      if (uploadImages.has(ref.id) || attachments.has(ref.id)) continue
      const candidates = [
        vd.dirPath ? `${vd.dirPath}/attachments/${ref.id}.${ref.ext}` : `attachments/${ref.id}.${ref.ext}`,
        `attachments/${ref.id}.${ref.ext}`,
      ]
      const foundImg = scan.images.find((i) => candidates.includes(i.path) && i.attachmentId === ref.id)
      if (foundImg) {
        uploadImages.set(ref.id, { path: foundImg.path, originalPath: foundImg.originalPath, ext: ref.ext })
      } else {
        missingRefCount++
      }
    }

    text = embedsToImageBlocks(text, blocksMap)
    finalContentByPath.set(vd.path, text)

    if (isServer) {
      const byteLen = new TextEncoder().encode(text).length
      if (byteLen > MAX_CONTENT_BYTES) {
        overSizeSkipped++
        continue
      }
    }

    if (existing && !unresolvedExt) {
      const existingLF = toEditorText(existing.content)
      if (text === existingLF && finalTitle === existing.title) {
        judgements.push({ action: 'skip', vaultDoc: vd, id: existing.id })
        continue
      }
    }
    if (existing) {
      judgements.push({ action: 'update', vaultDoc: vd, id: existing.id, title: finalTitle, renamed: finalTitle !== existing.title, linkRewrittenText, blocksMap })
    } else {
      judgements.push({ action: 'create', vaultDoc: vd, title: finalTitle, folderPlaceholder, linkRewrittenText, blocksMap })
    }
  }

  for (const d of existingDocsInScope) {
    if (!matchedExistingDocIds.has(d.id)) untouchedCount++
  }

  const created = judgements.filter((j) => j.action === 'create').length
  const updated = judgements.filter((j) => j.action === 'update').length
  const skipped = judgements.filter((j) => j.action === 'skip').length

  if (scan.traversalSkipped > 0) warnings.push(`경로가 이상해 건너뛴 파일 ${scan.traversalSkipped}개`)
  if (scan.nonMdSkipped > 0) warnings.push(`.md 가 아니라 건너뛴 파일 ${scan.nonMdSkipped}개`)
  if (leftAsIsCount > 0) warnings.push(`원문 그대로 둔 이미지·임베드 ${leftAsIsCount}개`)
  if (missingRefCount > 0) warnings.push(`가져오지 못한 이미지 참조 ${missingRefCount}개`)
  if (overSizeSkipped > 0) warnings.push(`내용이 1MB 를 넘어 건너뛴 문서 ${overSizeSkipped}개`)
  if (untouchedCount > 0) warnings.push(`볼트에 없어 그대로 둔 문서 ${untouchedCount}개`)
  if (isServer && remainingBytes != null) {
    const uploadBytesSum = [...uploadImages.keys()].reduce((sum, id) => {
      const img = scan.images.find((i) => i.attachmentId === id)
      return sum + (img?.size ?? 0)
    }, 0)
    if (uploadBytesSum > remainingBytes) {
      const remainMb = Math.max(0, Math.floor(remainingBytes / (1024 * 1024)))
      warnings.push(`이미지 저장 공간이 모자랄 수 있습니다(남은 공간 ${remainMb}MB).`)
    }
  }

  return {
    target,
    counts: { created, updated, skipped, images: uploadImages.size },
    warnings,
    folders: folderMatches,
    judgements,
    finalContentByPath,
    uploadImages,
    vaultName: scan.vaultName,
    untouchedCount,
  }
}

// ---------- 9장 적용 ----------
export type ApplyVaultStore = {
  create(input: { title: string; content: string; lineEnding: LineEnding; folderId?: string | null }): Promise<Doc>
  update(id: string, patch: { title?: string; content?: string }): Promise<Doc>
  get(id: string): Promise<Doc | null>
  createFolder(input: { name: string; parentId?: string | null }): Promise<Folder>
  putAttachment(input: { blob: Blob; mime: string; ext: AttachmentExt; width: number; height: number; id?: string }): Promise<{ id: string; ext: AttachmentExt }>
  kind?: 'idb' | 'memory' | 'server'
}

export type ApplyVaultResult = {
  createdCount: number
  updatedCount: number
  cancelled: boolean
  failures: string[]
  quotaSkippedCount: number
  targetFolderId: string | null
  skippedCount: number
}

export function vaultUploadNames(plan: VaultPlan): ReadonlySet<string> {
  return new Set([...plan.uploadImages.values()].map((v) => v.originalPath))
}

export async function applyVaultImport(input: {
  plan: VaultPlan
  scan: VaultScan
  entries: AsyncIterable<VaultEntry>
  store: ApplyVaultStore
  encode?: (blob: Blob) => Promise<Blob>
  isCancelled?: () => boolean
  onProgress?: (p: { done: number; total: number }) => void
}): Promise<ApplyVaultResult> {
  // scan 은 입력 계약(spec 9장)의 일부로 받지만 지금 구현은 plan 에 담긴 것만으로 충분해 쓰지 않는다
  const { plan, entries, store, encode, isCancelled, onProgress } = input
  const failures: string[] = []
  let cancelled = false

  // 1. new 면 최상위에 볼트 이름 폴더를 만든다
  let targetFolderId: string | null = plan.target.kind === 'folder' ? plan.target.folderId : null
  if (plan.target.kind === 'new') {
    try {
      const created = await store.createFolder({ name: plan.vaultName, parentId: null })
      targetFolderId = created.id
    } catch {
      failures.push(`${plan.vaultName} — 폴더를 만들지 못했습니다`)
      targetFolderId = null
    }
  }

  // 2. 새 폴더들 — 부모 먼저
  const resolvedFolderId = new Map<string, string | null>() // placeholderId -> 실제 id(또는 가장 가까운 성공한 조상)
  const dirsInOrder = [...plan.folders.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  for (const [, match] of dirsInOrder) {
    if (match.existingId !== null) {
      resolvedFolderId.set(match.placeholderId, match.existingId)
      continue
    }
    const parentId: string | null = match.parentDir === null ? targetFolderId : (resolvedFolderId.get(plan.folders.get(match.parentDir)!.placeholderId) ?? targetFolderId)
    try {
      const created = await store.createFolder({ name: match.name, parentId })
      resolvedFolderId.set(match.placeholderId, created.id)
    } catch {
      failures.push(`${match.name} — 폴더를 만들지 못했습니다`)
      resolvedFolderId.set(match.placeholderId, parentId)
    }
  }

  function resolveFolder(folderPlaceholder: string | null): string | null {
    if (folderPlaceholder === null) return targetFolderId
    if (folderPlaceholder === targetFolderId) return targetFolderId
    return resolvedFolderId.has(folderPlaceholder) ? resolvedFolderId.get(folderPlaceholder)! : targetFolderId
  }

  // 3. 이미지 — 2차 훑기
  const uploadByOriginalPath = new Map(
    [...plan.uploadImages.entries()].map(([id, v]) => [v.originalPath, { id, ext: v.ext, path: v.path }]),
  )
  const total = plan.uploadImages.size + plan.judgements.filter((j) => j.action !== 'skip').length
  let done = 0
  let quotaExceeded = false
  let quotaSkippedCount = 0
  const uploadedExtById = new Map<string, AttachmentExt>()

  for await (const entry of entries) {
    if (isCancelled?.()) {
      cancelled = true
      break
    }
    const want = uploadByOriginalPath.get(entry.name)
    if (!want || entry.bytes === null) continue
    if (quotaExceeded) {
      quotaSkippedCount++
      done++
      onProgress?.({ done, total })
      continue
    }
    try {
      const inspected = inspectImageBytes(entry.bytes)
      if (!inspected) throw new Error('unreadable')
      let blob: Blob = new Blob([entry.bytes as unknown as BlobPart])
      let ext = want.ext
      let mime = inspected.mime
      if (store.kind === 'server' && encode && (inspected.ext === 'png' || inspected.ext === 'jpg')) {
        const converted = await encode(blob)
        if (converted !== blob) {
          blob = converted
          ext = 'webp'
          mime = 'image/webp'
        }
      }
      const result = await store.putAttachment({ blob, mime, ext, width: inspected.width, height: inspected.height, id: want.id })
      uploadedExtById.set(want.id, result.ext)
    } catch (err) {
      if (err instanceof Error && err.name === 'quota_exceeded') {
        quotaExceeded = true
        quotaSkippedCount++
      } else {
        failures.push(`${want.path} — 이미지를 넣지 못해 원문 그대로 두었습니다`)
      }
    }
    done++
    onProgress?.({ done, total })
  }

  // 4. 문서 — create 다음 update, NFC 경로 순
  let createdCount = 0
  let updatedCount = 0
  let skippedCount = plan.judgements.filter((j) => j.action === 'skip').length

  // ext 가 계획 때는 몰라(9.3) blocksMap 에 담아 뒀다 — putAttachment 가 돌려준 실제 ext 로 다시 채워 넣는다
  function buildFinalText(j: Extract<VaultDocJudgement, { action: 'create' | 'update' }>): string {
    if (j.blocksMap.size === 0) return j.linkRewrittenText
    const corrected = new Map<VaultEmbed, EmbedBlock>()
    for (const [embed, block] of j.blocksMap) {
      corrected.set(embed, { ...block, ext: uploadedExtById.get(block.id) ?? block.ext })
    }
    return embedsToImageBlocks(j.linkRewrittenText, corrected)
  }

  const creates = plan.judgements.filter((j): j is Extract<VaultDocJudgement, { action: 'create' }> => j.action === 'create')
  const updates = plan.judgements.filter((j): j is Extract<VaultDocJudgement, { action: 'update' }> => j.action === 'update')

  for (const j of [...creates].sort((a, b) => (a.vaultDoc.path < b.vaultDoc.path ? -1 : 1))) {
    if (cancelled || isCancelled?.()) {
      cancelled = true
      break
    }
    if (j.vaultDoc.readFailed) {
      failures.push(`${j.title} — 가져오지 못했습니다`)
      continue
    }
    if (j.vaultDoc.unreadable) {
      failures.push(`${j.title} — 이 문서는 UTF-8 로 읽을 수 없어 가져오지 못했습니다`)
      continue
    }
    const content = buildFinalText(j)
    try {
      await store.create({
        title: j.title,
        content: fromEditorText(content, j.vaultDoc.lineEnding),
        lineEnding: j.vaultDoc.lineEnding,
        folderId: resolveFolder(j.folderPlaceholder),
      })
      createdCount++
    } catch {
      failures.push(`${j.title} — 가져오지 못했습니다`)
    }
    done++
    onProgress?.({ done, total })
  }

  for (const j of [...updates].sort((a, b) => (a.vaultDoc.path < b.vaultDoc.path ? -1 : 1))) {
    if (cancelled || isCancelled?.()) {
      cancelled = true
      break
    }
    if (j.vaultDoc.readFailed) {
      failures.push(`${j.title} — 가져오지 못했습니다`)
      continue
    }
    if (j.vaultDoc.unreadable) {
      failures.push(`${j.title} — 이 문서는 UTF-8 로 읽을 수 없어 가져오지 못했습니다`)
      continue
    }
    let existing: Doc | null = null
    try {
      existing = await store.get(j.id)
    } catch {
      existing = null
    }
    if (!existing) {
      failures.push(`${j.title} — 가져오지 못했습니다`)
      continue
    }
    const content = buildFinalText(j)
    const newContent = fromEditorText(content, existing.lineEnding)
    if (newContent === existing.content && !j.renamed) {
      skippedCount++
      continue
    }
    try {
      await store.create({ title: truncatedCopyTitle(existing.title), content: existing.content, lineEnding: existing.lineEnding, folderId: existing.folderId })
    } catch {
      failures.push(`${j.title} — 사본을 만들지 못해 갱신하지 않았습니다`)
      continue
    }
    try {
      // patch 에 title 키를 그냥 넣으면(값이 undefined 라도) 일부 저장소는 "키가 있다" 로 보고 제목을 지운다 — 안 바꿀 땐 키 자체를 뺀다
      const patch: { title?: string; content?: string } = { content: newContent }
      if (j.renamed) patch.title = j.title
      await store.update(j.id, patch)
      updatedCount++
    } catch {
      failures.push(`${j.title} — 가져오지 못했습니다`)
    }
    done++
    onProgress?.({ done, total })
  }

  return { createdCount, updatedCount, cancelled, failures, quotaSkippedCount, targetFolderId, skippedCount }
}
