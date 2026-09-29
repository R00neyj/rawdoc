// 문서 이동 — App.tsx 에서 옮김 (F-2082)
import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { ancestorsOfDoc, resolveTargetFolderId } from '../lib/folderTree'
import { fromEditorText } from '../lib/lineEnding'
import { getPref, setPref } from './prefs'
import { e2eeCreateErrorMessage } from './appNotices'
import { stripContent, sortByUpdatedAtDesc, type DocMeta, type OpenDoc } from './docMeta'
import { resolveInitialDoc } from './resolveInitialDoc'
import { formatMapHash } from './hashRoute'
import { leaveScreens, screenOpen } from './leaveScreens'
import { replaceHashUrl, pushHashUrl, pushHelpHash } from './useHashRouting'
import type { EditorHandle } from '../editor/Editor'
import type { ShareDoc } from '../lib/shareCodec'
import type { PaletteCreatePlan } from './paletteContract'
import { HELP_DOC_TITLE, HELP_DOC_CONTENT } from './helpDoc'
import type { NoticeWithAction } from './NoticeBar'
import type { UseNotificationsResult } from './useNotifications'
import type { WikiResolver } from '../lib/wikiResolve'
import type { Doc, Folder, LineEnding, Store } from '../types'

type MapRoute = { centerDocId: string | null; returnDocId: string | null }

export type UseDocNavigationOptions = {
  store: Store
  docs: DocMeta[]
  folders: Folder[]
  currentDocId: string | null
  currentDoc: DocMeta | null
  openDoc: OpenDoc | null
  sharedDoc: ShareDoc | null
  sharesOpen: boolean
  helpOpen: boolean
  mapRoute: MapRoute | null
  viewMode: 'live' | 'raw' | 'view'
  notifications: UseNotificationsResult
  wikiResolver: WikiResolver
  currentFolderId: string | null
  jumpToHeading: (heading: string) => void
  buildNewDocContent: (vars: { title: string; emptyTitle?: 'fallback' | 'keep-empty' }) => Promise<{ content: string; failed: boolean }>
  beforeLeaveDoc: () => Promise<void>
  showNotice: (input: NoticeWithAction, options?: { sticky?: boolean }) => number
  changeViewMode: (mode: string) => void
  closePalette: () => void
  closeSidebarIfNarrow: () => void
  addOpenFolders: (ids: string[] | null | undefined) => void
  newDocFolderId: () => string | null
  ensureE2eeOpenForFolder: (folderId: string | null) => Promise<boolean>
  requestE2eeOpen: () => Promise<boolean>
  setDocs: Dispatch<SetStateAction<DocMeta[]>>
  setCurrentDocId: Dispatch<SetStateAction<string | null>>
  setSharedDoc: Dispatch<SetStateAction<ShareDoc | null>>
  setSharesOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setMapRoute: Dispatch<SetStateAction<MapRoute | null>>
  setDeletedElsewhereId: Dispatch<SetStateAction<string | null>>
  setNotice: (notice: null) => void
  setSearchOpen: Dispatch<SetStateAction<boolean>>
  setPendingEditorSearch: Dispatch<SetStateAction<{ docId: string; term: string } | null>>
  editorRef: RefObject<EditorHandle | null>
  focusTitleRef: RefObject<boolean>
  focusEditorRef: RefObject<boolean>
  pendingHeadingRef: RefObject<{ docId: string; heading: string } | null>
  openDocIdRef: RefObject<string | null>
}

export type UseDocNavigationResult = {
  saveCurrentAsNewDoc: () => Promise<void>
  createNewDoc: (folderId?: string | null) => Promise<void>
  createDocFromPalette: (plan: PaletteCreatePlan) => Promise<void>
  selectDoc: (id: string) => Promise<void>
  goHome: () => Promise<void>
  openSharesTarget: (targetType: 'doc' | 'folder', targetId: string) => void
  openWikiLinkTarget: (target: string, heading?: string | null, source?: { docId: string; folderId: string | null }) => Promise<void>
  handleOpenWikiLink: (target: string, heading?: string | null) => void
  importSharedDoc: () => Promise<void>
  closeSharedDoc: () => void
  openDocFromSearch: (id: string, term: string | null) => Promise<void>
  openHelp: () => Promise<void>
  openMap: () => Promise<void>
  closeMap: () => void
  recenterMap: (id: string) => void
  copyHelpToDoc: () => Promise<void>
}

export function useDocNavigation(options: UseDocNavigationOptions): UseDocNavigationResult {
  const {
    store, docs, folders, currentDocId, currentDoc, openDoc, sharedDoc, sharesOpen, helpOpen, mapRoute, viewMode, notifications,
    wikiResolver, currentFolderId, jumpToHeading, buildNewDocContent, beforeLeaveDoc, showNotice, changeViewMode, closePalette,
    closeSidebarIfNarrow, addOpenFolders, newDocFolderId, ensureE2eeOpenForFolder, requestE2eeOpen, setDocs, setCurrentDocId,
    setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute, setDeletedElsewhereId, setNotice, setSearchOpen, setPendingEditorSearch,
    editorRef, focusTitleRef, focusEditorRef, pendingHeadingRef, openDocIdRef,
  } = options
  const leave = () => leaveScreens({ setSharedDoc, setSharesOpen, setHelpOpen, setMapRoute })
  // Editor 는 마운트 시점의 onOpenWikiLink 클로저만 계속 쓰므로 ref 로 우회해 최신 값을 보게 한다 (F-131 3·5장)
  const openWikiLinkRef = useRef<(target: string, heading: string | null) => Promise<void>>(async () => {})

  // `새 문서로 저장` — 다른 탭에서 지워짐(F-296.md 7.3)·실시간 멈춤(F-305 8장) 공용. 원래 폴더도 지워졌을 수 있어 최상위에 만든다
  async function saveCurrentAsNewDoc() {
    // 금고 문서면 새 문서도 금고 문서다. 편집기가 내려가 있으면(잠김) 아무것도 만들지 않는다 (F-405 7.6)
    const asE2ee = Boolean(currentDoc?.e2ee)
    if (asE2ee) {
      if (!editorRef.current || openDoc?.id !== currentDocId) return
      if (!(await requestE2eeOpen())) return
    }
    const text = editorRef.current?.getText(openDoc?.lineEnding ?? 'crlf') ?? ''
    let doc: Doc
    try {
      doc = await store.create({
        title: currentDoc?.title ?? '제목 없는 문서',
        content: text,
        lineEnding: openDoc?.lineEnding ?? 'crlf',
        folderId: null,
        ...(asE2ee ? { e2ee: true as const } : {}),
      })
    } catch (err) {
      const e2eeMessage = e2eeCreateErrorMessage(err)
      if (!e2eeMessage) throw err
      showNotice({ type: 'error', message: e2eeMessage })
      return
    }
    setDocs((prev) => sortByUpdatedAtDesc([...prev, stripContent(doc)]))
    setDeletedElsewhereId(null)
    // 지도·공유 보기는 currentDocId 를 유지하고 알림 액션은 다른 화면에서도 눌리므로 전부 닫는다 (F-2059 D1)
    leave()
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    setNotice(null)
  }

  // folderId 생략 시 현재 문서가 속한 폴더에 만든다(없으면 최상위) — 사이드바 폴더 메뉴의 새 문서는 폴더 id 를 명시로 넘긴다 (F-126.md 5.3)
  async function createNewDoc(folderId?: string | null) {
    const targetFolderId = folderId !== undefined ? folderId : newDocFolderId()
    if (!(await ensureE2eeOpenForFolder(targetFolderId))) return
    // 보기 모드에서 새 문서 를 누르면 제목 입력 포커스가 필요해 먼저 편집 모드로 바꾼다 (ia.md 3.3, F-123.md 3.3)
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    // 새 문서 버튼은 {{title}} 이 빈 글자다 — 사용자 결정, F-2037.md 4.4
    const { content, failed } = await buildNewDocContent({ title: '', emptyTitle: 'keep-empty' })
    let doc: Doc
    try {
      doc = await store.create({
        title: '제목 없는 문서',
        content,
        lineEnding: 'crlf',
        folderId: targetFolderId,
      })
    } catch (err) {
      // 저장소가 folderId 를 거부하면(F-136.md 3.1) 처리되지 않은 rejection 으로 두지 않고 기존 오류 알림 경로로 보여준다 (F-138 3.4)
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    // 목록에 없는 템플릿(3.4)과 달리, 설정은 맞는데 이번만 못 읽은 것은 알린다 (4.2-4)
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    focusTitleRef.current = true
    // 새 문서는 에디터가 아니라 제목 입력에 포커스한다 — 이전 전환 요청이 아직 소비되지 않았을 가능성에 대비해 명시적으로 내려둔다 (ia.md 3.3, F-103 3.4)
    focusEditorRef.current = false
    // 공유 보기(F-130 4장)·공유 관리·도움말(F-2054 6.4)·지도 빈 상태(F-292 6.5)를 떠난다 — 만든 뒤에만, 실패하면 화면과 주소가 어긋난다
    leave()
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
  }

  // 명령 팔레트 `'{제목}' 새 문서 만들기` 줄 — openWikiLinkTarget 만들기 갈래와 같은 순서, selectDoc 이 떠나는 네 화면을 같이 떠난다 (F-2053 6.2·6.3)
  async function createDocFromPalette(plan: PaletteCreatePlan) {
    closePalette()
    if (!(await ensureE2eeOpenForFolder(plan.folderId))) return
    if (viewMode === 'view') changeViewMode('live')
    await beforeLeaveDoc()
    const { content, failed } = await buildNewDocContent({ title: plan.title })
    let doc: Doc
    try {
      doc = await store.create({ title: plan.title, content, lineEnding: 'crlf', folderId: plan.folderId })
    } catch (err) {
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    // 포커스는 본문 에디터다(제목 입력이 아니다) — 사용자가 방금 제목을 쳤다 (F-2053 6.3 Q8)
    focusTitleRef.current = false
    focusEditorRef.current = true
    // 화면 떠나기는 만든 뒤에만 — 실패하면 지금 화면과 주소가 그대로 남는다
    leave()
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
    // Dialog(팔레트)가 닫는 요소로 포커스를 돌리는 비동기 처리를 이겨야 한다 — openDocFromSearch 와 같은 방식
    // 새 편집기가 아직 안 떴으면 editorRef 는 이전 문서 편집기라 포커스를 주면 안 된다 — 마운트 시 autoFocus 로 스스로 포커스한다 (리뷰 P3)
    setTimeout(() => {
      if (openDocIdRef.current === doc.id) editorRef.current?.focus()
    }, 0)
  }

  async function selectDoc(id: string) {
    // sharedDoc·공유 관리 페이지·도움말 페이지·지도가 있으면 currentDocId 가 우연히 같아도 화면을 떠나야 한다 (ia.md 3.19, F-243.md 3.4, F-244.md 3.3, F-292.md 6.4 "노드 클릭 → 문서 열고 지도 닫기")
    if (id === currentDocId && !screenOpen({ sharedDoc, sharesOpen, helpOpen, mapRoute })) {
      notifications.markDocRead(id) // 이미 보이는 문서를 다시 고르면 전환이 아니라도 읽음 처리 (F-510 4.2 2번)
      return
    }
    await beforeLeaveDoc()
    leave()
    focusEditorRef.current = true
    setCurrentDocId(id)
    setPref('md.lastDocId', id)
    pushHashUrl(id)
    addOpenFolders(ancestorsOfDoc({ folders, doc: docs.find((d) => d.id === id) }))
    closeSidebarIfNarrow()
  }

  // ----- 로고 클릭 → 홈 (F-232 3.3, F-244 3.3) — 이미 홈이거나 도움말 페이지의 `닫기` 도 이 함수를 그대로 쓴다 -----
  async function goHome() {
    if (currentDocId === null && !screenOpen({ sharedDoc, sharesOpen, helpOpen, mapRoute })) return
    await beforeLeaveDoc()
    leave()
    setCurrentDocId(null)
    replaceHashUrl(null)
  }

  // 대상 이름 클릭 — 문서면 열고, 폴더면 홈으로 가며 사이드바에서 펼친다 (F-243.md 3.4)
  function openSharesTarget(targetType: 'doc' | 'folder', targetId: string) {
    if (targetType === 'doc') {
      selectDoc(targetId)
      return
    }
    addOpenFolders([targetId])
    goHome()
  }

  // 위키링크 열기 — 있는 문서면 selectDoc 흐름, 없으면 현재 폴더에 새 문서. '' 나 지금 문서는 제목 이동 (F-131 5장, F-126 5.3, F-2018 8.3)
  // source(미리보기 창 링크)를 주면 해석 기준이 source.folderId/source.docId 가 된다 (F-2044 5.3)
  async function openWikiLinkTarget(
    target: string,
    heading: string | null = null,
    source?: { docId: string; folderId: string | null },
  ) {
    if (target === '') {
      if (source) {
        const onDocScreen = !screenOpen({ sharedDoc, sharesOpen, helpOpen, mapRoute })
        if (source.docId === currentDocId && onDocScreen) {
          if (heading) jumpToHeading(heading)
          return
        }
        pendingHeadingRef.current = heading ? { docId: source.docId, heading } : null
        await selectDoc(source.docId)
        return
      }
      if (heading) jumpToHeading(heading)
      return
    }
    const folderId = source ? source.folderId : currentFolderId
    const match = wikiResolver.resolve(target, folderId)
    const onDocScreen = !screenOpen({ sharedDoc, sharesOpen, helpOpen, mapRoute })
    if (match && match.id === currentDocId && onDocScreen) {
      if (heading) jumpToHeading(heading)
      return
    }
    if (match) {
      pendingHeadingRef.current = heading ? { docId: match.id, heading } : null
      await selectDoc(match.id)
      return
    }

    const place = wikiResolver.findLinkFolder(target, folderId)
    const wikiFolderId = place ? place.folderId : source ? resolveTargetFolderId({ folders, folderId: source.folderId }) : newDocFolderId()
    if (!(await ensureE2eeOpenForFolder(wikiFolderId))) return

    if (viewMode === 'view') changeViewMode('live') // 제목 입력 포커스가 필요하다 (ia.md 3.3)
    await beforeLeaveDoc()
    const newTitle = place ? place.title : target
    // 위키링크는 {{title}} = 만드는 문서 제목 그대로 (F-2037.md 4.1)
    const { content, failed } = await buildNewDocContent({ title: newTitle })
    let doc: Doc
    try {
      doc = await store.create({
        title: newTitle,
        content,
        lineEnding: 'crlf',
        folderId: wikiFolderId,
      })
    } catch (err) {
      // F-138 3.4 — 3.4 참고 주석과 같은 이유·같은 알림 경로
      showNotice({ type: 'error', message: e2eeCreateErrorMessage(err) ?? '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    if (failed) showNotice({ type: 'error', message: '새 문서 템플릿을 읽지 못해 빈 문서로 만들었습니다.' })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    addOpenFolders(ancestorsOfDoc({ folders, doc: meta }))
    focusTitleRef.current = true
    focusEditorRef.current = false
    // 지도의 끊긴 링크 노드도 이 흐름을 탄다(F-292 6.4) — 만든 뒤에만 떠나야 실패 때 화면과 주소가 맞는다
    leave()
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    closeSidebarIfNarrow()
  }

  useEffect(() => {
    openWikiLinkRef.current = openWikiLinkTarget
  })

  const handleOpenWikiLink = useCallback((target: string, heading?: string | null) => {
    openWikiLinkRef.current(target, heading ?? null)
  }, [])

  // S-4 `내 문서로 가져오기`: 새 문서로 만들고 편집 모드로 연다 — 해시는 교체한다(히스토리에 남기지 않는다, F-130.md 4장)
  async function importSharedDoc() {
    if (!sharedDoc) return
    const doc = await store.create({
      title: sharedDoc.title,
      content: sharedDoc.content,
      lineEnding: sharedDoc.lineEnding,
      folderId: null,
    })
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    setSharedDoc(null)
    if (viewMode !== 'live') changeViewMode('live')
    focusEditorRef.current = true
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    replaceHashUrl(doc.id)
    showNotice({ type: 'info', message: '내 문서로 가져왔습니다.' })
  }

  // S-4 `닫기`: 마지막으로 연 문서 또는 빈 상태로 (F-130.md 4장)
  function closeSharedDoc() {
    setSharedDoc(null)
    const lastDocId = getPref('md.lastDocId', '') || null
    const resolved = resolveInitialDoc({ hashDocId: null, lastDocId, docs })
    setCurrentDocId(resolved.docId)
    replaceHashUrl(resolved.docId)
  }

  // 검색 결과에서 문서 열기 (F-287.md 4.6) — 지금 문서를 그대로 두지 않고 그 문서로 이동한다
  // term 이 있으면 그 문서의 찾기 패널에 검색어를 넣는다 (specs/features/F-294.md 4.3)
  async function openDocFromSearch(id: string, term: string | null) {
    setSearchOpen(false)
    // 문서 전환 전에 예약해야 한다 — 뒤에 두면 beforeLeaveDoc() 왕복 사이에 openDoc 이 먼저 도착해 effect 가 헛돈다
    setPendingEditorSearch(term && viewMode !== 'view' ? { docId: id, term } : null)
    await selectDoc(id)
    // 편집·원문 모드면 에디터에 포커스를 준다 — Dialog 기본 복귀만으로는 사라진 요소를 가리키거나 사이드바로 돌아간다 (4.6)
    if (viewMode !== 'view') {
      setTimeout(() => editorRef.current?.focus(), 0)
    }
  }

  // 사이드바 `도움말` → 전용 페이지로 이동 (F-244.md 3.3, 3.5)
  async function openHelp() {
    await beforeLeaveDoc()
    leave()
    setCurrentDocId(null)
    setHelpOpen(true)
    pushHelpHash()
    closeSidebarIfNarrow()
  }

  // ----- 위키링크 지도 S-8 — currentDocId 는 비우지 않는다(F-138 3.2 와 같은 방식, F-292.md 6.1) -----
  async function openMap() {
    await beforeLeaveDoc()
    leave()
    const anchorId = currentDocId
    setMapRoute({ centerDocId: anchorId, returnDocId: anchorId })
    history.pushState(null, '', `${location.pathname}${location.search}${formatMapHash(anchorId ?? undefined)}`)
    closeSidebarIfNarrow()
  }

  // 닫기 — 지도를 열 때의 문서로 돌아간다(replace). 열 때 문서가 없었으면 홈으로(6.1)
  function closeMap() {
    const returnId = mapRoute?.returnDocId ?? null
    setMapRoute(null)
    replaceHashUrl(returnId)
  }

  // Ctrl(⌘)+클릭 — 그 노드를 중심으로 다시 그린다. 지도는 닫지 않는다(6.4)
  function recenterMap(id: string) {
    setMapRoute((prev) => (prev ? { ...prev, centerDocId: id } : prev))
    history.replaceState(null, '', `${location.pathname}${location.search}${formatMapHash(id)}`)
  }

  // 도움말 페이지 `내 문서로 복사` (F-244.md 3.4) — 중복 검사 없이 그냥 하나 더 만든다
  async function copyHelpToDoc() {
    const lineEnding: LineEnding = 'crlf'
    let doc: Doc
    try {
      doc = await store.create({
        title: HELP_DOC_TITLE,
        content: fromEditorText(HELP_DOC_CONTENT, lineEnding),
        lineEnding,
      })
    } catch {
      showNotice({ type: 'error', message: '새 문서를 만들지 못했습니다. 다시 시도하세요.' })
      return
    }
    const meta = stripContent(doc)
    setDocs((prev) => sortByUpdatedAtDesc([...prev, meta]))
    setHelpOpen(false)
    focusEditorRef.current = true
    setCurrentDocId(doc.id)
    setPref('md.lastDocId', doc.id)
    pushHashUrl(doc.id)
    showNotice({ type: 'info', message: '도움말을 문서로 복사했습니다.' })
  }

  return {
    saveCurrentAsNewDoc, createNewDoc, createDocFromPalette, selectDoc, goHome, openSharesTarget, openWikiLinkTarget,
    handleOpenWikiLink, importSharedDoc, closeSharedDoc, openDocFromSearch, openHelp, openMap, closeMap, recenterMap, copyHelpToDoc,
  }
}
