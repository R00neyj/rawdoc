// 편집기 연동 — 본문 1회 읽기·위키 문맥·보기 HTML·layout effect, App.tsx 에서 옮김 (F-2072, F-2059)
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { showSearchMatches } from '../editor/showSearchMatches'
import { createWikiResolver, type WikiResolver } from '../lib/wikiResolve'
import { floatCoverFor } from '../lib/floatCover'
import { countChars, countWords } from '../editor/stats'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { findHeadingLine } from '../viewer/headingTarget'
import { findViewerHeadingElByLine, topInScroller } from './outlinePosition'
import { scrollViewerToAnchor } from './viewerScroll'
import type { ServerStore } from '../storage/serverStore'
import type { EditorHandle } from '../editor/Editor'
import type { WikiContext } from '../editor/preview/wikiLinks'
import type { E2eeStatus } from '../e2ee/keyring'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import type { Folder, Store } from '../types'
import type { ResolveAttachment } from '../viewer/fillMarkdownAssets'
import type { DocMeta, OpenDoc } from './docMeta'
import type { DocPathKind } from './docPath'
import type { LiveSnapshot } from './liveDoc'
import type { NoticeWithAction } from './NoticeBar'
import { useGithubImages, type GithubImagesHandle } from './useGithubImages'

const HEADING_JUMP_MARGIN = 16 // 목차 SELECT_MARGIN 과 같다 (F-2018 7.3)

// 다른 문서를 연 뒤 한 번 이동할 곳 — [[문서#제목]] 의 제목, 또는 할 일 항목의 줄 (small 2026-10-11)
export type PendingJump = { docId: string; heading: string } | { docId: string; line: number }

export type UseEditorSyncOptions = {
  store: Store
  docs: DocMeta[]
  folders: Folder[]
  currentDocId: string | null
  currentDoc: DocMeta | null
  openDoc: OpenDoc | null
  bootPhase: 'booting' | 'ready'
  viewMode: 'live' | 'raw' | 'view'
  isRealtime: boolean
  liveSnapshot: LiveSnapshot | undefined
  docPath: DocPathKind | null
  everLiveIds: ReadonlySet<string>
  docSession: { forbiddenClose: boolean }
  e2ee: { status: E2eeStatus } | null
  wikiPreviewPref: string
  lineNumbersPref: 'on' | 'off'
  resolvedTheme: 'white' | 'sepia' | 'dark'
  indentPref: '2' | '4'
  isReadOnlyDoc: boolean
  titleReadOnly: boolean
  currentBreadcrumb: { id: string; name: string }[]
  onNavigateFolder: (folderId: string) => void
  viewerHtml: string
  viewerDocId: string | null
  pendingEditorSearch: { docId: string; term: string } | null
  showNotice: (input: NoticeWithAction) => number
  setOpenDoc: Dispatch<SetStateAction<OpenDoc | null>>
  setStats: (stats: { line: number; col: number; charCount: number; wordCount: number }) => void
  setViewerHtml: Dispatch<SetStateAction<string>>
  setViewerDocId: Dispatch<SetStateAction<string | null>>
  setPendingEditorSearch: Dispatch<SetStateAction<{ docId: string; term: string } | null>>
  editorRef: RefObject<EditorHandle | null>
  viewerRef: RefObject<HTMLDivElement | null>
  scrollAnchorRef: RefObject<{ docId: string; anchor: ScrollAnchor } | null>
  pendingJumpRef: RefObject<PendingJump | null>
  openDocIdRef: RefObject<string | null>
}

export type UseEditorSyncResult = {
  wikiResolver: WikiResolver
  currentFolderId: string | null
  wikiContext: WikiContext
  resolveWikiHref: (target: string) => string | null
  jumpToHeading: (heading: string) => void
  jumpToLine: (line: number) => void
  attachmentResolverFor: (forE2eeDoc: boolean) => ResolveAttachment
  resolveAttachment: ResolveAttachment
  githubImages: GithubImagesHandle
}

export function useEditorSync(options: UseEditorSyncOptions): UseEditorSyncResult {
  const {
    store, docs, folders, currentDocId, currentDoc, openDoc, bootPhase, viewMode, isRealtime, liveSnapshot, docPath, everLiveIds, docSession,
    e2ee, wikiPreviewPref, lineNumbersPref, resolvedTheme, indentPref, isReadOnlyDoc, titleReadOnly, currentBreadcrumb, onNavigateFolder,
    viewerHtml, viewerDocId, pendingEditorSearch, showNotice, setOpenDoc, setStats, setViewerHtml, setViewerDocId, setPendingEditorSearch,
    editorRef, viewerRef, scrollAnchorRef, pendingJumpRef, openDocIdRef,
  } = options
  // ----- 문서를 열 때 저장소 본문을 1회 읽어 에디터에 넘긴다 (architecture.md 3장) -----
  // openDoc.id 와 currentDocId 가 다르면 렌더링에서 에디터를 안 그리는 것으로 처리해 여기서 null 로 되돌리지 않는다 (동기 setState 회피)
  const notFoundBeforeSync = isRealtime && liveSnapshot?.stopReason === 'not-found' && !liveSnapshot.ready
  // 실시간은 첫 synced 에서 채우고 첫 동기화 전 4404 만 캐시를 읽는다. 실시간이었던 폴백·4403 보기는 서버 본문 먼저 (F-305 5.2·8장)
  const openLoad =
    !currentDocId || docPath === null || (isRealtime && !notFoundBeforeSync)
      ? null
      : (docPath === 'fallback' && everLiveIds.has(currentDocId)) || (docPath === 'view' && docSession.forbiddenClose)
        ? 'server-first'
        : 'store'
  // 금고 문서는 금고가 열리고 잠길 때 본문 읽기를 다시 돈다 (F-405 7.4)
  const e2eeStatus = e2ee?.status ?? null
  const openLoadE2eeKey = currentDoc?.e2ee ? e2eeStatus : null
  useEffect(() => {
    if (bootPhase !== 'ready' || !currentDocId || openLoad === null) return
    let cancelled = false
    const serverStore = store as Partial<ServerStore>
    const load =
      openLoad === 'server-first' && typeof serverStore.refreshDocFromServer === 'function'
        ? serverStore.refreshDocFromServer(currentDocId).then((fresh) => fresh ?? store.get(currentDocId))
        : store.get(currentDocId)
    load.then((doc) => {
      if (cancelled || !doc) return
      // 잠긴 금고 문서는 빈 본문으로 편집기를 올리지 않는다 — P1 이 그 자리에 뜬다. 이미 열린 금고 편집기는 다시 만들지 않는다
      if (doc.e2ee === 'locked' || (doc.e2ee && openDocIdRef.current === doc.id)) return
      setOpenDoc({ id: doc.id, content: doc.content, lineEnding: doc.lineEnding })
      setStats({
        line: 1,
        col: 1,
        charCount: countChars(doc.content),
        wordCount: countWords(doc.content),
      })
    })
    return () => {
      cancelled = true
    }
  }, [store, bootPhase, currentDocId, openLoad, openLoadE2eeKey, openDocIdRef, setOpenDoc, setStats])

  // 위키링크 해석기 (specs/features/F-2018.md 8.1). docs·folders 가 바뀔 때만 새로 만든다 — 입력마다 만들지 않는다 (5.2)
  const wikiResolver = useMemo(
    () =>
      createWikiResolver(
        docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId ?? null, ...(d.e2ee !== undefined ? { e2ee: true as const } : {}) })),
        folders,
      ),
    [docs, folders],
  )
  const currentFolderId = currentDoc?.folderId ?? null

  // 편집기 문맥 — 해석기나 원본 폴더가 바뀔 때만 새 객체 (5.2). sourceE2ee — 편집 중인 문서가 금고 문서인가, [[ 자동완성만 거른다 (F-409 4.1)
  // hoverPreview — 위키링크 미리보기가 켜져 있으면 있는 문서 링크의 title 을 뺀다(F-2044 4.5)
  const wikiContext = useMemo(
    () => ({
      resolver: wikiResolver,
      sourceFolderId: currentFolderId,
      sourceE2ee: currentDoc?.e2ee !== undefined,
      hoverPreview: wikiPreviewPref === 'on',
    }),
    [wikiResolver, currentFolderId, currentDoc?.e2ee, wikiPreviewPref],
  )

  // 위키링크 href 판정 — 보기 모드·인쇄가 함께 쓴다(F-279.md 4.3). 이 화면은 항상 #/d/{id}, '' 는 지금 문서 (F-252.md 4.1, F-2018 8.2)
  const resolveWikiHref = useCallback(
    (target: string) => {
      if (target === '') return currentDocId ? `#/d/${currentDocId}` : null
      const match = wikiResolver.resolve(target, currentFolderId)
      return match ? `#/d/${match.id}` : null
    },
    [wikiResolver, currentFolderId, currentDocId],
  )

  // 지금 문서 안 제목으로 이동 — 찾음은 원문으로, 못 찾으면 문서 처음 + 알림 (F-2018 7.3·7.4)
  const jumpToHeading = useCallback(
    (heading: string) => {
      const handle = editorRef.current
      if (!handle) return
      const line = findHeadingLine(handle.getText('lf'), heading)
      if (viewMode === 'view') {
        const container = viewerRef.current
        if (!container) return
        if (line === null) {
          container.scrollTo({ top: 0 })
        } else {
          const place = () => {
            const el = findViewerHeadingElByLine(container, line)
            if (el) container.scrollTo({ top: Math.max(0, topInScroller(el, container) - HEADING_JUMP_MARGIN - floatCoverFor(container)) })
          }
          place()
          // 그려진 뒤(rAF 2회) 실측 보정 — 모드 전환 복원과 같은 이유
          requestAnimationFrame(() => requestAnimationFrame(place))
        }
      } else {
        const view = handle.view
        const pos = line === null ? 0 : view.state.doc.line(line).from
        view.dispatch({ selection: { anchor: pos } })
        handle.focus()
        if (line === null) view.scrollDOM.scrollTo({ top: 0 })
        else handle.scrollToHeading(pos)
      }
      if (line === null) showNotice({ type: 'info', message: `"${heading}" 제목을 찾지 못해 문서 처음을 엽니다.` })
    },
    [viewMode, showNotice, editorRef, viewerRef],
  )

  // 지금 문서의 원문 줄로 이동 — 편집·원문은 줄 끝에 커서, 보기는 모드 전환 복원과 같은 줄 기준 스크롤 (small 2026-10-11)
  const jumpToLine = useCallback(
    (line: number) => {
      const handle = editorRef.current
      if (!handle) return
      if (viewMode === 'view') {
        const container = viewerRef.current
        if (!container) return
        scrollViewerToAnchor(container, line)
        requestAnimationFrame(() => requestAnimationFrame(() => scrollViewerToAnchor(container, line)))
        return
      }
      const view = handle.view
      const pos = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines))).to
      view.dispatch({ selection: { anchor: pos } })
      handle.focus()
      handle.scrollToHeading(pos)
    },
    [viewMode, editorRef, viewerRef],
  )

  // 연결 문서의 저장소 그림 대응표 (F-2131 4장)
  const githubImages = useGithubImages({ store, currentDoc })
  const { resolveImagePath } = githubImages

  // ----- 보기 모드 변환 (specs/features/F-123.md 3.3) -----
  // 입력은 editorRef.current.getText('lf') 하나뿐(본문 사본 없음), docs 가 바뀌면 다시 계산해 위키링크 있음/없음을 최신으로 (F-131 4장)
  useEffect(() => {
    if (viewMode !== 'view') return
    if (!editorRef.current || openDoc?.id !== currentDocId) return
    setViewerHtml(
      renderMarkdown(editorRef.current.getText('lf'), { resolveWikiLink: resolveWikiHref, sourceLines: true, resolveImagePath: resolveImagePath ?? undefined }),
    )
    setViewerDocId(currentDocId)
  }, [viewMode, openDoc, currentDocId, resolveWikiHref, resolveImagePath, editorRef, setViewerHtml, setViewerDocId])

  // 검색 결과로 연 문서에 검색어 넘기기 — 새 EditorView 가 만들어진 뒤(자식 layout effect 뒤)에 적용한다 (specs/features/F-294.md 4.3)
  useEffect(() => {
    if (!pendingEditorSearch) return
    if (currentDocId !== pendingEditorSearch.docId) return // 아직 그 문서가 아니다
    if (openDoc?.id !== currentDocId) return // 본문이 아직 안 왔다 → 에디터가 없다
    const view = editorRef.current?.view
    if (!view) return
    showSearchMatches(view, pendingEditorSearch.term)
    setPendingEditorSearch(null) // 한 번만 쓴다
  }, [pendingEditorSearch, openDoc, currentDocId, editorRef, setPendingEditorSearch])

  // [[문서#제목]]·할 일 항목으로 연 문서 — 에디터가 만들어지고(보기 모드면 그 문서 HTML 이 그려진) 뒤 한 번 이동한다 (F-2018 8.3, F-294 4.3 과 같은 방식)
  useEffect(() => {
    const pending = pendingJumpRef.current
    if (!pending || currentDocId !== pending.docId) return
    if (openDoc?.id !== currentDocId || !editorRef.current) return
    if (viewMode === 'view' && viewerDocId !== currentDocId) return
    pendingJumpRef.current = null // 한 번만 쓴다
    if ('line' in pending) jumpToLine(pending.line)
    else jumpToHeading(pending.heading)
  }, [openDoc, currentDocId, viewMode, viewerDocId, jumpToHeading, jumpToLine, pendingJumpRef, editorRef])

  // 편집기 위키링크 해석 문맥 갱신 — 문서 전환 중(옛 에디터가 붙은 순간)은 건드리지 않는다 (F-2018 5.2)
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setWikiContext(wikiContext)
  }, [wikiContext, openDoc, currentDocId, editorRef])

  // 편집기는 리졸버를 마운트 때만 받는다 — 대응표가 늦게 오거나 바뀌면 민다 (F-2131 3.1)
  useEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setImagePaths(resolveImagePath)
  }, [resolveImagePath, openDoc, currentDocId, editorRef])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면 저장된 줄 번호 값을 그리기 전에 맞춘다 (F-147 2장)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setLineNumbers(lineNumbersPref === 'on')
  }, [openDoc, currentDocId, lineNumbersPref, editorRef])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면(항상 기본 테마로 만들어진다) 페인트 전에 테마를 맞춘다 — setLineNumbers 와 같은 패턴(F-260 2.3·2.4)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setTheme(resolvedTheme)
  }, [openDoc, currentDocId, resolvedTheme, editorRef])

  // 문서 전환·최초 마운트로 에디터가 새로 생기면 들여쓰기 값을 맞춘다 (F-154 2.3, 모르는 값은 4칸)
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setIndent(indentPref === '2' ? 2 : 4)
  }, [openDoc, currentDocId, indentPref, editorRef])

  // view 권한·403 강등 문서는 읽기 전용으로 (F-212.md 2.4) — 재마운트 없이 전환
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setReadOnly(isReadOnlyDoc)
  }, [openDoc, currentDocId, isReadOnlyDoc, editorRef])

  // 본문 맨 위 제목 값·읽기 전용 갱신 (F-217.md 2.2·2.4) — 위젯은 포커스가 없을 때만 값을 바꾼다
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setTitle(currentDoc?.title ?? '')
  }, [openDoc, currentDocId, currentDoc?.title, editorRef])

  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setTitleReadOnly(titleReadOnly)
  }, [openDoc, currentDocId, titleReadOnly, editorRef])

  // 제목 위의 폴더 경로 갱신 (F-234.md 3.3) — 문서를 다른 폴더로 옮기면 반영된다
  useLayoutEffect(() => {
    if (openDoc?.id !== currentDocId) return
    editorRef.current?.setBreadcrumb(currentBreadcrumb, onNavigateFolder)
  }, [openDoc, currentDocId, currentBreadcrumb, onNavigateFolder, editorRef])

  // 모드 전환 스크롤 위치 복원 (F-295.md 5.2) — useLayoutEffect 라 같은 커밋에서 hidden 이 이미 떨어져 튐이 안 보이고, 줄 번호·테마·들여쓰기 재구성 뒤에 돈다
  useLayoutEffect(() => {
    const saved = scrollAnchorRef.current
    if (!saved || saved.docId !== currentDocId) return
    scrollAnchorRef.current = null

    if (viewMode === 'view') {
      const el = viewerRef.current
      scrollViewerToAnchor(el, saved.anchor)
      // 그려진 뒤(rAF 2회) 실측 보정 — 편집기의 scrollToAnchor(createEditor.ts 8.2)와 같은 이유
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollViewerToAnchor(el, saved.anchor)
        })
      })
    } else {
      editorRef.current?.scrollToAnchor(saved.anchor)
    }
  }, [viewMode, viewerHtml, currentDocId, scrollAnchorRef, viewerRef, editorRef])

  // view 권한 문서를 열면 알림 띠를 보인다 (F-212.md 2.4) — 문서를 열 때 1회
  const notifiedViewDocRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentDoc || currentDoc.role !== 'view') return
    if (notifiedViewDocRef.current === currentDoc.id) return
    notifiedViewDocRef.current = currentDoc.id
    showNotice({ type: 'info', message: '보기 권한만 있는 문서입니다.' })
  }, [currentDoc, showNotice])

  // 첨부 해석(F-157.md 2.2, F-406.md 3.1) — 문서의 금고 여부를 받는 모양으로 빼서 resolveAttachment·위키링크 미리보기(F-2044 5.5)가 함께 쓴다
  // 저장소 그림 대응 첨부는 본문에 글자가 없어 힌트를 부를 때마다 ref 로 읽는다 — 편집기가 콜백을 마운트 때만 받는다 (F-2131 4.3)
  const hintRef = useRef(githubImages.attachmentHint)
  useEffect(() => {
    hintRef.current = githubImages.attachmentHint
  }, [githubImages.attachmentHint])
  const attachmentResolverFor = useCallback(
    (forE2eeDoc: boolean) => async (id: string) => {
      const record = await store.getAttachment(id, hintRef.current(id) ?? undefined)
      if (!record) return null
      if (record.e2ee && !forE2eeDoc) return null
      return { blob: record.blob, width: record.width, height: record.height, ...(record.e2ee ? { e2ee: record.e2ee } : {}) }
    },
    [store],
  )

  // 편집 모드 이미지 블록 위젯·보기 화면·인쇄가 첨부를 읽는 콜백 — 지금 문서 기준
  const resolveAttachment = useMemo(
    () => attachmentResolverFor(Boolean(currentDoc?.e2ee)),
    [attachmentResolverFor, currentDoc?.e2ee],
  )

  return { wikiResolver, currentFolderId, wikiContext, resolveWikiHref, jumpToHeading, jumpToLine, attachmentResolverFor, resolveAttachment, githubImages }
}
