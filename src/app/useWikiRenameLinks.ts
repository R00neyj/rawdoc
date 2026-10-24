// 제목 칸에서 나갈 때 옛 제목 위키링크를 찾아 묻고 함께 고친다 — 열린 문서는 편집기(Y.Text), 닫힌 문서는 저장소로 (small 2026-10-24)
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import {
  applyLinkEdits,
  findRenameEdits,
  planRenameEdits,
  recordAppliedEdits,
  renameContext,
  revertAppliedEdits,
  titleTakenByOther,
  type AppliedEdit,
  type LinkEdit,
  type RenameContext,
  type RenameSource,
} from '../lib/wikiRename'
import { displayDocTitle, type DocMeta } from './docMeta'
import type { EditorHandle } from '../editor/Editor'
import type { NoticeWithAction } from './NoticeBar'
import type { PaneHost } from './usePaneHost'
import type { WikiRenameDialogData } from './WikiRenameDialog'
import type { Folder, Store } from '../types'

export type UseWikiRenameLinksOptions = {
  store: Store
  docsRef: RefObject<DocMeta[]>
  foldersRef: RefObject<Folder[]>
  currentDocIdRef: RefObject<string | null>
  paneHost: PaneHost
  showNotice: (input: NoticeWithAction) => number
}

type Pending = { ctx: RenameContext; docs: { id: string; title: string; folderId: string | null; count: number }[] }
type Fixed = { id: string; after: string; applied: AppliedEdit[] }

const TITLE_FIELD = 'textarea.doc-title, input.kanban-title'

// 편집기로 고칠 수 없는 상태(읽기 전용·조합 중)면 false — 고쳐 저장하는 일은 그 문서 저장기가 한다
function dispatchEdits(editor: EditorHandle, edits: LinkEdit[]): boolean {
  const view = editor.view
  if (view.state.readOnly || view.composing) return false
  view.dispatch({ changes: edits, userEvent: 'input.wikirename' })
  return true
}

export function useWikiRenameLinks(options: UseWikiRenameLinksOptions) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })
  const [dialog, setDialog] = useState<WikiRenameDialogData | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const titlesAtFocusRef = useRef<Map<string, string> | null>(null)
  const checkSeqRef = useRef(0)

  // 제목 칸에 들어갈 때 모든 문서 제목을 기억한다 — 분할 칸은 포커스 칸 전환보다 focusin 이 먼저 온다
  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (!(event.target instanceof Element) || !event.target.matches(TITLE_FIELD)) return
      titlesAtFocusRef.current = new Map(optionsRef.current.docsRef.current.map((d) => [d.id, d.title]))
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  const checkRename = useCallback(() => {
    const { store, docsRef, foldersRef, currentDocIdRef, paneHost, showNotice } = optionsRef.current
    const docId = currentDocIdRef.current
    const oldTitle = docId === null ? undefined : titlesAtFocusRef.current?.get(docId)
    titlesAtFocusRef.current = null
    const docs = docsRef.current
    const meta = docs.find((d) => d.id === docId)
    // 금고 문서의 새 제목을 일반 문서 원문에 적지 않는다
    if (!meta || oldTitle === undefined || meta.e2ee !== undefined) return
    const refs = docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId ?? null }))
    const ctx = renameContext(refs, foldersRef.current, meta.id, oldTitle, meta.title)
    if (!ctx) return
    const seq = ++checkSeqRef.current
    void (async () => {
      const listed = new Map((await store.list().catch(() => [])).map((d) => [d.id, d.content]))
      const offline = store.kind === 'server' && (!navigator.onLine || store.syncState?.online === false)
      const sources = await Promise.all(
        docs.map(async (d): Promise<RenameSource | null> => {
          if (d.role === 'view') return null
          const editor = paneHost.editorFor(d.id)
          // 공유받은 문서는 목록에 본문이 없어 따로 읽는다
          let content = editor ? editor.view.state.doc.toString() : d.role === 'edit' ? undefined : listed.get(d.id)
          if (content === undefined && d.role === 'edit' && !offline) content = (await store.get(d.id).catch(() => null))?.content
          if (content === undefined) return null
          return { id: d.id, title: displayDocTitle(d.title), folderId: d.folderId ?? null, content, e2ee: d.e2ee !== undefined }
        }),
      )
      if (seq !== checkSeqRef.current) return
      const plan = planRenameEdits(sources.filter((s): s is RenameSource => s !== null), ctx)
      if (plan.links === 0) return
      if (offline) return void showNotice({ type: 'error', message: '오프라인이라 링크를 고치지 못했습니다' })
      const folderOf = new Map(docs.map((d) => [d.id, d.folderId ?? null]))
      const planned = plan.docs.map((d) => ({ id: d.id, title: d.title, folderId: folderOf.get(d.id) ?? null, count: d.edits.length }))
      pendingRef.current = { ctx, docs: planned }
      setDialog({
        oldTitle: ctx.oldTitle,
        newTitle: ctx.newTitle,
        links: plan.links,
        docs: planned,
        vaultSkipped: plan.vaultSkipped,
        titleTaken: titleTakenByOther(refs, meta.id, ctx.newTitle),
      })
    })()
  }, [])

  const undo = useCallback(async (fixed: Fixed[]) => {
    const { store, paneHost, showNotice } = optionsRef.current
    let reverted = 0
    let missed = 0
    for (const f of fixed) {
      try {
        const editor = paneHost.editorFor(f.id)
        const current = editor ? editor.view.state.doc.toString() : (await store.get(f.id))?.content
        if (current === undefined) throw new Error('gone')
        const result = revertAppliedEdits(current, f.after, f.applied)
        if (result.edits.length > 0) {
          if (editor) {
            if (!dispatchEdits(editor, result.edits)) throw new Error('readonly')
          } else {
            await store.update(f.id, { content: applyLinkEdits(current, result.edits) })
          }
        }
        reverted += result.edits.length
        missed += result.missed
      } catch {
        missed += f.applied.length
      }
    }
    showNotice(
      missed === 0
        ? { type: 'info', message: `링크 ${reverted}개를 되돌렸습니다` }
        : { type: 'error', message: `링크 ${reverted}개를 되돌렸고 ${missed}개는 못 되돌렸습니다` },
    )
  }, [])

  const cancel = useCallback(() => {
    pendingRef.current = null
    setDialog(null)
  }, [])

  const confirm = useCallback(async () => {
    const pending = pendingRef.current
    pendingRef.current = null
    setDialog(null)
    if (!pending) return
    const { store, paneHost, showNotice } = optionsRef.current
    const fixed: Fixed[] = []
    const failedTitles: string[] = []
    let failedLinks = 0
    for (const d of pending.docs) {
      try {
        // 대화상자가 떠 있는 사이 바뀌었을 수 있어 지금 원문으로 다시 찾는다
        const editor = paneHost.editorFor(d.id)
        const current = editor ? editor.view.state.doc.toString() : (await store.get(d.id))?.content
        if (current === undefined) throw new Error('gone')
        const edits = findRenameEdits(current, d.folderId, pending.ctx)
        if (edits.length === 0) continue
        const after = applyLinkEdits(current, edits)
        if (editor) {
          if (!dispatchEdits(editor, edits)) throw new Error('readonly')
        } else {
          await store.update(d.id, { content: after })
        }
        fixed.push({ id: d.id, after, applied: recordAppliedEdits(current, edits) })
      } catch {
        failedLinks += d.count
        failedTitles.push(d.title)
      }
    }
    const fixedLinks = fixed.reduce((n, f) => n + f.applied.length, 0)
    if (fixedLinks === 0 && failedLinks === 0) return
    const action = fixedLinks > 0 ? { label: '되돌리기', onClick: () => void undo(fixed) } : undefined
    if (failedLinks === 0) return void showNotice({ type: 'info', message: `링크 ${fixedLinks}개를 고쳤습니다`, action })
    const head = fixedLinks > 0 ? `링크 ${fixedLinks}개를 고쳤고 ${failedLinks}개는 못 고쳤습니다` : `링크 ${failedLinks}개를 못 고쳤습니다`
    showNotice({ type: 'error', message: `${head}. 못 고친 문서: ${failedTitles.join(', ')}`, action })
  }, [undo])

  return { checkRename, dialog: { data: dialog, onCancel: cancel, onConfirm: () => void confirm() } }
}
