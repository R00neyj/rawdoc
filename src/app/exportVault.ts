// 옵시디언 볼트 내보내기 — 계획·본문 변환·링크 고쳐 쓰기(순수)·스트리밍 zip·내려받기 (specs/features/F-2020.md 4~6장)
import { Zip, ZipPassThrough } from 'fflate'

import { toObsidianFileName, toObsidianFolderName, toFolderName } from '../lib/filename'
import { extractAttachmentRefs, type ParsedImageBlock } from '../lib/imageBlock'
import { imageBlockToEmbed } from '../lib/obsidianImage'
import { fromEditorText } from '../lib/lineEnding'
import { findFrontmatter, textAfterFrontmatter } from '../lib/frontmatter'
import { parseMarkdownTokens } from '../viewer/renderMarkdown'
import { scanWikiLinks } from '../lib/wikiGraph'
import { createWikiResolver, type WikiResolver, type WikiDocRef, type WikiFolderRef } from '../lib/wikiResolve'
import { selectExportScope, planExportPaths, type ExportScope, type WorkspaceExportStore, type WorkspaceExportSourceStore } from './exportWorkspace'
import { downloadBlob } from './exportDoc'
import type { Doc, Folder } from '../types'
import type { Notice } from './notice'

export type VaultPlanDoc = { doc: Doc; path: string } // path: zip 안 경로, '.md' 포함
export type VaultLinkContext = {
  resolver: WikiResolver
  exportedIds: ReadonlySet<string>
  vaultPathOf: ReadonlyMap<string, string> // 문서 id → zip 경로('.md' 뗀 것)
}
export type VaultPlan = {
  zipFilename: string
  docs: VaultPlanDoc[] // zip 에 넣는 순서
  links: VaultLinkContext
}

function formatLocalDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function byCreatedThenId<T extends { createdAt: number; id: string }>(a: T, b: T): number {
  return a.createdAt - b.createdAt || compareId(a.id, b.id)
}

// planWorkspaceExport 의 directories 와 같은 순서(루트 먼저, 폴더는 부모→자식, 디렉터리 안은 createdAt→id) 로 문서를 편다 (F-2020.md 4장·11.1 U7)
function orderedVaultDocs(
  docs: Doc[],
  orderedFolders: Folder[],
  docPaths: Map<string, string>,
  rootFolderId: string | null,
): VaultPlanDoc[] {
  const byDir = new Map<string, Doc[]>()
  for (const d of docs) {
    const key = d.folderId === rootFolderId ? '' : (d.folderId as string)
    const list = byDir.get(key) ?? []
    list.push(d)
    byDir.set(key, list)
  }
  for (const list of byDir.values()) list.sort(byCreatedThenId)

  const result: VaultPlanDoc[] = []
  for (const d of byDir.get('') ?? []) result.push({ doc: d, path: docPaths.get(d.id)! })
  for (const f of orderedFolders) {
    for (const d of byDir.get(f.id) ?? []) result.push({ doc: d, path: docPaths.get(d.id)! })
  }
  return result
}

const fold = (s: string) => s.toLowerCase()

// vaultPathOf 값(문서마다 '.md' 뗀 경로)의 끝 조각 1개~전체를 접은 키로 "그 키로 끝나는 문서 수" 표를 만든다 (F-2020.md 5.5)
function buildSuffixCounts(vaultPathOf: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const path of vaultPathOf.values()) {
    const pieces = path.split('/')
    for (let k = 1; k <= pieces.length; k++) {
      const key = pieces.slice(pieces.length - k).map(fold).join('/')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

// planVaultExport 가 만든 링크 맥락마다 딸린 끝 조각 표 — VaultLinkContext 공개 계약(4.1)에는 없는 내부 값이라 객체 신원으로 따로 둔다
const suffixCountsCache = new WeakMap<VaultLinkContext, Map<string, number>>()

// '/' 로 나눈 조각. 맨 앞 '/' 는 떼고, 빈 조각이 있으면 null (wikiResolve.ts splitPath 와 같은 규칙, F-2020.md 5.4)
function splitTargetPath(target: string): string[] | null {
  const parts = target.replace(/^\/+/, '').split('/').map((p) => p.trim())
  return parts.some((p) => p === '') ? null : parts
}

// t 가 볼트에서 문서 D(dPathPieces)를 가리키는가 — ① 전체 경로 일치, ② 유일한 끝 조각 일치 (F-2020.md 5.4)
function pointsToInVault(t: string, dPathPieces: string[], suffixCounts: ReadonlyMap<string, number>): boolean {
  const parts = splitTargetPath(t)
  if (!parts) return false
  const foldedParts = parts.map(fold)
  const foldedD = dPathPieces.map(fold)

  if (foldedParts.length === foldedD.length && foldedParts.every((p, i) => p === foldedD[i])) return true // ①
  if (foldedParts.length > foldedD.length) return false

  const key = foldedParts.join('/')
  const dSuffix = foldedD.slice(foldedD.length - foldedParts.length).join('/')
  return dSuffix === key && suffixCounts.get(key) === 1
}

// D 경로의 끝 조각 1개, 2개, … 순으로 처음 볼트에서 유일하게 가리키는 형태(원래 대소문자) — 전체 경로는 언제나 ①로 가리킨다 (F-2020.md 5.4)
function shortestPointingForm(dPathPieces: string[], suffixCounts: ReadonlyMap<string, number>): string {
  const n = dPathPieces.length
  for (let k = 1; k < n; k++) {
    const suffixPieces = dPathPieces.slice(n - k)
    const key = suffixPieces.map(fold).join('/')
    if (suffixCounts.get(key) === 1) return suffixPieces.join('/')
  }
  return dPathPieces.join('/')
}

// 대상 고르기·경로·해석기·끝 조각 표만 만든다 — 가볍다. 본문 변환은 exportVault 가 문서마다 부른다 (F-2020.md 4.1)
export function planVaultExport({
  docs,
  folders,
  scope,
  now,
}: {
  docs: Doc[]
  folders: Folder[]
  scope: ExportScope
  now: number
}): VaultPlan {
  const { docs: scopedDocs, folders: scopedFolders, rootFolderId } = selectExportScope(docs, folders, scope)
  const { orderedFolders, docPaths } = planExportPaths(scopedDocs, scopedFolders, rootFolderId, {
    fileName: toObsidianFileName,
    folderName: toObsidianFolderName,
  })

  const vaultDocs = orderedVaultDocs(scopedDocs, orderedFolders, docPaths, rootFolderId)

  let zipFilename: string
  if (scope.kind === 'all') {
    zipFilename = `${formatLocalDate(now)}-vault.zip`
  } else {
    const rootFolder = folders.find((f) => f.id === scope.folderId)
    zipFilename = `${toFolderName(rootFolder?.name ?? '')}-vault.zip`
  }

  // 해석은 앱과 같은 풀에서 — store.list() 문서 전부(공유받은 문서 포함), updatedAt 내림차순(같으면 입력 순서) (F-2020.md 5.4)
  const resolverDocs: WikiDocRef[] = [...docs]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((d) => ({ id: d.id, title: d.title, folderId: d.folderId }))
  const resolverFolders: WikiFolderRef[] = folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId }))
  const resolver = createWikiResolver(resolverDocs, resolverFolders)

  const exportedIds = new Set(scopedDocs.map((d) => d.id))
  const vaultPathOf = new Map(vaultDocs.map(({ doc, path }) => [doc.id, path.replace(/\.md$/, '')]))

  const links: VaultLinkContext = { resolver, exportedIds, vaultPathOf }
  suffixCountsCache.set(links, buildSuffixCounts(vaultPathOf))

  return { zipFilename, docs: vaultDocs, links }
}

// 줄 시작 위치와 함께 훑는다 — wikiGraph.ts 의 것과 같은 규칙, 이미지 블록의 줄 범위를 원문 문자 위치로 바꾸는 데 쓴다 (F-2020.md 5.3)
function linesWithOffsets(text: string): { line: string; start: number }[] {
  const result: { line: string; start: number }[] = []
  let pos = 0
  while (pos <= text.length) {
    let end = pos
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++
    result.push({ line: text.slice(pos, end), start: pos })
    if (end >= text.length) break
    pos = text[end] === '\r' && text[end + 1] === '\n' ? end + 2 : end + 1
  }
  return result
}

type Edit = { from: number; to: number; insert: string }

// 첨부 참조가 있는 문서에서만 markdown-it 을 돌려 이미지 블록의 원문 범위 → 임베드 한 줄 교체를 계산한다 (F-2020.md 5.1·5.3)
function computeImageBlockEdits(content: string): Edit[] {
  if (extractAttachmentRefs(content).size === 0) return []

  const fm = findFrontmatter(content)
  const body = fm ? textAfterFrontmatter(content, fm) : content
  const lineOffset = fm ? (content.slice(0, content.length - body.length).match(/\n/g) || []).length : 0
  const contentLines = linesWithOffsets(content)

  const edits: Edit[] = []
  for (const token of parseMarkdownTokens(body)) {
    if (token.type !== 'html_block' || token.level !== 0 || !token.map) continue
    const parsed = token.meta as ParsedImageBlock | null | undefined
    if (!parsed || typeof parsed.id !== 'string') continue

    const startLine = lineOffset + token.map[0]
    const lastLine = lineOffset + token.map[1] - 1
    const startInfo = contentLines[startLine]
    const lastInfo = contentLines[lastLine]
    if (!startInfo || !lastInfo) continue

    edits.push({
      from: startInfo.start,
      to: lastInfo.start + lastInfo.line.length,
      insert: imageBlockToEmbed({ id: parsed.id, ext: parsed.ext, width: parsed.width }),
    })
  }
  return edits
}

function overlapsAny(from: number, to: number, ranges: Edit[]): boolean {
  return ranges.some((r) => from < r.to && r.from < to)
}

// 이미지 블록 바꾸기와 링크 고쳐 쓰기를 원문 기준 위치로 한 번에 적용한다. 겹치면(블록 alt 안의 [[…]]) 블록이 이기고 그 링크는 세지 않는다 (F-2020.md 5장)
export function toVaultMarkdown(
  content: string,
  sourceFolderId: string | null,
  links: VaultLinkContext,
): { text: string; rewrittenLinks: number } {
  const imageEdits = computeImageBlockEdits(content)
  const suffixCounts = suffixCountsCache.get(links) ?? new Map<string, number>()

  const edits: Edit[] = [...imageEdits]
  let rewrittenLinks = 0

  for (const link of scanWikiLinks(content)) {
    if (link.target === '') continue // 1. [[#헤딩]]
    if (overlapsAny(link.from, link.to, imageEdits)) continue // 블록이 이긴다

    const D = links.resolver.resolve(link.target, sourceFolderId)
    if (!D || !links.exportedIds.has(D.id)) continue // 2. 안 풀리거나 내보내는 범위 밖

    const dPathStr = links.vaultPathOf.get(D.id)
    if (dPathStr === undefined) continue
    const dPathPieces = dPathStr.split('/')

    if (pointsToInVault(link.target, dPathPieces, suffixCounts)) continue // 3. 이미 볼트에서 D 를 가리킨다

    const newTarget = shortestPointingForm(dPathPieces, suffixCounts) // 4

    const rawSlice = content.slice(link.targetFrom, link.targetTo)
    const hashIdx = rawSlice.indexOf('#')
    const editTo = hashIdx === -1 ? link.targetTo : link.targetFrom + hashIdx
    edits.push({ from: link.targetFrom, to: editTo, insert: newTarget }) // 5

    if (link.alias === null && !link.inTable) {
      edits.push({ from: link.targetTo, to: link.targetTo, insert: `|${rawSlice.trim()}` }) // 6
    }

    rewrittenLinks += 1 // 7
  }

  edits.sort((a, b) => a.from - b.from || a.to - b.to)

  let text = ''
  let cursor = 0
  for (const e of edits) {
    text += content.slice(cursor, e.from)
    text += e.insert
    cursor = e.to
  }
  text += content.slice(cursor)

  return { text, rewrittenLinks }
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

function yieldToNextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// 저장소를 읽어 스트리밍 zip 을 만든다 — 문서마다 본문 변환, 50개마다 이벤트 루프에 양보 (F-2020.md 4.1)
export async function exportVault({
  plan,
  store,
  onProgress,
  onChunk,
}: {
  plan: VaultPlan
  store: WorkspaceExportStore
  onProgress?: (p: { done: number; total: number }) => void
  onChunk?: (chunk: Uint8Array) => void
}): Promise<{ bytes: Uint8Array<ArrayBuffer>; missingCount: number; docCount: number; rewrittenLinks: number }> {
  const total = plan.docs.length
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

  let done = 0
  let rewrittenLinks = 0
  const usedIds = new Set<string>() // 문서 순서대로 처음 나온 순서 (4장)

  for (const { doc, path } of plan.docs) {
    const { text, rewrittenLinks: n } = toVaultMarkdown(doc.content, doc.folderId, plan.links)
    rewrittenLinks += n
    addFile(path, new TextEncoder().encode(fromEditorText(text, doc.lineEnding)))
    for (const id of extractAttachmentRefs(doc.content)) usedIds.add(id)

    done += 1
    onProgress?.({ done, total })
    if (done % 50 === 0) await yieldToNextTask()
  }

  const missingIds = new Set<string>()
  for (const id of usedIds) {
    const record = await store.getAttachment(id)
    if (!record) {
      missingIds.add(id)
      continue
    }
    const attBytes = new Uint8Array(await record.blob.arrayBuffer())
    addFile(`attachments/${record.id}.${record.ext}`, attBytes)
  }

  zip.end()

  return { bytes: concatChunks(chunks), missingCount: missingIds.size, docCount: total, rewrittenLinks }
}

// 진입점 — 목록 읽기 → 계획 → zip → 내려받기 → 알림 (F-2020.md 6.3·6.4)
export async function downloadVaultExport({
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

  const plan = planVaultExport({ docs, folders, scope, now })
  if (plan.docs.length === 0) {
    onNotice?.({ type: 'info', message: '내보낼 문서가 없습니다.' })
    return
  }

  try {
    const result = await exportVault({ plan, store, onProgress })
    downloadBlob(new Blob([result.bytes], { type: 'application/zip' }), plan.zipFilename)
    onNotice?.({
      type: 'info',
      message:
        result.rewrittenLinks > 0
          ? `옵시디언 볼트로 내보냈습니다. 위키링크 ${result.rewrittenLinks}개에 경로를 붙였습니다.`
          : '옵시디언 볼트로 내보냈습니다.',
    })
    if (result.missingCount > 0) {
      onNotice?.({ type: 'warn', message: `이미지 ${result.missingCount}개를 찾을 수 없어 빼고 내보냈습니다.` })
    }
  } catch {
    onNotice?.({ type: 'error', message: '내보내지 못했습니다.' })
  }
}
