// 로컬 → 계정 이관 (specs/features/F-208.md 2장) — 계정마다 한 번, 옮긴 계정 id 를 md.localMigrated 로 기록한다
// 로컬 금고 로그인 이관 (specs/features/F-408.md 3.3·4장) — checkLocalE2eeMigration·runLocalE2eeMigration
import type { Attachment, AttachmentExt, Doc, Folder } from '../types'
import { GUIDE_DOC_TITLE, GUIDE_DOC_CONTENT_CRLF } from './guideDoc'
import { encryptLocalPlainAttachment, planLocalE2eeMigration, rekeyLocalE2eeAttachment, rekeyLocalE2eeDoc, type LocalE2eeKeys } from '../e2ee/convert'
import type { ServerStore } from '../storage/serverStore'
import type { CommentRecord } from '../lib/docComments'

// comments — 문서 id → 로컬 댓글 기록. 없으면 빈 것으로 본다 (F-508.md 3.1·7.1)
export type LocalSnapshot = { folders: Folder[]; docs: Doc[]; comments?: Map<string, CommentRecord[]> }

export type MigrateLocalDeps = {
  userId: string
  getPref: (key: string, fallback: string) => string
  setPref: (key: string, value: string) => void
  readLocal: () => Promise<LocalSnapshot>
  importLocal: (input: LocalSnapshot) => Promise<{ importedCount: number }>
  notice: (n: { type: 'info' | 'error'; message: string }) => void
  // 이관이 끝난 뒤 사이드바 목록을 새로고침한다 (2.2 4단계). 실패해도 이관 결과에는 영향 없다
  afterImport?: () => Promise<void> | void
}

const MIGRATED_KEY = 'md.localMigrated'

export async function migrateLocalIfNeeded(deps: MigrateLocalDeps): Promise<void> {
  const { userId, getPref, setPref, readLocal, importLocal, notice, afterImport } = deps

  // 이 브라우저에서 이미 옮긴 계정이면 건너뛴다 — 다른 계정으로 로그인하면 다시 옮긴다 (2.1)
  if (getPref(MIGRATED_KEY, '') === userId) return

  const local = await readLocal()
  const folders = local.folders
  const comments = local.comments
  // 손대지 않은 첫 실행 안내 문서는 옮기지 않는다 — 기기마다 새 id 로 만들어져 계정에 쌓인다 (2.2)
  // 단, 댓글 기록이 1개 이상이면 사용자가 쓴 것이니 옮긴다 (F-508.md 7.1 Q5)
  const docs = local.docs.filter((d) => {
    const isUntouchedGuide = d.title === GUIDE_DOC_TITLE && d.content === GUIDE_DOC_CONTENT_CRLF
    if (!isUntouchedGuide) return true
    return Boolean(comments?.get(d.id)?.length)
  })

  // 문서도 폴더도 없으면 옮길 게 없다 — 폴더만 있는 경우(문서 없이 폴더만 만든 사용자)는 아래에서 folders 를 계속 옮긴다
  if (docs.length === 0 && folders.length === 0) {
    setPref(MIGRATED_KEY, userId)
    return
  }

  if (docs.length > 0) {
    notice({ type: 'info', message: `로컬 문서 ${docs.length}개를 계정으로 옮기는 중…` })
  }

  let result: { importedCount: number }
  try {
    result = await importLocal({ folders, docs, comments })
  } catch {
    // 캐시 쓰기 자체가 실패하면 기록하지 않는다 (2.2 5단계)
    notice({ type: 'error', message: '로컬 문서를 옮기지 못했습니다. 다시 시도하려면 새로고침하세요.' })
    return
  }

  setPref(MIGRATED_KEY, userId)
  await afterImport?.()
  if (result.importedCount > 0) {
    notice({ type: 'info', message: `로컬 문서 ${result.importedCount}개를 계정에 넣었습니다. 서버로 보내는 중입니다.` })
  }
}

// ---- 로컬 금고 로그인 이관 (F-408 3.3) ----

export type LocalE2eeCheckDeps = {
  userId: string
  localDbExists(): Promise<boolean> // indexedDB.databases() 에 'md-docs' 가 있나. API 가 없으면 true
  readLocalRow(): Promise<{ bundle: string; migratedTo?: string[] } | null>
  readLocal(): Promise<LocalSnapshot> // createIdbStore 그대로 (저장소 층)
  accountIds(): { docIds: ReadonlySet<string>; folderIds: ReadonlySet<string> }
  markMigrated(bundle: string): Promise<boolean> // markLocalE2eeMigrated(userId, bundle)
}
export type LocalE2eeCheck = { kind: 'skip' } | { kind: 'ask'; count: number; bundle: string }

// 부팅마다 한 번 — 판정은 4.1 번호가 계약이다
export async function checkLocalE2eeMigration(deps: LocalE2eeCheckDeps): Promise<LocalE2eeCheck> {
  try {
    if (!(await deps.localDbExists())) return { kind: 'skip' }
    const row = await deps.readLocalRow()
    if (!row) return { kind: 'skip' }
    if (row.migratedTo?.includes(deps.userId)) return { kind: 'skip' }
    const local = await deps.readLocal()
    const plan = planLocalE2eeMigration({ local: { folders: local.folders, docs: local.docs }, account: deps.accountIds() })
    if (plan.docs.length === 0) {
      await deps.markMigrated(row.bundle)
      return { kind: 'skip' }
    }
    return { kind: 'ask', count: plan.docs.length, bundle: row.bundle }
  } catch (err) {
    console.error('e2ee_migrate_check_failed', err)
    return { kind: 'skip' }
  }
}

export type LocalE2eeRunDeps = LocalE2eeCheckDeps & {
  bundle: string // D-14 가 연 로컬 묶음 (markMigrated 조건)
  keys: LocalE2eeKeys
  getLocalAttachment(id: string): Promise<Attachment | null> // createIdbStore 그대로
  importLocalE2ee: ServerStore['importLocalE2ee']
  keyAlive(): boolean // rewrap: 계정 열쇠고리 getMasterKey() !== null. adopt: 늘 true
  noteActivity(): void
  onProgress(done: number, total: number): void
}
export type LocalE2eeOutcome =
  | { kind: 'done'; count: number; skippedImages: number }
  | { kind: 'stopped'; reason: 'locked' | 'failed'; done: number; total: number }

// 실행 — 번호가 계약이다 (4.4)
export async function runLocalE2eeMigration(deps: LocalE2eeRunDeps): Promise<LocalE2eeOutcome> {
  let done = 0
  let total = 0
  try {
    // 1. 계획을 다시 세운다 — D-14 를 연 사이 바뀌었을 수 있다
    const local = await deps.readLocal()
    const plan = planLocalE2eeMigration({ local: { folders: local.folders, docs: local.docs }, account: deps.accountIds() })
    total = plan.docs.length

    // 2. 폴더 전부를 한 번
    if (plan.folders.length > 0) {
      await deps.importLocalE2ee({ folders: plan.folders })
    }

    // 한 실행 안에서 같은 평문 첨부를 여러 문서가 쓰면 한 번만 암호화한다 (4.3)
    const encryptedPlainAttachments = new Map<string, { id: string; ext: AttachmentExt }>()
    let skippedImages = 0

    // 3. 문서마다
    for (const doc of plan.docs) {
      if (!deps.keyAlive()) return { kind: 'stopped', reason: 'locked', done, total }
      deps.noteActivity()

      const links = new Map<string, { id: string; ext: AttachmentExt }>()
      for (const refId of doc.attachmentRefs ?? []) {
        const attachment = await deps.getLocalAttachment(refId)
        if (!attachment) continue // 로컬에서도 깨진 이미지
        if (attachment.e2ee === true) {
          const rekeyed = await rekeyLocalE2eeAttachment(attachment, deps.keys)
          await deps.importLocalE2ee({ attachments: [rekeyed] })
          continue
        }
        // 평문 첨부 (4.3)
        const known = encryptedPlainAttachments.get(refId)
        if (known) {
          links.set(refId, known)
          continue
        }
        const encrypted = await encryptLocalPlainAttachment(attachment, deps.keys)
        if (!encrypted) {
          skippedImages++
          continue
        }
        await deps.importLocalE2ee({ attachments: [encrypted] })
        const pair = { id: encrypted.id, ext: encrypted.ext }
        encryptedPlainAttachments.set(refId, pair)
        links.set(refId, pair)
      }

      let rekeyedDoc: Doc
      try {
        rekeyedDoc = await rekeyLocalE2eeDoc(doc, deps.keys, links)
      } catch (err) {
        // 로컬에서도 열리지 않는 손상 문서 — 건너뛰고 세지 않는다 (F-405 4.1)
        console.error('e2ee_migrate_doc_failed', doc.id, err)
        continue
      }
      await deps.importLocalE2ee({ docs: [rekeyedDoc] })

      done++
      deps.onProgress(done, total)
    }

    // 4. 끝
    await deps.markMigrated(deps.bundle)
    // 5.
    return { kind: 'done', count: done, skippedImages }
  } catch (err) {
    console.error('e2ee_migrate_failed', 'run', err)
    return { kind: 'stopped', reason: 'failed', done, total }
  }
}
