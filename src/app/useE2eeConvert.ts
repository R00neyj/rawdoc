// 금고로 옮기기·빼기 — App.tsx 에서 옮김 (F-2073, F-2059)
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import {
  buildE2eeConvertDialogText,
  countE2eeConvertComments,
  createE2eeConvertMemory,
  estimateE2eeConvertCost,
  planE2eeConvert,
  runE2eeConvert,
  type E2eeCommentCount,
  type E2eeConvertDialogText,
  type E2eeConvertDirection,
  type E2eeConvertOutcome,
  type E2eeConvertPlan,
  type E2eeConvertProgress,
  type E2eeConvertTarget,
} from '../e2ee/convert'
import { fetchUsage } from '../storage/attachmentsApi'
import { fetchCommentCount } from '../storage/docsApi'
import type { EditorHandle } from '../editor/Editor'
import type { YjsStore } from '../storage/yjsStore'
import { formatCount } from '../lib/usageLimits'
import { Y_TITLE_NAME } from '../lib/docRoomProtocol'
import type { LineEnding, Store, SyncState } from '../types'
import { E2EE_NOTICE, E2EE_CONVERT_NOTICE, e2eeConvertProgressText, e2eeConvertResultNotice } from './appNotices'
import type { CommentAccess } from './commentRail'
import { isSharedDoc } from './docMeta'
import type { DocPathKind } from './docPath'
import type { NoticeWithAction } from './NoticeBar'
import { getPref, setPref } from './prefs'
import type { UseE2ee } from './useE2ee'
import type { LiveDocSession } from './useLiveDoc'

// 멈추기를 누르면 곧바로 풀리는 기다림 (F-407 2.2)
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done)
  })
}

export type UseE2eeConvertOptions = {
  store: Store
  syncState: SyncState | undefined
  commentAccessValue: CommentAccess
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  dismissNotice: (id: number) => void
  resyncFromStore: () => Promise<void>
  restartDocSession: () => void
  requestE2eeOpen: () => Promise<boolean>
  setConvertingDocId: Dispatch<SetStateAction<string | null>>
  e2eeConvertBusyRef: RefObject<boolean>
  e2eeRef: RefObject<UseE2ee | null>
  currentDocIdRef: RefObject<string | null>
  docPathRef: RefObject<{ docId: string | null; path: DocPathKind | null }>
  docSaverFlushRef: RefObject<() => Promise<boolean>>
  titleSavingRef: RefObject<Promise<unknown> | null>
  liveSessionRef: RefObject<LiveDocSession | null>
  editorRef: RefObject<EditorHandle | null>
  openDocLineEndingRef: RefObject<LineEnding | undefined>
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
}

export type UseE2eeConvertResult = {
  e2eeConvertOnline: boolean
  e2eeConvertBusy: boolean
  e2eeConvertText: E2eeConvertDialogText | null
  requestE2eeConvert: (direction: E2eeConvertDirection, target: E2eeConvertTarget, menuName: string) => Promise<void>
  handleE2eeConvertUnavailable: (reason: 'offline' | 'busy' | 'inside-e2ee-folder') => void
  answerE2eeConvertDialog: (ok: boolean) => void
}

export function useE2eeConvert(options: UseE2eeConvertOptions): UseE2eeConvertResult {
  const {
    store, syncState, commentAccessValue, showNotice, dismissNotice, resyncFromStore, restartDocSession, requestE2eeOpen, setConvertingDocId,
    e2eeConvertBusyRef, e2eeRef, currentDocIdRef, docPathRef, docSaverFlushRef, titleSavingRef, liveSessionRef, editorRef, openDocLineEndingRef, yjsStoreRef,
  } = options
  // 이 탭에서 옮기기·빼기가 도는 중 — 메뉴 비활성(E41)과 다른 탭 신호의 다시 열기 판정에 쓴다
  const [e2eeConvertBusy, setE2eeConvertBusy] = useState(false)
  // 올려 둔 첨부 짝·못 지운 첨부 — 페이지 수명 (F-407 2.1)
  const e2eeConvertMemoryRef = useRef(createE2eeConvertMemory())
  // 앞 실행의 끝·멈춤 알림 — 다시 누르면 걷는다(warn 이 남아 있으면 진행 info 가 가려진다)
  const e2eeConvertResultIdRef = useRef<number | null>(null)
  // D-9·D-10 — 글과 답을 기다리는 함수. 닫힘(close 이벤트)이 확인 뒤에도 오므로 답은 한 번만 쓴다
  const [e2eeConvertText, setE2eeConvertText] = useState<E2eeConvertDialogText | null>(null)
  const e2eeConvertAnswerRef = useRef<((ok: boolean) => void) | null>(null)
  // D-9 댓글 수 세기 — 대화상자가 닫히면 끊는다 (F-509 4.1 5번)
  const e2eeCommentCountAbortRef = useRef<AbortController | null>(null)

  // ----- 금고로 옮기기·빼기 (F-407 7.3~7.5) -----
  const e2eeConvertOnline = store.kind !== 'server' || (syncState?.online ?? true)

  // 7.4 — 지금 문서면 읽기 전용으로 두고 대기 저장을 끝낸다. 실시간이면 편집기 글을 잡고 세션을 닫는다
  async function prepareConvertDoc(docId: string): Promise<{ text?: string; title?: string } | null | 'blocked'> {
    if (docId !== currentDocIdRef.current) return null
    const path = docPathRef.current.docId === docId ? docPathRef.current.path : null
    setConvertingDocId(docId)
    const saved = await docSaverFlushRef.current()
    const titleSaving = titleSavingRef.current
    if (titleSaving) await titleSaving
    if (!saved) return 'blocked'
    if (path !== 'realtime') return {}
    const session = liveSessionRef.current
    const editor = editorRef.current
    // live 가 아니면(첫 동기화 전·재연결 중) 편집기 글이 서버보다 낡았을 수 있다 (F-2041 5.5)
    if (!session || session.docId !== docId || session.snapshot.phase !== 'live' || !editor) return 'blocked'
    const text = editor.getText(openDocLineEndingRef.current ?? 'lf')
    const title = session.roomDoc.getText(Y_TITLE_NAME).toString()
    // 세션이 닫힐 때까지(렌더 뒤 정리) 기다린다 — 닫힌 소켓의 정지 알림은 뜨지 않는다
    for (let i = 0; i < 100 && liveSessionRef.current !== null; i++) await abortableSleep(20, new AbortController().signal)
    return { text, title }
  }

  // 7.4 — 읽기 전용을 풀고 같은 문서를 새 세션으로 다시 연다(멈춤이면 원래 경로로)
  function finishConvertDoc(docId: string) {
    setConvertingDocId((cur) => (cur === docId ? null : cur))
    if (docId === currentDocIdRef.current) restartDocSession()
  }

  function answerE2eeConvertDialog(ok: boolean) {
    const answer = e2eeConvertAnswerRef.current
    e2eeConvertAnswerRef.current = null
    setE2eeConvertText(null)
    e2eeCommentCountAbortRef.current?.abort()
    e2eeCommentCountAbortRef.current = null
    answer?.(ok)
  }

  // 7.1 비활성 항목을 눌렀을 때의 이유 알림
  function handleE2eeConvertUnavailable(reason: 'offline' | 'busy' | 'inside-e2ee-folder') {
    if (reason === 'busy') showNotice({ type: 'info', message: E2EE_CONVERT_NOTICE.busy })
    else if (reason === 'offline') showNotice({ type: 'error', message: E2EE_CONVERT_NOTICE.offline })
    else showNotice({ type: 'info', message: E2EE_CONVERT_NOTICE.insideFolder })
  }

  // 7.3 흐름 — 확인·금고 열기·실행·결과 알림
  async function requestE2eeConvert(direction: E2eeConvertDirection, target: E2eeConvertTarget, menuName: string) {
    if (e2eeConvertBusyRef.current) {
      showNotice({ type: 'info', message: E2EE_CONVERT_NOTICE.busy })
      return
    }
    if (store.kind === 'server' && !(syncState?.online ?? navigator.onLine)) {
      showNotice({ type: 'error', message: E2EE_CONVERT_NOTICE.offline })
      return
    }
    const convertStore = store
    const scope: 'local' | 'account' = convertStore.kind === 'server' ? 'account' : 'local'
    const makePlan = async () => {
      const [list, folderList] = await Promise.all([convertStore.list(), convertStore.listFolders()])
      const owned = list.filter((d) => !isSharedDoc(d))
      return { plan: planE2eeConvert({ direction, target, docs: owned, folders: folderList }), docs: owned }
    }
    let { plan, docs: planDocs } = await makePlan()
    if (direction === 'to-e2ee') {
      const { tooLarge, tooManyRefs } = plan.blocked
      if (target.kind === 'doc' && tooLarge.length > 0) return void showNotice({ type: 'error', message: E2EE_NOTICE.createTooLarge })
      if (target.kind === 'doc' && tooManyRefs.length > 0) return void showNotice({ type: 'error', message: E2EE_NOTICE.tooManyRefs })
      if (tooLarge.length + tooManyRefs.length > 0) {
        const n = formatCount(tooLarge.length + tooManyRefs.length)
        return void showNotice({
          type: 'error',
          message: `금고에 넣을 수 없는 문서가 ${n}개 있어 폴더를 옮기지 않았습니다. 약 750KB를 넘거나 이미지가 1,000개를 넘는 문서는 나누거나 폴더 밖으로 옮긴 뒤 다시 누르세요.`,
        })
      }
    } else {
      // 빼기는 D-10 보다 먼저 연다 — 잠긴 문서 이름이 풀려야 D-10 본문이 뜻을 갖는다 (2.3 1번)
      if (!(await requestE2eeOpen())) return
      ;({ plan, docs: planDocs } = await makePlan())
    }
    const name = target.kind === 'doc' ? planDocs.find((d) => d.id === target.id)?.title || (menuName === '잠긴 문서' ? '제목 없음' : menuName) : menuName
    if (plan.steps.length === 0) {
      showNotice(e2eeConvertResultNotice({ kind: 'done', done: 0, keptAttachments: 0, purgeFailed: 0 }, direction, target.kind, name))
      return
    }

    const showBackupNotice = scope === 'account' && direction === 'to-e2ee' && getPref('md.e2eeBackupNotice', '') !== '1'
    const cost = estimateE2eeConvertCost({ plan, docs: planDocs })
    const textInput = { direction, scope, name, targetKind: target.kind, docCount: plan.docCount, folderCount: plan.folderCount, showBackupNotice, cost }
    const answered = new Promise<boolean>((resolve) => {
      e2eeConvertAnswerRef.current = resolve
    })
    const answer = e2eeConvertAnswerRef.current
    let usageForText: { writesLeft: number | null; bytesLeft: number | null } = { writesLeft: null, bytesLeft: null }
    let commentsForText: E2eeCommentCount | undefined
    const rebuildConvertText = () =>
      setE2eeConvertText(buildE2eeConvertDialogText({ ...textInput, usage: usageForText, ...(commentsForText ? { comments: commentsForText } : {}) }))
    rebuildConvertText()
    // 한도는 기다리지 않는다 — 결과가 오면 줄을 더한다 (7.2)
    if (scope === 'account') {
      fetchUsage()
        .then((usage) => {
          if (e2eeConvertAnswerRef.current !== answer) return
          usageForText = {
            writesLeft: usage.writes ? usage.writes.limit - usage.writes.today : null,
            bytesLeft: usage.docs ? usage.docs.bytesLimit - usage.docs.bytes : null,
          }
          rebuildConvertText()
        })
        .catch(() => {})
    }
    // 댓글 수 — 대화상자를 기다리게 하지 않는다, 닫히면 끊는다 (F-509 2.1·4.1)
    if (direction === 'to-e2ee') {
      const countController = new AbortController()
      e2eeCommentCountAbortRef.current = countController
      const docIds = plan.steps.filter((s) => s.kind === 'doc').map((s) => s.id)
      const liveHandle = editorRef.current
      const liveCounts = new Map<string, number | null>(
        docIds.map((id) => [
          id,
          id === currentDocIdRef.current && liveHandle && (commentAccessValue.kind === 'read' || commentAccessValue.kind === 'write')
            ? liveHandle.comments.map.size
            : null,
        ]),
      )
      countE2eeConvertComments({
        docIds,
        liveCount: (id) => liveCounts.get(id) ?? null,
        storedCount: async (id, signal) => {
          if (scope === 'account') return (await fetchCommentCount(id, { signal })).total
          return convertStore.getCommentRecords ? (await convertStore.getCommentRecords(id)).length : 0
        },
        signal: countController.signal,
      }).then((result) => {
        if (e2eeConvertAnswerRef.current !== answer || result === null) return
        commentsForText = result
        rebuildConvertText()
      })
    }
    if (!(await answered)) return
    if (showBackupNotice) setPref('md.e2eeBackupNotice', '1')
    if (direction === 'to-e2ee' && !(await requestE2eeOpen())) return
    await runE2eeConvertFlow(plan, convertStore, scope, name)
  }

  async function runE2eeConvertFlow(plan: E2eeConvertPlan, convertStore: Store, scope: 'local' | 'account', name: string) {
    const ring = e2eeRef.current
    if (!ring || e2eeConvertBusyRef.current) return
    e2eeConvertBusyRef.current = true
    setE2eeConvertBusy(true)
    if (e2eeConvertResultIdRef.current !== null) dismissNotice(e2eeConvertResultIdRef.current)
    const controller = new AbortController()
    const stopAction = { label: '멈추기', onClick: () => controller.abort() }
    let progressId: number | null = null
    let countdown: ReturnType<typeof setInterval> | null = null
    const onProgress = (p: E2eeConvertProgress) => {
      if (countdown) clearInterval(countdown)
      countdown = null
      const base = e2eeConvertProgressText(plan.direction, p.done, p.total)
      if (p.phase === 'running') {
        progressId = showNotice({ type: 'info', message: base, action: stopAction }, { sticky: true })
        return
      }
      let left = p.secondsLeft
      const show = () => {
        progressId = showNotice({ type: 'info', message: `${base} — 요청이 많아 ${formatCount(left)}초 쉬었다가 이어 갑니다.`, action: stopAction }, { sticky: true })
      }
      show()
      countdown = setInterval(() => {
        left -= 1
        if (left >= 1) show()
        else if (countdown) clearInterval(countdown)
      }, 1000)
    }
    const yjs = convertStore.kind === 'server' ? yjsStoreRef.current : null
    let outcome: E2eeConvertOutcome
    try {
      outcome = await runE2eeConvert(
        plan,
        {
          store: convertStore,
          scope,
          memory: e2eeConvertMemoryRef.current,
          signal: controller.signal,
          now: () => Date.now(),
          sleep: abortableSleep,
          isOnline: () => convertStore.kind !== 'server' || navigator.onLine,
          noteActivity: () => ring.keyring.noteActivity(),
          isOpen: () => ring.keyring.getMasterKey() !== null,
          prepareDoc: prepareConvertDoc,
          finishDoc: finishConvertDoc,
          ...(yjs
            ? {
                hasUnsyncedYjs: async (id: string) => {
                  const persist = await yjs
                  return persist ? (await persist.unsyncedDocIds()).includes(id) : false
                },
                removeYjsRecord: async (id: string) => {
                  const persist = await yjs
                  if (persist) await persist.removeDoc(id)
                },
              }
            : {}),
        },
        onProgress,
      )
    } finally {
      if (countdown) clearInterval(countdown)
      if (progressId !== null) dismissNotice(progressId)
    }
    await resyncFromStore().catch(() => {})
    e2eeConvertBusyRef.current = false
    setE2eeConvertBusy(false)
    e2eeConvertResultIdRef.current = showNotice(e2eeConvertResultNotice(outcome, plan.direction, plan.target.kind, name))
  }

  return { e2eeConvertOnline, e2eeConvertBusy, e2eeConvertText, requestE2eeConvert, handleE2eeConvertUnavailable, answerE2eeConvertDialog }
}
