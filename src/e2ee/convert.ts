// 금고로 옮기기·빼기 — 계획·비용·대화상자 글·메뉴 판정(순수)과 실행기 (specs/features/F-407.md 2~4·6장)
import type { AttachmentExt, Doc, Folder, Store } from '../types'
import { ApiError } from '../storage/docsApi'
import { AttachmentApiError } from '../storage/attachmentsApi'
import { E2EE_MAX_ATTACHMENT_REFS, envelopeBase64Length, isPlainAttachmentTooLarge, isPlainContentTooLarge, utf8ByteLength } from '../lib/e2eeLimits'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { formatCount, nextUtcMidnight } from '../lib/usageLimits'
import { isE2eeStoreError } from './e2eeStore'

export const E2EE_CONVERT_WRITE_GAP_MS = 600
export const E2EE_CONVERT_MAX_RATE_RETRIES = 5

export type E2eeConvertDirection = 'to-e2ee' | 'from-e2ee'
export type E2eeConvertTarget = { kind: 'doc'; id: string } | { kind: 'folder'; id: string }
export type E2eeConvertStep = { kind: 'doc'; id: string } | { kind: 'folder-on'; id: string } | { kind: 'folder-off'; id: string }

export type E2eeConvertPlan = {
  direction: E2eeConvertDirection
  target: E2eeConvertTarget
  steps: E2eeConvertStep[]
  docCount: number
  folderCount: number
  blocked: { tooLarge: string[]; tooManyRefs: string[] }
}

type PlanDoc = Pick<Doc, 'id' | 'folderId' | 'e2ee' | 'content' | 'updatedAt'>
type PlanFolder = Pick<Folder, 'id' | 'parentId' | 'e2ee'>

// 대상 폴더와 그 자손 폴더 id (자신 포함, 얕은 것부터)
function subtreeFolderIds(rootId: string, folders: Array<Pick<Folder, 'id' | 'parentId'>>): string[] {
  const out = [rootId]
  for (let i = 0; i < out.length; i++) {
    for (const f of folders) if (f.parentId === out[i] && !out.includes(f.id)) out.push(f.id)
  }
  return out
}

function depthMap(ids: string[], folders: PlanFolder[]): Map<string, number> {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const depth = new Map<string, number>()
  for (const id of ids) {
    let d = 0
    let cur = byId.get(id)
    const seen = new Set<string>()
    while (cur?.parentId && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = byId.get(cur.parentId)
      d++
    }
    depth.set(id, d)
  }
  return depth
}

// 순수 — 앱 층 목록으로 계획을 세운다. 잠긴 금고 문서도 e2ee 필드로 판정한다 (2.1·2.3)
export function planE2eeConvert(input: {
  direction: E2eeConvertDirection
  target: E2eeConvertTarget
  docs: PlanDoc[]
  folders: PlanFolder[]
}): E2eeConvertPlan {
  const { direction, target, docs, folders } = input
  const toE2ee = direction === 'to-e2ee'
  const steps: E2eeConvertStep[] = []
  const byRecent = (a: PlanDoc, b: PlanDoc) => b.updatedAt - a.updatedAt
  if (target.kind === 'doc') {
    const doc = docs.find((d) => d.id === target.id)
    if (doc && (toE2ee ? !doc.e2ee : !!doc.e2ee)) steps.push({ kind: 'doc', id: doc.id })
  } else {
    const ids = subtreeFolderIds(target.id, folders)
    const depth = depthMap(ids, folders)
    const inTree = ids.map((id) => folders.find((f) => f.id === id)).filter((f): f is PlanFolder => !!f)
    if (toE2ee) {
      const plainFolders = inTree.filter((f) => f.e2ee !== true)
      const order = plainFolders.map((f, i) => ({ f, i })).sort((a, b) => depth.get(b.f.id)! - depth.get(a.f.id)! || a.i - b.i)
      for (const { f } of order) {
        for (const d of docs.filter((x) => x.folderId === f.id && !x.e2ee).sort(byRecent)) steps.push({ kind: 'doc', id: d.id })
        steps.push({ kind: 'folder-on', id: f.id })
      }
    } else {
      for (const f of inTree.filter((x) => x.e2ee === true)) steps.push({ kind: 'folder-off', id: f.id })
      const idSet = new Set(ids)
      const e2eeDocSteps = docs
        .filter((d) => !!d.e2ee && d.folderId !== null && idSet.has(d.folderId))
        .sort((a, b) => depth.get(a.folderId!)! - depth.get(b.folderId!)! || byRecent(a, b))
      for (const d of e2eeDocSteps) steps.push({ kind: 'doc', id: d.id })
    }
  }
  const docSteps = steps.filter((s) => s.kind === 'doc')
  const folderSteps = steps.filter((s) => s.kind !== 'doc' && !(target.kind === 'folder' && s.id === target.id))
  const blocked = { tooLarge: [] as string[], tooManyRefs: [] as string[] }
  if (toE2ee) {
    const byId = new Map(docs.map((d) => [d.id, d]))
    for (const s of docSteps) {
      const content = byId.get(s.id)?.content ?? ''
      if (isPlainContentTooLarge(content)) blocked.tooLarge.push(s.id)
      else if (extractAttachmentRefs(content).size > E2EE_MAX_ATTACHMENT_REFS) blocked.tooManyRefs.push(s.id)
    }
  }
  return { direction, target, steps, docCount: docSteps.length, folderCount: folderSteps.length, blocked }
}

// 순수 — D-9·D-10 의 N2·N3 판정 재료 (2.5)
export function estimateE2eeConvertCost(input: { plan: E2eeConvertPlan; docs: Array<Pick<Doc, 'id' | 'content'>> }): { writes: number; deltaBytes: number } {
  const { plan, docs } = input
  const byId = new Map(docs.map((d) => [d.id, d]))
  const attachments = new Set<string>()
  let deltaBytes = 0
  for (const s of plan.steps) {
    if (s.kind !== 'doc') continue
    const content = byId.get(s.id)?.content ?? ''
    for (const id of extractAttachmentRefs(content)) attachments.add(id)
    if (plan.direction === 'to-e2ee') {
      const bytes = utf8ByteLength(content)
      deltaBytes += envelopeBase64Length(bytes) - bytes
    }
  }
  return { writes: plan.steps.length + 2 * attachments.size, deltaBytes }
}

const LINK_RE = /attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)/g

// 순수 — 본문의 첨부 줄 (등장 순서, 중복 없음). imageBlock REF_RE 와 같은 글자 규칙
export function attachmentLinksOf(content: string): Array<{ id: string; ext: AttachmentExt }> {
  const seen = new Set<string>()
  const out: Array<{ id: string; ext: AttachmentExt }> = []
  for (const m of content.matchAll(LINK_RE)) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ id: m[1], ext: m[2] as AttachmentExt })
  }
  return out
}

// 순수 — 짝이 있는 첨부 줄만 새 id·ext 로 바꾼다. 그 밖 글자는 그대로
export function rewriteAttachmentLinks(content: string, map: ReadonlyMap<string, { id: string; ext: AttachmentExt }>): string {
  return content.replace(LINK_RE, (whole, id: string) => {
    const next = map.get(id)
    return next ? `attachments/${next.id}.${next.ext}` : whole
  })
}

export type E2eeMenuState = { convert: 'hidden' | 'enabled'; unconvert: 'hidden' | 'enabled' | 'inside-e2ee-folder' }

// 순수 — 문서 행 메뉴 (7.1)
export function e2eeMenuForDoc(doc: Pick<Doc, 'folderId' | 'e2ee'>, folders: Array<Pick<Folder, 'id' | 'e2ee'>>): E2eeMenuState {
  if (!doc.e2ee) return { convert: 'enabled', unconvert: 'hidden' }
  const inE2eeFolder = doc.folderId !== null && folders.some((f) => f.id === doc.folderId && f.e2ee === true)
  return { convert: 'hidden', unconvert: inE2eeFolder ? 'inside-e2ee-folder' : 'enabled' }
}

// 순수 — 폴더 행 메뉴 (7.1). 금고 폴더는 가장 바깥 것만, 일반 폴더는 아래에 금고가 있으면 빼기도
export function e2eeMenuForFolder(
  folderId: string,
  docs: Array<Pick<Doc, 'folderId' | 'e2ee'>>,
  folders: Array<Pick<Folder, 'id' | 'parentId' | 'e2ee'>>,
): E2eeMenuState {
  const folder = folders.find((f) => f.id === folderId)
  if (!folder) return { convert: 'hidden', unconvert: 'hidden' }
  if (folder.e2ee === true) {
    const parentE2ee = folder.parentId !== null && folders.some((f) => f.id === folder.parentId && f.e2ee === true)
    return { convert: 'hidden', unconvert: parentE2ee ? 'hidden' : 'enabled' }
  }
  const ids = new Set(subtreeFolderIds(folderId, folders))
  const hasE2ee = folders.some((f) => ids.has(f.id) && f.e2ee === true) || docs.some((d) => !!d.e2ee && d.folderId !== null && ids.has(d.folderId))
  return { convert: 'enabled', unconvert: hasE2ee ? 'enabled' : 'hidden' }
}

export type E2eeConvertDialogText = {
  title: string
  body: string
  notes: string[]
  backupNotice: string | null
  confirmLabel: string
}

const BACKUP_NOTICE = '옮기기 전의 내용은 서버의 자동 백업(장애 복구용)에 최대 30일 남았다가 사라집니다. 백업은 화면에서 볼 수 없고 서버 장애를 되돌릴 때만 씁니다.'

// 순수 — D-9·D-10 의 글 (7.2). notes 순서가 계약이다
export function buildE2eeConvertDialogText(input: {
  direction: E2eeConvertDirection
  scope: 'local' | 'account'
  name: string
  targetKind: 'doc' | 'folder'
  docCount: number
  folderCount: number
  showBackupNotice: boolean
  usage: { writesLeft: number | null; bytesLeft: number | null }
  cost: { writes: number; deltaBytes: number }
}): E2eeConvertDialogText {
  const { direction, scope, name, targetKind, docCount, folderCount, usage, cost } = input
  const toE2ee = direction === 'to-e2ee'
  const local = scope === 'local'
  const body = toE2ee
    ? local
      ? `"${name}"을(를) 암호화해 이 브라우저의 금고에 넣습니다.`
      : `"${name}"을(를) 암호화해 금고에 넣습니다. 공유 링크와 초대는 끊깁니다. 다른 기기에서 열어 둔 편집 중 저장되지 않은 내용은 사라질 수 있습니다.`
    : local
      ? `"${name}"을(를) 복호화해 일반 문서로 저장합니다. 이 브라우저에 암호화하지 않은 채 저장됩니다.`
      : `"${name}"을(를) 복호화해 일반 문서로 저장합니다. 서버가 내용을 읽을 수 있게 됩니다.`
  const notes: string[] = []
  if (targetKind === 'folder') {
    const n = formatCount(docCount)
    const m = formatCount(folderCount)
    if (toE2ee) notes.push(folderCount > 0 ? `폴더 안 문서 ${n}개와 하위 폴더 ${m}개를 함께 옮깁니다.` : `폴더 안 문서 ${n}개를 함께 옮깁니다.`)
    else notes.push(folderCount > 0 ? `폴더 안 금고 문서 ${n}개와 금고 폴더 ${m}개를 모두 뺍니다.` : `폴더 안 금고 문서 ${n}개를 모두 뺍니다.`)
  }
  if (!local && toE2ee && usage.bytesLeft !== null && cost.deltaBytes > usage.bytesLeft) {
    notes.push('계정의 문서 저장 공간이 모자라 중간에 멈출 수 있습니다. 금고 문서는 암호화로 약 1.34배 커집니다.')
  }
  if (!local && usage.writesLeft !== null && cost.writes > usage.writesLeft) {
    const [ing, will] = toE2ee ? ['옮기는', '옮길'] : ['빼는', '뺄']
    notes.push(
      `오늘 남은 저장 횟수(${formatCount(usage.writesLeft)}번)보다 ${ing} 데 드는 횟수(약 ${formatCount(cost.writes)}번)가 많아 중간에 멈출 수 있습니다. 멈추면 다음 날 다시 눌러 이어 ${will} 수 있습니다.`,
    )
  }
  return {
    title: toE2ee ? '금고로 옮기기' : '금고에서 빼기',
    body,
    notes,
    backupNotice: toE2ee && !local && input.showBackupNotice ? BACKUP_NOTICE : null,
    confirmLabel: toE2ee ? '옮기기' : '빼기',
  }
}

export type E2eeConvertMemory = {
  uploaded: Map<string, { id: string; ext: AttachmentExt }>
  pendingDeletes: Array<{ id: string; ext: AttachmentExt }>
}

export function createE2eeConvertMemory(): E2eeConvertMemory {
  return { uploaded: new Map(), pendingDeletes: [] }
}

export type E2eeConvertProgress =
  | { phase: 'running'; done: number; total: number }
  | { phase: 'waiting'; done: number; total: number; secondsLeft: number }

export type E2eeConvertStopReason =
  | 'cancelled'
  | 'offline'
  | 'day-limit'
  | 'rate-limited'
  | 'doc-quota'
  | 'attachment-quota'
  | 'account-blocked'
  | 'locked'
  | 'conflict'
  | 'pending-sync'
  | 'attachment-too-large'
  | 'not-ready'
  | 'too-large'
  | 'failed'

export type E2eeConvertOutcome =
  | { kind: 'done'; done: number; keptAttachments: number; purgeFailed: number }
  | { kind: 'stopped'; done: number; total: number; reason: E2eeConvertStopReason; resetAt?: number; purgeFailed: number }

export type E2eeConvertDeps = {
  store: Store
  scope: 'local' | 'account'
  memory: E2eeConvertMemory
  signal: AbortSignal
  now(): number
  sleep(ms: number, signal: AbortSignal): Promise<void>
  isOnline(): boolean
  noteActivity(): void
  isOpen(): boolean
  // text 는 편집기 글, title 은 실시간 방의 제목(있을 때만) — 둘 다 없으면 저장소에서 읽는다. null 이 아니면('blocked' 포함) finishDoc 을 꼭 부른다 (7.4)
  prepareDoc(docId: string): Promise<{ text?: string; title?: string } | null | 'blocked'>
  finishDoc(docId: string, changed: boolean): void
  hasUnsyncedYjs?(docId: string): Promise<boolean>
  removeYjsRecord?(docId: string): Promise<void>
}

// 실행기 안에서 멈춤을 나르는 값 — 밖으로는 던지지 않는다
class Stop {
  constructor(
    readonly reason: E2eeConvertStopReason,
    readonly resetAt?: number,
  ) {}
}

type Classified =
  | { kind: 'minute'; retryAfter: number }
  | { kind: 'stop'; reason: E2eeConvertStopReason; resetAt?: number }
  | { kind: 'elsewhere' }
  | { kind: 'conflict' }
  | { kind: 'not-ready' }
  | { kind: 'unknown' }

// 6장 표 — 어느 요청의 오류든 한 곳에서 가른다
function classify(err: unknown, direction: E2eeConvertDirection, now: number): Classified {
  if (err instanceof ApiError || err instanceof AttachmentApiError) {
    const kind: string = err.kind
    if (kind === 'rate_limited') {
      if (err.scope === 'day') return { kind: 'stop', reason: 'day-limit', resetAt: nextUtcMidnight(now) }
      return { kind: 'minute', retryAfter: err.retryAfter ?? 60 }
    }
    if (kind === 'network') return { kind: 'stop', reason: 'offline' }
    if (kind === 'doc_quota_exceeded') return { kind: 'stop', reason: 'doc-quota' }
    if (kind === 'quota_exceeded') return { kind: 'stop', reason: 'attachment-quota' }
    if (kind === 'account_blocked') return { kind: 'stop', reason: 'account-blocked' }
    if (kind === 'conflict') return { kind: 'conflict' }
    if (kind === 'e2ee_folder_not_ready') return { kind: 'not-ready' }
    if ((kind === 'e2ee_doc' && direction === 'to-e2ee') || (kind === 'not_e2ee' && direction === 'from-e2ee')) return { kind: 'elsewhere' }
    return { kind: 'stop', reason: 'failed' }
  }
  if (isE2eeStoreError(err, 'locked')) return { kind: 'stop', reason: 'locked' }
  if (isE2eeStoreError(err, 'too-large') || isE2eeStoreError(err, 'too-many-refs')) return { kind: 'stop', reason: 'too-large' }
  if (err instanceof Error) {
    if (err.name === 'pending_sync') return { kind: 'stop', reason: 'pending-sync' }
    if (err.name === 'quota_exceeded') return { kind: 'stop', reason: 'attachment-quota' }
    if (err.message === 'e2ee_folder_not_ready') return { kind: 'not-ready' }
    if (err.message === 'e2ee_folder') return { kind: 'stop', reason: 'failed' }
  }
  return { kind: 'unknown' }
}

type DocRead = { title: string; content: string; e2ee: Doc['e2ee']; fromEditor: boolean } | null

// 실행기 — 단계를 하나씩, 모든 실패는 stopped 로 돌려준다 (4·6장)
export async function runE2eeConvert(
  plan: E2eeConvertPlan,
  deps: E2eeConvertDeps,
  onProgress: (p: E2eeConvertProgress) => void,
): Promise<E2eeConvertOutcome> {
  const { store, memory, signal } = deps
  const direction = plan.direction
  const toE2ee = direction === 'to-e2ee'
  const server = deps.scope === 'account'
  const extra = store as Store & {
    hasPendingChanges?(docId: string): Promise<boolean>
    refreshDocFromServer?(docId: string): Promise<Doc | null>
  }
  let done = 0
  let total = plan.docCount
  let purgeFailed = 0
  let lastWriteAt: number | null = null
  let currentStep = 'start'
  // 옮긴 뒤 지우기는 멈추기와 상관없이 간격을 지킨다
  const neverAbort = new AbortController().signal

  const progress = () => onProgress({ phase: 'running', done, total })

  // 쓰기 간격 600ms (서버만) — 앞 쓰기를 보낸 시각에서 잰다 (2.2)
  async function gap() {
    if (!server || lastWriteAt === null) return
    const wait = lastWriteAt + E2EE_CONVERT_WRITE_GAP_MS - deps.now()
    if (wait > 0) await deps.sleep(wait, signal)
  }

  // 쓰기 한 번 — minute 429 는 기다렸다 같은 요청을 다시, 연달아 5번이면 멈춘다
  async function write<T>(send: () => Promise<T>, opts: { cancellable: boolean }): Promise<T> {
    let rateHits = 0
    for (;;) {
      if (opts.cancellable && signal.aborted) throw new Stop('cancelled')
      await gap()
      if (opts.cancellable && signal.aborted) throw new Stop('cancelled')
      lastWriteAt = deps.now()
      try {
        return await send()
      } catch (err) {
        const c = classify(err, direction, deps.now())
        if (c.kind !== 'minute') throw err
        rateHits++
        if (rateHits >= E2EE_CONVERT_MAX_RATE_RETRIES) throw new Stop('rate-limited')
        onProgress({ phase: 'waiting', done, total, secondsLeft: c.retryAfter })
        await deps.sleep(c.retryAfter * 1000, signal)
        if (opts.cancellable && signal.aborted) throw new Stop('cancelled')
        progress()
      }
    }
  }

  // 옛 첨부 지우기 — 실패해도 멈추지 않고 남긴다 (4.1 ⑦)
  async function discard(att: { id: string; ext: AttachmentExt }): Promise<'deleted' | 'not_found' | 'in_use' | 'failed'> {
    if (!store.discardAttachment) return 'failed'
    if (server && lastWriteAt !== null) {
      const wait = lastWriteAt + E2EE_CONVERT_WRITE_GAP_MS - deps.now()
      if (wait > 0) await deps.sleep(wait, neverAbort)
    }
    lastWriteAt = deps.now()
    try {
      return await store.discardAttachment(att.id, att.ext)
    } catch {
      return 'failed'
    }
  }

  function keepForLater(att: { id: string; ext: AttachmentExt }) {
    if (!memory.pendingDeletes.some((p) => p.id === att.id)) memory.pendingDeletes.push(att)
  }

  // 남은 지우기를 한 번씩 — 남은 in_use 수를 돌려준다 (6장 끝 처리)
  async function retryPendingDeletes(): Promise<number> {
    const list = memory.pendingDeletes.splice(0)
    let inUse = 0
    for (const att of list) {
      const r = await discard(att)
      if (r === 'in_use') inUse++
      if (r === 'in_use' || r === 'failed') keepForLater(att)
    }
    return inUse
  }

  // 4.3 읽기 규칙
  async function readDoc(id: string, prep: { text?: string; title?: string } | null): Promise<DocRead> {
    if (prep && prep.text !== undefined) {
      const fresh = server && extra.refreshDocFromServer ? await extra.refreshDocFromServer(id) : null
      const row = fresh ?? (await store.get(id))
      if (!row) return null
      return { title: prep.title ?? row.title, content: prep.text, e2ee: row.e2ee, fromEditor: true }
    }
    let row: Doc | null
    if (server && !prep && extra.refreshDocFromServer) {
      const pending = extra.hasPendingChanges ? await extra.hasPendingChanges(id) : false
      row = pending ? await store.get(id) : ((await extra.refreshDocFromServer(id)) ?? (await store.get(id)))
    } else {
      row = await store.get(id)
    }
    if (!row) return null
    return { title: row.title, content: row.content, e2ee: row.e2ee, fromEditor: false }
  }

  // 4.1 ④ — 첨부 바꾸기. 바꾼 옛 첨부 목록과 짝을 돌려준다
  async function swapAttachments(content: string): Promise<{ map: Map<string, { id: string; ext: AttachmentExt }>; old: Array<{ id: string; ext: AttachmentExt }> }> {
    const map = new Map<string, { id: string; ext: AttachmentExt }>()
    const old: Array<{ id: string; ext: AttachmentExt }> = []
    for (const link of attachmentLinksOf(content)) {
      const key = `${direction}:${link.id}`
      const known = memory.uploaded.get(key)
      if (known) {
        map.set(link.id, known)
        old.push(link)
        continue
      }
      currentStep = `attachment ${link.id}`
      const att = await store.getAttachment(link.id, { ext: link.ext })
      if (!att) {
        if (!toE2ee && !deps.isOpen()) throw new Stop('locked')
        continue
      }
      if (toE2ee ? att.e2ee === true : att.e2ee !== true) continue
      if (toE2ee && isPlainAttachmentTooLarge(att.blob.size)) throw new Stop('attachment-too-large')
      if (!store.putAttachmentNow) throw new Stop('failed')
      const putNow = store.putAttachmentNow
      const input = { blob: att.blob, mime: att.mime, ext: att.ext, width: att.width, height: att.height }
      let put: { id: string; ext: AttachmentExt }
      try {
        put = await write(() => putNow(toE2ee ? { ...input, e2ee: true } : input), { cancellable: true })
      } catch (err) {
        if (toE2ee && isE2eeStoreError(err, 'too-large')) throw new Stop('attachment-too-large')
        throw err
      }
      memory.uploaded.set(key, put)
      map.set(link.id, put)
      old.push(link)
    }
    return { map, old }
  }

  // 문서 단계 하나 (4.1·4.5). 끝나면(끝난 것으로 친 경우 포함) done +1
  async function runDocStep(id: string) {
    deps.noteActivity()
    if (signal.aborted) throw new Stop('cancelled')
    if (!deps.isOpen()) throw new Stop('locked')
    if (!deps.isOnline()) throw new Stop('offline')
    currentStep = `prepare ${id}`
    const prepared = await deps.prepareDoc(id)
    const prep = prepared === 'blocked' ? null : prepared
    let changed = false
    try {
      if (prepared === 'blocked') throw new Stop('pending-sync')
      if (server && deps.hasUnsyncedYjs && (await deps.hasUnsyncedYjs(id))) throw new Stop('pending-sync')
      let conflicts = 0
      let read: DocRead = null
      let swap: Awaited<ReturnType<typeof swapAttachments>> | null = null
      let body = ''
      for (;;) {
        if (!read || !read.fromEditor) {
          currentStep = `read ${id}`
          read = await readDoc(id, prep)
          if (!read) break
          if (toE2ee ? !!read.e2ee : !read.e2ee) {
            changed = true
            break
          }
          if (!toE2ee && read.e2ee === 'locked') throw new Stop(deps.isOpen() ? 'failed' : 'locked')
          if (toE2ee && (isPlainContentTooLarge(read.content) || extractAttachmentRefs(read.content).size > E2EE_MAX_ATTACHMENT_REFS)) throw new Stop('too-large')
          swap = await swapAttachments(read.content)
          body = rewriteAttachmentLinks(read.content, swap.map)
        }
        currentStep = `move ${id}`
        const setDoc = store.setDocE2ee
        if (!setDoc) throw new Stop('failed')
        const title = read.title
        try {
          const res = await write(() => setDoc(id, { e2ee: toE2ee, title, content: body }), { cancellable: true })
          if (!res.purged) purgeFailed++
          changed = true
        } catch (err) {
          if (err instanceof Stop) throw err
          const c = classify(err, direction, deps.now())
          if (c.kind === 'elsewhere') {
            changed = true
            break
          }
          if (c.kind !== 'conflict') throw err
          conflicts++
          if (conflicts > 3) throw new Stop('conflict')
          if (!read.fromEditor && server && extra.hasPendingChanges && (await extra.hasPendingChanges(id))) throw new Stop('conflict')
          if (extra.refreshDocFromServer) await extra.refreshDocFromServer(id)
          continue
        }
        // 옮긴 뒤는 멈추기와 상관없이 끝까지 (4.1 ⑦⑧)
        for (const att of swap?.old ?? []) {
          const r = await discard(att)
          if (r === 'in_use' || r === 'failed') keepForLater(att)
        }
        if (toE2ee && server && deps.removeYjsRecord) {
          try {
            await deps.removeYjsRecord(id)
          } catch (err) {
            console.error('e2ee_convert_yjs_remove_failed', id, err)
          }
        }
        break
      }
    } finally {
      if (prepared !== null) deps.finishDoc(id, changed)
    }
    done++
    progress()
  }

  let replanned = false

  // 4.2 — 켜기에서 not-ready 면 지금 목록으로 한 번 다시 세운다
  async function replan(): Promise<E2eeConvertStep[]> {
    const [docs, folders] = await Promise.all([store.list(), store.listFolders()])
    const next = planE2eeConvert({ direction, target: plan.target, docs: docs.filter((d) => d.role !== 'edit' && d.role !== 'view'), folders })
    if (next.blocked.tooLarge.length > 0 || next.blocked.tooManyRefs.length > 0) throw new Stop('too-large')
    total = done + next.docCount
    progress()
    return next.steps
  }

  let steps = plan.steps
  try {
    progress()
    if (memory.pendingDeletes.length > 0) await retryPendingDeletes()
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (signal.aborted) throw new Stop('cancelled')
      if (step.kind === 'doc') {
        await runDocStep(step.id)
        continue
      }
      deps.noteActivity()
      if (!deps.isOnline()) throw new Stop('offline')
      currentStep = `${step.kind} ${step.id}`
      const setFolder = store.setFolderE2ee
      if (!setFolder) throw new Stop('failed')
      try {
        await write(() => setFolder(step.id, step.kind === 'folder-on'), { cancellable: true })
      } catch (err) {
        if (err instanceof Stop) throw err
        const c = classify(err, direction, deps.now())
        if (c.kind !== 'not-ready' || step.kind !== 'folder-on') throw err
        if (replanned) throw new Stop('not-ready')
        replanned = true
        steps = await replan()
        i = -1
      }
    }
    const keptAttachments = memory.pendingDeletes.length > 0 ? await retryPendingDeletes() : 0
    return { kind: 'done', done, keptAttachments, purgeFailed }
  } catch (err) {
    let stop: Stop
    if (err instanceof Stop) stop = err
    else {
      const c = classify(err, direction, deps.now())
      if (c.kind === 'stop') stop = new Stop(c.reason, c.resetAt)
      else if (c.kind === 'conflict') stop = new Stop('conflict')
      else if (c.kind === 'not-ready') stop = new Stop('not-ready')
      else {
        console.error('e2ee_convert_failed', currentStep, err)
        stop = new Stop('failed')
      }
    }
    const skipCleanup = stop.reason === 'offline' || stop.reason === 'day-limit' || stop.reason === 'account-blocked' || stop.reason === 'cancelled'
    if (!skipCleanup && memory.pendingDeletes.length > 0) {
      try {
        await retryPendingDeletes()
      } catch {
        // 끝 처리 실패는 결과를 바꾸지 않는다
      }
    }
    return { kind: 'stopped', done, total, reason: stop.reason, ...(stop.resetAt !== undefined ? { resetAt: stop.resetAt } : {}), purgeFailed }
  }
}
