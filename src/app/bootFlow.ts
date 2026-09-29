// 부팅(계정·저장소·첫 목록·첫 화면)과 밀린 편집 러너 — App.tsx 에서 옮김 (F-2074, F-2059)
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { flushSync } from 'react-dom'
import { createIdbStore } from '../storage/idbStore'
import { openStore } from '../storage/openStore'
import type { ServerStore } from '../storage/serverStore'
import { openYjsStore, type YjsStore } from '../storage/yjsStore'
import { openLiveSocket } from '../storage/liveSocket'
import { migrateLocalIfNeeded } from './migrateLocal'
import { ancestorsOfDoc } from '../lib/folderTree'
import type { ShareDoc } from '../lib/shareCodec'
import type { Doc, Folder, Store } from '../types'
import { getPref, setPref } from './prefs'
import { fetchAccount, type AccountState } from './account'
import { IconRefresh } from './icons'
import { parseHash, type HashRoute } from './hashRoute'
import { stripContent, sortByUpdatedAtDesc, type DocMeta } from './docMeta'
import { resolveInitialDoc } from './resolveInitialDoc'
import { canShowCachedShell, mergeBootList, shouldApplyListResult } from './bootList'
import type { DocPathKind } from './docPath'
import { createLiveDocController } from './liveDoc'
import { leaveScreens } from './leaveScreens'
import { flushUnsyncedDocs } from './yjsFlush'
import { withTabBroadcast, type TabMessage } from './tabSync'
import { withE2ee, type E2eeStore } from '../e2ee/e2eeStore'
import { cleanupUnusedAttachments, scheduleAttachmentGc } from './attachmentGc'
import type { NoticeWithAction } from './NoticeBar'
import type { PendingCommentTarget } from './useDocComments'

export type BootDeps = {
  setBootPhase: Dispatch<SetStateAction<'booting' | 'ready'>>
  setDbBlockedMessage: Dispatch<SetStateAction<string | null>>
  setStore: Dispatch<SetStateAction<Store>>
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setFolders: Dispatch<SetStateAction<Folder[]>>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  setForbiddenDocIds: Dispatch<SetStateAction<Set<string>>>
  setSharedDoc: Dispatch<SetStateAction<ShareDoc | null>>
  setSharesOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setMapRoute: Dispatch<SetStateAction<{ centerDocId: string | null; returnDocId: string | null } | null>>
  setDeletedElsewhereId: Dispatch<SetStateAction<string | null>>
  showNotice: (input: NoticeWithAction) => number
  beforeLeaveDoc: () => Promise<void>
  applyAccountFlags: (next: AccountState) => void
  recheckAccount: () => Promise<void>
  addOpenFolders: (ids: string[] | null | undefined) => void
  openSharedFragment: (fragment: string, docsForFallback: DocMeta[]) => Promise<void>
  keepLiveTitle: (list: DocMeta[]) => DocMeta[]
  restartDocSessionAfterFlush: () => Promise<void>
  postTabMessage: (m: TabMessage) => void
  replaceHashUrl: (docId: string | null) => void
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
  e2eeStoreRef: RefObject<E2eeStore | null>
  e2eeRef: RefObject<{ keyring: { getMasterKey(): CryptoKey | null } } | null>
  tabIdRef: RefObject<string>
  createdHereRef: RefObject<Set<string>>
  currentDocIdRef: RefObject<string | null>
  focusEditorRef: RefObject<boolean>
  foldersRef: RefObject<Folder[]>
  commentsRef: RefObject<{ setPendingTarget: (target: PendingCommentTarget) => void } | null>
  bootListSeqRef: RefObject<number>
  lastAppliedListSeqRef: RefObject<number>
  deletedElsewhereSourceRef: RefObject<'tab' | 'bootMerge'>
  docPathRef: RefObject<{ docId: string | null; path: DocPathKind | null }>
  e2eeConvertBusyRef: RefObject<boolean>
}

export type BootRouteInput = {
  hash: HashRoute
  docs: { id: string }[]
  lastDocId: string | null
  startScreen: 'home' | 'last'
}

export type BootRoute =
  | { kind: 'share'; fragment: string }
  | { kind: 'shares' }
  | { kind: 'help' }
  | { kind: 'map'; anchorId: string | null }
  | { kind: 'doc'; docId: string; notFound: boolean; threadId: string | null }
  | { kind: 'home' }

// 부팅 첫 화면 판정 — 해시가 먼저, 문서 해시가 아니면 시작 화면 설정 (F-2074, F-111 2-1, F-232 3.1)
export function decideBootRoute({ hash: parsedHash, docs: metaList, lastDocId, startScreen }: BootRouteInput): BootRoute {
  if (parsedHash.type === 'share') return { kind: 'share', fragment: parsedHash.fragment }
  if (parsedHash.type === 'shares') return { kind: 'shares' }
  if (parsedHash.type === 'help') return { kind: 'help' }
  if (parsedHash.type === 'map') {
    const anchorId = parsedHash.docId && metaList.some((d) => d.id === parsedHash.docId) ? parsedHash.docId : null
    return { kind: 'map', anchorId }
  }

  const hashDocId = parsedHash.type === 'doc' ? parsedHash.docId : null
  const hashThreadId = parsedHash.type === 'doc' ? (parsedHash.threadId ?? null) : null
  // 해시가 특정 문서를 안 가리키면 시작 화면 설정을 따른다 — 기본(home)은 자동으로 안 연다 (F-232 3.1)
  const shouldAutoOpen = Boolean(hashDocId) || startScreen === 'last'
  if (!shouldAutoOpen) return { kind: 'home' }
  const resolved = resolveInitialDoc({ hashDocId, lastDocId, docs: metaList })
  if (!resolved.docId) return { kind: 'home' }
  const threadId = !resolved.notFound && hashThreadId && resolved.docId === hashDocId ? hashThreadId : null
  return { kind: 'doc', docId: resolved.docId, notFound: resolved.notFound, threadId }
}

export async function runBoot(deps: BootDeps): Promise<void> {
  const {
    setBootPhase, setDbBlockedMessage, setStore, setDocs, setFolders, setCurrentDocId, setForbiddenDocIds, setSharedDoc, setSharesOpen, setHelpOpen,
    setMapRoute, setDeletedElsewhereId, showNotice, beforeLeaveDoc, applyAccountFlags, recheckAccount, addOpenFolders, openSharedFragment, keepLiveTitle,
    restartDocSessionAfterFlush, postTabMessage, replaceHashUrl, yjsStoreRef, e2eeStoreRef, e2eeRef, tabIdRef, createdHereRef, currentDocIdRef, focusEditorRef,
    foldersRef, commentsRef, bootListSeqRef, lastAppliedListSeqRef, deletedElsewhereSourceRef, docPathRef, e2eeConvertBusyRef,
  } = deps
  // 공개 보기 화면(F-210.md 2.4, F-211.md 2.3) — 저장소를 열지 않는다. render 는 publicRoute 로 갈린다
  const bootHashType = parseHash(location.hash).type
  if (bootHashType === 'public' || bootHashType === 'publicFolder') {
    setBootPhase('ready')
    return
  }

  // 저장소는 부팅 때 한 번만 고른다 — 계정 상태를 먼저 읽고 그 결과로 고른다 (F-207.md 2.6)
  const accountState = await fetchAccount()
  applyAccountFlags(accountState)

  // resolvedStore 가 정해지기 전엔 handleServerConflict 를 못 만드므로 자리만 먼저 둔다
  let conflictHandler:
    | ((event: { docId: string; copyId: string; reason?: 'locked'; email?: string }) => void)
    | null = null

  const resolvedStore = await openStore({
    account: accountState,
    // 새 버전 창: 옛 버전 연결이 열기를 막았을 때 부팅 화면에 문구를 보이고 기다린다 (F-136.md 3.3)
    onBlocked: () => {
      setDbBlockedMessage(
        '다른 창에서 이 앱이 열려 있습니다. 그 창을 닫거나 새로 고치면 계속됩니다.',
      )
    },
    // 옛 버전 창: 이 창의 연결이 새 버전 열기를 막는다 — 저장 대기 내용을 먼저 저장 시도한다, 연결은 idbStore 가 닫는다 (F-110.md 3.4)
    onBlocking: () => beforeLeaveDoc(),
    // 정리가 끝나 연결이 닫힌 뒤의 저장 시도는 기존 저장 실패 처리를 따른다 (F-136.md 3.3)
    onClosed: () => {
      showNotice({
        type: 'error',
        message: '새 버전이 다른 창에서 열렸습니다. 이 창을 새로 고쳐 주세요.',
        action: { label: '새로고침', icon: IconRefresh, onClick: () => location.reload() },
      })
    },
    // 서버 저장소 413·동기화 오류 알림 (F-207.md 2.3)
    onNotice: showNotice,
    // 서버 저장소 409 충돌 — 사본 문서가 만들어졌다는 신호 (F-207.md 2.4)
    onConflict: (event) => conflictHandler?.(event),
    // 편집 권한이 사라져 403 을 받은 문서 — 이번 세션 동안 읽기 전용으로 내린다 (F-212.md 2.4)
    onForbidden: (docId) => {
      setForbiddenDocIds((prev) => (prev.has(docId) ? prev : new Set(prev).add(docId)))
    },
    // 쓰기가 403 account_blocked 를 받았다 — 곧바로 /api/me 를 다시 읽는다 (F-2030 4.4, 5.1 ③)
    onAccountBlocked: () => {
      recheckAccount()
    },
  })
  setDbBlockedMessage(null)
  // 서버 저장소면 md-yjs 를 페이지 수명 동안 한 번 연다 — 오프라인 부팅도 저장소가 아는 사용자 id 로 (F-306 9.2)
  if (resolvedStore.kind === 'server') yjsStoreRef.current = openYjsStore((resolvedStore as ServerStore).userId)
  // 금고 한 겹을 탭 신호 안쪽에 둔다 — 암호화 뒤의 쓰기에도 신호가 붙는다. MK 는 열쇠고리가 생긴 뒤 ref 로 읽는다 (F-405 7.1)
  const appStore: Store =
    resolvedStore.kind === 'memory'
      ? resolvedStore
      : (e2eeStoreRef.current = withE2ee(resolvedStore, { getMasterKey: () => e2eeRef.current?.keyring.getMasterKey() ?? null }))
  // 이 한 곳만 감싸면 App.tsx 의 모든 저장 경로가 자동으로 다른 탭에 신호를 보낸다 (F-296.md 6.2)
  const broadcastStore = withTabBroadcast(appStore, postTabMessage, tabIdRef.current)
  // 부팅에서 먼저 막힘을 알게 된 경우 — 첫 요청을 보내 403 을 받는 일 없이 처음부터 멈춰 있다 (F-2030 4.4 3번)
  if (resolvedStore.kind === 'server' && accountState.state === 'in' && accountState.blocked) {
    ;(resolvedStore as ServerStore).setAccountBlocked(true)
  }
  setStore({
    ...broadcastStore,
    // 이 탭에서 만든 문서를 적어 둔다 — 곧바로 여는 세션은 pending 으로 본다 (F-305 4.1 3번)
    create: async (input) => {
      const doc = await broadcastStore.create(input)
      createdHereRef.current.add(doc.id)
      return doc
    },
  })

  // 열린 문서가 충돌한 원본이면 서버 내용을 밀어 넣지 않고(불변조건) 사본으로 전환한다
  async function handleServerConflict({
    docId,
    copyId,
    reason,
    email,
  }: {
    docId: string
    copyId: string
    reason?: 'locked'
    email?: string
  }) {
    const [orig, copy] = await Promise.all([appStore.get(docId), appStore.get(copyId)])
    setDocs((prev) => {
      let next = prev
      if (orig) {
        next = next.map((d) => (d.id === docId ? { ...d, title: orig.title, updatedAt: orig.updatedAt } : d))
      }
      if (copy) {
        next = sortByUpdatedAtDesc([...next, stripContent(copy)])
      }
      return next
    })
    const copyTitle = copy?.title ?? ''
    // 423(F-213.md 2.4) 이면 문구가 다르다 — 그 외(409)는 기존 충돌 문구
    showNotice({
      type: 'warn',
      message:
        reason === 'locked'
          ? `${email ?? ''} 님이 편집 중이라 내 편집을 "${copyTitle}" 으로 저장했습니다.`
          : `다른 곳에서 먼저 바뀌어 내 편집을 "${copyTitle}" 으로 저장했습니다.`,
    })
    if (docId === currentDocIdRef.current) {
      leaveScreens({ setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute })
      focusEditorRef.current = false
      setCurrentDocId(copyId)
      setPref('md.lastDocId', copyId)
      replaceHashUrl(copyId)
      if (copy) addOpenFolders(ancestorsOfDoc({ folders: foldersRef.current, doc: stripContent(copy) }))
    }
  }
  conflictHandler = (event) => {
    handleServerConflict(event)
  }

  if (resolvedStore.kind === 'memory') {
    showNotice({
      type: 'error',
      message: '이 브라우저에서 저장소를 쓸 수 없습니다. 새로고침하면 문서가 사라집니다.',
    })
  }

  // 로컬 → 계정 이관 (F-208.md 2.1·2.2) — 첫 실행 안내 문서 판단은 이 뒤에 한다
  if (resolvedStore.kind === 'server' && accountState.state === 'in') {
    const serverStore = resolvedStore as ServerStore
    await migrateLocalIfNeeded({
      userId: accountState.id,
      getPref,
      setPref,
      readLocal: async () => {
        const local = await createIdbStore()
        const [folders, docs, comments] = await Promise.all([local.listFolders(), local.list(), local.listCommentRecords?.() ?? Promise.resolve(undefined)])
        return { folders, docs, comments }
      },
      importLocal: (input) => serverStore.importLocal(input),
      notice: showNotice,
      afterImport: async () => {
        const [freshDocs, freshFolders] = await Promise.all([appStore.list(), appStore.listFolders()])
        setDocs(sortByUpdatedAtDesc(freshDocs.map(stripContent)))
        setFolders(freshFolders)
      },
    })
  }

  const parsedHash = parseHash(location.hash)

  // 첫 화면을 고르고 ready 한다 — 캐시 먼저 길·기다리는 길이 함께 쓴다 (F-2042 4.2)
  async function finishBootRouting(metaList: DocMeta[], folderList: Folder[]) {
    const route = decideBootRoute({ hash: parsedHash, docs: metaList, lastDocId: getPref('md.lastDocId', '') || null, startScreen: getPref('md.startScreen', 'home') })
    // 공유 링크(#/s/{조각})는 저장소에서 문서를 찾지 않고 곧바로 S-4 를 보여준다 (specs/features/F-130.md 4장)
    if (route.kind === 'share') {
      await openSharedFragment(route.fragment, metaList)
      setBootPhase('ready')
      return
    }

    // 공유 관리 페이지(#/shares) — 문서를 열지 않는다 (F-243.md 3.4)
    if (route.kind === 'shares') {
      setSharesOpen(true)
      setBootPhase('ready')
      return
    }

    // 도움말 페이지(#/help) — 문서를 열지 않는다 (F-244.md 3.3)
    if (route.kind === 'help') {
      setHelpOpen(true)
      setBootPhase('ready')
      return
    }

    // 위키링크 지도(#/map·#/map/{id}) — currentDocId 는 비우지 않고 유지한다 (F-292.md 6.1, A15)
    if (route.kind === 'map') {
      const { anchorId } = route
      setCurrentDocId(anchorId)
      if (anchorId) setPref('md.lastDocId', anchorId)
      setMapRoute({ centerDocId: anchorId, returnDocId: anchorId })
      setBootPhase('ready')
      return
    }

    if (route.kind === 'doc') {
      setCurrentDocId(route.docId)
      setPref('md.lastDocId', route.docId)
      replaceHashUrl(route.docId)
      if (route.notFound) {
        showNotice({ type: 'info', message: '문서를 찾을 수 없습니다.' })
      } else if (route.threadId) {
        // 댓글 주소로 들어온 경우 — 댓글이 준비되면 그 카드로 이동한다(7.6)
        commentsRef.current?.setPendingTarget({ docId: route.docId, threadId: route.threadId })
      }
      const openedDoc = metaList.find((d) => d.id === route.docId)
      addOpenFolders(ancestorsOfDoc({ folders: folderList, doc: openedDoc }))
    } else {
      replaceHashUrl(null)
    }

    setBootPhase('ready')
  }

  // 안 쓰는 첨부 정리 예약 — 부팅이 이미 읽은 앱 층 목록을 한 번 다시 쓴다(따로 list() 하지 않음) (F-156.md 2.7, F-406, F-2056 3.5)
  function scheduleGc(bootDocs: Doc[]) {
    const gcList = async () => bootDocs
    const gcStore =
      resolvedStore.kind === 'server'
        ? {
            kind: 'idb',
            list: gcList,
            listAttachments: async () => (await resolvedStore.listAttachments()).filter((a) => a.uploaded !== false),
            removeAttachment: (id: string) => resolvedStore.removeAttachment(id),
          }
        : { ...resolvedStore, list: gcList }
    scheduleAttachmentGc(() => cleanupUnusedAttachments({ store: gcStore }))
  }

  // 뒤 맞추기 결과를 지금 목록에 합친다 — 스냅샷 뒤 생긴 문서는 남기고, 늦게 시작한 결과는 버린다 (F-2042 4.3)
  function applyBootMerge(seq: number, snapshotIds: ReadonlySet<string>, newFolders: Folder[], newDocs: Doc[]) {
    if (!shouldApplyListResult({ seq, lastAppliedSeq: lastAppliedListSeqRef.current })) return
    lastAppliedListSeqRef.current = seq
    setFolders(newFolders)
    const resultMetaList = keepLiveTitle(sortByUpdatedAtDesc(newDocs.map(stripContent)))
    // 업데이터는 병합만 — 부작용은 flushSync 로 병합을 끝낸 뒤 한 번 (applyResyncResult 와 같음, F-2059 D14)
    const applied: { merged?: { docs: DocMeta[]; removedIds: string[] } } = {}
    flushSync(() => {
      setDocs((prevDocs) => {
        applied.merged = mergeBootList({ snapshotIds, current: prevDocs, result: resultMetaList })
        return applied.merged.docs
      })
    })
    const merged = applied.merged
    if (!merged) return
    const openId = currentDocIdRef.current
    if (openId && merged.removedIds.includes(openId)) {
      deletedElsewhereSourceRef.current = 'bootMerge'
      setDeletedElsewhereId(openId)
    }
    // 다른 곳이 지금 문서를 금고로 옮기거나 뺐으면 새 세션으로 다시 연다 (F-407 7.4, resyncFromStore 와 같은 조건)
    const opened = openId ? merged.docs.find((d) => d.id === openId) : undefined
    const session = docPathRef.current
    const syncedPath = session.path === 'realtime' || session.path === 'pending' || session.path === 'fallback' || session.path === 'e2ee'
    if (resolvedStore.kind === 'server' && opened && session.docId === openId && syncedPath && !e2eeConvertBusyRef.current) {
      if (Boolean(opened.e2ee) !== (session.path === 'e2ee')) void restartDocSessionAfterFlush()
    }
  }

  let usedCachedShell = false
  if (resolvedStore.kind === 'server' && accountState.state === 'in') {
    try {
      const cachedList = await (appStore as ServerStore).listCached()
      const cachedDocIds = new Set(cachedList.docs.map((d) => d.id))
      if (
        canShowCachedShell({
          storeKind: resolvedStore.kind,
          accountState: accountState.state,
          hash: parsedHash,
          cachedDocIds,
        })
      ) {
        usedCachedShell = true
        const cachedFolders = cachedList.folders
        const cachedMetaList = sortByUpdatedAtDesc(cachedList.docs.map(stripContent))
        setFolders(cachedFolders)
        setDocs(cachedMetaList)

        const snapshotIds = new Set(cachedMetaList.map((d) => d.id))
        const seq = ++bootListSeqRef.current

        await finishBootRouting(cachedMetaList, cachedFolders)

        // 뒤 맞추기 — 서버 목록으로 캐시 목록을 맞춘다. 실패해도 새 알림은 없다(캐시를 그대로 둔다) (F-2042 4.2·4.7)
        Promise.all([appStore.listFolders(), appStore.list()])
          .then(([newFolders, newDocs]) => {
            applyBootMerge(seq, snapshotIds, newFolders, newDocs)
            // 첨부 정리는 뒤 맞추기 결과로 그 뒤에 예약한다 — 실패하면 이 페이지에서는 하지 않는다 (F-2056 3.5)
            scheduleGc(newDocs)
          })
          .catch((err) => {
            console.error('boot_resync_failed', err)
          })
      }
    } catch (err) {
      // listCached()가 던지면 캐시 먼저를 포기하고 지금 순서로 간다 (F-2042 4.7)
      console.error('boot_resync_failed', err)
    }
  }

  if (!usedCachedShell) {
    // 폴더를 문서와 함께 받아 먼저 반영한다 — 폴더가 늦으면 그 안의 문서가 잠깐 루트에 보인다
    const foldersPromise = appStore.listFolders()
    const list = await appStore.list()

    const folderList = await foldersPromise
    setFolders(folderList)

    const metaList = sortByUpdatedAtDesc(list.map(stripContent))
    setDocs(metaList)

    scheduleGc(list)

    await finishBootRouting(metaList, folderList)
  }
}

export type FlushRunnerDeps = {
  flushRunningRef: RefObject<boolean>
  yjsStoreRef: RefObject<Promise<YjsStore | null>>
  currentDocIdRef: RefObject<string | null>
}

export function startFlushRunner({ flushRunningRef, yjsStoreRef, currentDocIdRef }: FlushRunnerDeps): () => void {
  let cancelled = false
  const runFlush = (persist: YjsStore) => {
    if (flushRunningRef.current || cancelled) return
    flushRunningRef.current = true
    flushUnsyncedDocs({
      store: persist,
      isOpenDoc: (id) => id === currentDocIdRef.current,
      createController: (options) =>
        createLiveDocController({
          ...options,
          openSocket: openLiveSocket,
          host: location.host,
          secure: location.protocol === 'https:',
          setTimeout: (fn, ms) => window.setTimeout(fn, ms),
          clearTimeout: (handle) => window.clearTimeout(handle as number),
          random: Math.random,
        }),
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    })
      .catch(() => {})
      .finally(() => {
        flushRunningRef.current = false
      })
  }
  const cancelIdle = scheduleAttachmentGc(() => {
    void yjsStoreRef.current.then(async (persist) => {
      if (!persist || cancelled) return
      await persist.collectGarbage(Date.now()).catch(() => {})
      if (navigator.onLine) runFlush(persist)
    })
  })
  const handleOnline = () => {
    void yjsStoreRef.current.then((persist) => {
      if (persist) runFlush(persist)
    })
  }
  window.addEventListener('online', handleOnline)
  return () => {
    cancelled = true
    cancelIdle()
    window.removeEventListener('online', handleOnline)
  }
}
