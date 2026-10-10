// 명령마다 결과 데이터를 돌려주는 함수. 출력하지 않는다. 입력은 이미 해석된 값이다 — 파일 읽기는 main 쪽 층에서 끝낸다 (specs/features/F-2021.md 4.7, 삭제·이동·공유 목록은 F-2050.md 5.4)
import type {
  V1Attachment,
  V1DeletedDoc,
  V1DeletedFolder,
  V1Doc,
  V1DocSummary,
  V1Folder,
  V1Link,
  V1Me,
  V1SearchHit,
  V1SearchResult,
  V1SharedDoc,
} from '../../worker/v1Contract'
import {
  apiCreateDoc,
  apiCreateFolder,
  apiCreateLink,
  apiDeleteDoc,
  apiDeleteFolder,
  apiGetDoc,
  apiListDocs,
  apiListFolders,
  apiListShared,
  apiMe,
  apiMoveDoc,
  apiSearch,
  apiUpdateDoc,
  apiUploadAttachment,
  type ClientConfig,
} from './client'
import { isFolderId, resolveFolderPath } from './folderRef'
import { folderPathOf, titleMatches, withFolderPath, type DocWithPath } from './docMeta'
import { CliError, type CliErrorCode, type ReplaceListItem } from './output'
import { replaceLiteral } from './replaceText'
import { SEARCH_MAX_DOCS } from '../../worker/searchLines'

export function whoami(cfg: ClientConfig): Promise<V1Me> {
  return apiMe(cfg)
}

export type DocScope = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'root' }

export type DocInfo = DocWithPath<V1DocSummary> | (V1SharedDoc & { folderPath: null })

function inScope(docs: V1DocSummary[], scope: DocScope): V1DocSummary[] {
  if (scope.kind === 'folder') return docs.filter((d) => d.folderId === scope.id)
  if (scope.kind === 'root') return docs.filter((d) => d.folderId === null)
  return docs
}

// 서버에 거르기 인자가 없어 받은 목록을 여기서 거른다. 요청 하나라도 실패하면 그 오류로 끝낸다 (F-2119 2.1)
async function listScoped(
  cfg: ClientConfig,
  scope: DocScope,
  withPath: boolean,
  keep: (d: V1DocSummary) => boolean,
  knownFolders?: V1Folder[],
): Promise<V1DocSummary[] | DocWithPath[]> {
  const [docs, folders] = await Promise.all([
    apiListDocs(cfg),
    knownFolders ?? (withPath ? apiListFolders(cfg) : Promise.resolve([])),
  ])
  const kept = inScope(docs, scope).filter(keep)
  return withPath ? withFolderPath(kept, folders) : kept
}

export function ls(cfg: ClientConfig, scope: DocScope, withPath: boolean, knownFolders?: V1Folder[]): Promise<V1DocSummary[] | DocWithPath[]> {
  return listScoped(cfg, scope, withPath, () => true, knownFolders)
}

export function find(
  cfg: ClientConfig,
  query: string,
  scope: DocScope,
  withPath: boolean,
  knownFolders?: V1Folder[],
): Promise<V1DocSummary[] | DocWithPath[]> {
  return listScoped(cfg, scope, withPath, (d) => titleMatches(d.title, query), knownFolders)
}

export type SearchOutput = Omit<V1SearchResult, 'docs'> & { docs: Array<V1SearchHit & { folderPath: string[] | null }> }

// 폴더를 준 검색의 404 는 폴더가 없다는 뜻이다
export async function search(
  cfg: ClientConfig,
  query: string,
  folder: { id: string; value: string } | null,
  knownFolders?: V1Folder[],
): Promise<SearchOutput> {
  try {
    const [result, folders] = await Promise.all([apiSearch(cfg, query, folder?.id ?? null), knownFolders ?? apiListFolders(cfg)])
    return { ...result, docs: result.docs.map((d) => ({ ...d, folderPath: folderPathOf(folders, d.folderId) })) }
  } catch (err) {
    if (folder !== null && err instanceof CliError && err.code === 'not_found') throw new CliError('folder_not_found', { folder: folder.value })
    throw err
  }
}

export type ReplaceInput = { find: string; replacement: string; folder: { id: string; value: string } | null; apply: boolean }
export type ReplaceHooks = { sleep: (ms: number) => Promise<void>; onWait: (seconds: number) => void }
export type ReplaceOutput = { applied: boolean; docs: ReplaceListItem[]; e2eeSkipped: number; stopped: CliError | null }

// 같은 요청에 분당 429 가 이만큼 이어지면 하루 한도처럼 멈춘다 — 끝없이 기다리지 않게
const MAX_RATE_RETRIES = 3
// 이 오류는 다음 문서에서도 똑같이 나므로 거기서 멈추고 남은 문서를 미처리로 둔다
const STOPS_RUN: Partial<Record<CliErrorCode, true>> = {
  rate_limited: true,
  unauthenticated: true,
  account_blocked: true,
  doc_quota_exceeded: true,
  network: true,
  timeout: true,
}

async function withRateRetry<T>(request: () => Promise<T>, hooks: ReplaceHooks): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request()
    } catch (err) {
      const minuteLimit = err instanceof CliError && err.code === 'rate_limited' && err.details.scope !== 'day'
      if (!minuteLimit || attempt >= MAX_RATE_RETRIES) throw err
      const seconds = (err as CliError).details.retryAfter ?? 60
      hooks.onWait(seconds)
      await hooks.sleep(seconds * 1000)
    }
  }
}

// 문서마다 GET → 바꾸기 → (apply 면) 그 판 번호로 PUT 을 차례로. 본문을 한꺼번에 들고 있지 않는다
export async function replace(cfg: ClientConfig, input: ReplaceInput, hooks: ReplaceHooks, knownFolders?: V1Folder[]): Promise<ReplaceOutput> {
  const found = await search(cfg, input.find, input.folder, knownFolders)
  if (found.truncated) throw new CliError('too_many_docs', { limit: SEARCH_MAX_DOCS })
  const docs: ReplaceListItem[] = []
  let stopped: CliError | null = null
  for (const hit of found.docs) {
    const base = { id: hit.id, title: hit.title, folderPath: hit.folderPath, lines: [], changedLines: 0 }
    if (stopped) {
      docs.push({ ...base, count: null, status: 'skipped' })
      continue
    }
    let read: ReplaceListItem | null = null
    try {
      const doc = await withRateRetry(() => apiGetDoc(cfg, hit.id), hooks)
      const r = replaceLiteral(doc.content, input.find, input.replacement)
      if (r.content === doc.content) continue
      read = { ...base, count: r.count, lines: r.lines, changedLines: r.changedLines, status: 'preview' }
      if (!input.apply) {
        docs.push(read)
        continue
      }
      const body = { content: r.content, baseVersion: doc.version }
      const written = await withRateRetry(() => apiUpdateDoc(cfg, hit.id, body), hooks)
      docs.push({ ...read, status: 'updated', version: written.version })
    } catch (err) {
      if (!(err instanceof CliError)) throw err
      const status = err.code === 'conflict' ? 'conflict' : err.code === 'too_large' ? 'too_large' : err.code === 'rate_limited' ? 'skipped' : 'error'
      docs.push({ ...(read ?? { ...base, count: null }), status, ...(status === 'error' ? { failure: err } : {}) })
      if (STOPS_RUN[err.code]) stopped = err
    }
  }
  return { applied: input.apply, docs, e2eeSkipped: found.e2eeSkipped, stopped }
}

// UUID 는 그대로 쓰고(요청 없음), 아니면 폴더 목록을 한 번 받아 경로로 푼다 (F-2132 2장)
export async function resolveFolder(cfg: ClientConfig, value: string): Promise<{ id: string; folders: V1Folder[] | null }> {
  if (isFolderId(value)) return { id: value, folders: null }
  const folders = await apiListFolders(cfg)
  const result = resolveFolderPath(value, folders)
  if (result.kind === 'found') return { id: result.id, folders }
  if (result.kind === 'ambiguous') throw new CliError('folder_ambiguous', { folder: value, folderIds: result.ids })
  throw new CliError('folder_not_found', { folder: value })
}

export async function info(cfg: ClientConfig, id: string): Promise<DocInfo> {
  const [docs, folders] = await Promise.all([apiListDocs(cfg), apiListFolders(cfg)])
  const mine = docs.find((d) => d.id === id)
  if (mine) return withFolderPath([mine], folders)[0]
  const shared = (await apiListShared(cfg)).find((d) => d.id === id)
  if (shared) return { ...shared, folderPath: null }
  throw new CliError('not_found', { id })
}

export function get(cfg: ClientConfig, id: string): Promise<V1Doc> {
  return apiGetDoc(cfg, id)
}

export type NewInput = { title: string; content: string; lineEnding: 'crlf' | 'lf'; folderId: string | null }

export function createDoc(cfg: ClientConfig, input: NewInput): Promise<V1Doc> {
  const body: { title: string; content: string; lineEnding: 'crlf' | 'lf'; folderId?: string } = {
    title: input.title,
    content: input.content,
    lineEnding: input.lineEnding,
  }
  if (input.folderId !== null) body.folderId = input.folderId
  return apiCreateDoc(cfg, body)
}

export type PutInput = { id: string; content?: string; title?: string; baseVersion: number | null; force: boolean }

// --force 는 GET 뒤 그 version 으로 PUT(요청 2회). --base-version 은 PUT 1회 (4.2)
export async function putDoc(cfg: ClientConfig, input: PutInput): Promise<V1Doc> {
  let baseVersion = input.baseVersion
  if (input.force) {
    const current = await apiGetDoc(cfg, input.id)
    baseVersion = current.version
  }
  const body: { title?: string; content?: string; baseVersion: number } = { baseVersion: baseVersion as number }
  if (input.title !== undefined && input.title !== null) body.title = input.title
  if (input.content !== undefined && input.content !== null) body.content = input.content
  return apiUpdateDoc(cfg, input.id, body)
}

export function folders(cfg: ClientConfig): Promise<V1Folder[]> {
  return apiListFolders(cfg)
}

export function mkdir(cfg: ClientConfig, name: string, parentId: string | null): Promise<V1Folder> {
  const body: { name: string; parentId?: string } = { name }
  if (parentId !== null) body.parentId = parentId
  return apiCreateFolder(cfg, body)
}

export function upload(cfg: ClientConfig, bytes: Uint8Array): Promise<V1Attachment> {
  return apiUploadAttachment(cfg, bytes)
}

export function link(cfg: ClientConfig, id: string): Promise<V1Link> {
  return apiCreateLink(cfg, id)
}

export function lsShared(cfg: ClientConfig): Promise<V1SharedDoc[]> {
  return apiListShared(cfg)
}

export function moveDoc(cfg: ClientConfig, input: { id: string; folderId: string | null }): Promise<V1DocSummary> {
  return apiMoveDoc(cfg, input.id, input.folderId)
}

export function removeDoc(cfg: ClientConfig, id: string): Promise<V1DeletedDoc> {
  return apiDeleteDoc(cfg, id)
}

export function removeFolder(cfg: ClientConfig, input: { id: string; all: boolean }): Promise<V1DeletedFolder> {
  return apiDeleteFolder(cfg, input.id, input.all ? 'delete-all' : 'move-up')
}
