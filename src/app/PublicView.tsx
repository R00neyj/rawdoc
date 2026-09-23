// 공개 보기 화면 S-5 (specs/features/F-210.md 2.4, F-209.md 2.6, F-211.md 2.3) — 저장소를 열지 않는다, 사이드바·상단바·상태바 없음
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'

import Viewer from '../viewer/Viewer'
import type { ResolveAttachment } from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { extractHeadings, type Heading } from '../editor/outline'
import { frontmatterExtension } from '../editor/frontmatter'
import { resolveWikiTarget } from '../lib/wikiLink'
import { createWikiResolver, type WikiFolderRef } from '../lib/wikiResolve'
import { findHeadingLine } from '../viewer/headingTarget'
import Outline from './Outline'
import NoticeBar from './NoticeBar'
import type { Notice } from './notice'
import { findViewerHeadingElByLine, topInScroller } from './outlinePosition'
import { IconDownload, IconSettings, IconPanelOpen, IconPanelClose, IconRefresh, IconTooltip } from './icons'
import { buildExportPayload } from './exportDoc'
import { getPref, setPref } from './prefs'
import { resolveTheme } from './theme'
import SettingsDialog from './SettingsDialog'
import {
  fetchPublicDoc,
  fetchPublicFolder,
  fetchPublicFolderDoc,
  fetchPublicSet,
  fetchPublicSetDoc,
  firstFolderDocId,
  PublicDocError,
  sortDocsByUpdatedAtDesc,
  type PublicDoc,
  type PublicFolder,
  type PublicSetDoc,
} from './publicDoc'
import { formatPublicFolderHash, formatPublicHash, parseHash } from './hashRoute'
import PublicFolderList from './PublicFolderList'
import PublicBrand from './PublicBrand'

const NARROW_QUERY = '(max-width: 1023px)'
const HEADING_JUMP_MARGIN = 16 // 목차 SELECT_MARGIN 과 같다 (F-2018 7.3)
const NOTICE_MS = 4000 // 앱 showNotice 의 info 와 같은 시간 (F-2018 11.3)

// 문서가 그려진 뒤 이동할 제목 — seq 로 같은 제목을 다시 눌러도 새 요청이 된다 (F-2018 11.3)
type HeadingRequest = { docId: string; heading: string; seq: number }

// 공개 화면 알림 띠 — 앱이 publicRoute 에서 일찍 돌아가 앱 알림 띠가 없다 (F-2018 11.3)
function usePublicNotice() {
  const [notice, setNotice] = useState<(Notice & { id: number }) | null>(null)
  const idRef = useRef(0)
  const show = useCallback((message: string) => {
    const id = ++idRef.current
    setNotice({ id, type: 'info', message })
    setTimeout(() => setNotice((cur) => (cur && cur.id === id ? null : cur)), NOTICE_MS)
  }, [])
  const dismiss = useCallback(() => setNotice(null), [])
  return { notice, show, dismiss }
}

// 제목 요청을 만드는 쪽 — 같은 문서면 바로, 다른 문서면 그 문서가 그려진 뒤 DocPane 이 처리한다
function useHeadingRequests() {
  const [request, setRequest] = useState<HeadingRequest | null>(null)
  const seqRef = useRef(0)
  const requestHeading = useCallback((docId: string, heading: string) => {
    setRequest({ docId, heading, seq: ++seqRef.current })
  }, [])
  const clearRequest = useCallback((done: HeadingRequest) => {
    setRequest((cur) => (cur && cur.seq === done.seq ? null : cur))
  }, [])
  return { request, requestHeading, clearRequest }
}

// 원문에서 attachments/{id}.{ext} 참조를 찾아 확장자를 얻는다 — 공개 문서는 id 만으로 GET 경로를 못 만든다 (F-209.md 2.6)
function findAttachmentExt(content: string, id: string): string | null {
  const m = new RegExp(`attachments/${id}\\.(png|jpg|gif|webp)`).exec(content)
  return m ? m[1] : null
}

type DocLoadState =
  | { status: 'loading' }
  | { status: 'ready'; doc: PublicDoc }
  | { status: 'not_found' }
  | { status: 'network' }

// Outline(F-144)이 요구하는 최소 핸들 — CM6 EditorView 없이 EditorState 하나로 제목·줄 위치만 흉내낸다
type FakeEditorHandle = {
  getHeadings(): Heading[]
  onHeadingsChange(cb: (headings: Heading[]) => void): () => void
  view: EditorView
  scrollToHeading(from: number): void
  focus(): void
}

function makeFakeHandle(content: string): FakeEditorHandle {
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  return {
    getHeadings: () => extractHeadings(state),
    onHeadingsChange: () => () => {},
    view: { state } as unknown as EditorView,
    scrollToHeading: () => {},
    focus: () => {},
  }
}

// 공개 보기 화면 전용 설정 상태 — 테마/서체/글자 크기 4개만(들여쓰기·줄 번호는 없음, F-230 2.1). 그 브라우저의 기존 값을 읽고 쓴다(F-121·F-141·F-154 와 같은 키)
type PublicSettings = {
  theme: string
  // 적용된 테마(white|sepia|dark, theme 과 달리 'system' 을 시스템 설정으로 풀어낸 값) — mermaid 렌더링에 쓰인다(F-260 2.4)
  resolvedTheme: 'white' | 'sepia' | 'dark'
  headingFont: string
  bodyFont: string
  fontSize: string
  changeTheme: (value: string) => void
  changeHeadingFont: (value: string) => void
  changeBodyFont: (value: string) => void
  changeFontSize: (value: string) => void
}

function usePublicSettings(): PublicSettings {
  const [theme, setTheme] = useState(() => getPref('md.theme', 'system'))
  const [resolvedTheme, setResolvedTheme] = useState<'white' | 'sepia' | 'dark'>(() =>
    resolveTheme(getPref('md.theme', 'system'), typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const [headingFont, setHeadingFont] = useState(() => getPref('md.headingFont', 'serif'))
  const [bodyFont, setBodyFont] = useState(() => getPref('md.bodyFont', 'sans'))
  const [fontSize, setFontSize] = useState(() => getPref('md.fontSize', 'medium'))

  // 시스템 테마를 따르는 동안은 OS 설정 변화도 즉시 반영한다 (App.tsx 와 같은 방식, F-141 3.1)
  useEffect(() => {
    if (theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      const resolved = resolveTheme('system', mql.matches)
      document.documentElement.dataset.theme = resolved
      setResolvedTheme(resolved)
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  function changeTheme(value: string) {
    const v = value as 'system' | 'white' | 'sepia' | 'dark'
    setTheme(v)
    setPref('md.theme', v)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const resolved = resolveTheme(v, prefersDark)
    document.documentElement.dataset.theme = resolved
    setResolvedTheme(resolved)
  }

  function changeHeadingFont(value: string) {
    const v = value as 'serif' | 'sans'
    setHeadingFont(v)
    document.documentElement.dataset.headingFont = v
    setPref('md.headingFont', v)
  }

  function changeBodyFont(value: string) {
    const v = value as 'sans' | 'serif'
    setBodyFont(v)
    document.documentElement.dataset.bodyFont = v
    setPref('md.bodyFont', v)
  }

  function changeFontSize(value: string) {
    const v = value as 'small' | 'medium' | 'large'
    setFontSize(v)
    document.documentElement.dataset.fontSize = v
    setPref('md.fontSize', v)
  }

  return { theme, resolvedTheme, headingFont, bodyFont, fontSize, changeTheme, changeHeadingFont, changeBodyFont, changeFontSize }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

type PublicViewProps =
  | { kind: 'doc'; token: string }
  | { kind: 'folder'; token: string; docId?: string }

// 문서 하나를 읽어 머리 줄 + 본문 + 목차를 그린다 — 어떤 attachments 경로로 읽을지만 호출부가 정한다 (F-210.md 2.4·2.5, F-211.md 2.3)
// resolveWikiLink·onOpenWikiLink 를 주지 않으면 위키링크는 지금처럼 wikilink--plain (F-252.md 4.6)
function DocPane({
  docKey,
  state,
  resolveAttachment,
  onExport,
  onRetry,
  notFoundMessage = '링크가 없거나 끊겼습니다.',
  showBrand = true,
  settings,
  resolveWikiLink,
  onOpenWikiLink,
  shownDocId = null,
  headingRequest = null,
  onHeadingDone,
}: {
  docKey: string
  state: DocLoadState
  resolveAttachment: ResolveAttachment
  onExport: () => void
  onRetry: () => void
  notFoundMessage?: string
  showBrand?: boolean
  settings: PublicSettings
  resolveWikiLink?: (target: string) => string | null
  onOpenWikiLink?: (target: string, heading?: string | null) => void
  // 지금 그리는 문서 id 와 이동할 제목 — 그 문서가 그려진 뒤 한 번 이동하고 onHeadingDone(찾았나) (F-2018 11.3)
  shownDocId?: string | null
  headingRequest?: HeadingRequest | null
  onHeadingDone?: (request: HeadingRequest, found: boolean) => void
}) {
  const contentAreaRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const doc = state.status === 'ready' ? state.doc : null
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (doc) document.title = doc.title || '제목 없는 문서'
  }, [doc])

  const fakeHandle = useMemo(() => (doc ? makeFakeHandle(doc.content) : null), [doc])
  const editorRef = useMemo(() => ({ current: fakeHandle }), [fakeHandle])

  const title = doc ? doc.title || '제목 없는 문서' : ''
  // sourceLines — h4~h6 에도 줄 번호가 붙어야 헤딩 이동이 요소를 찾는다 (F-2018 7.3)
  const html = doc ? renderMarkdown(doc.content, { resolveWikiLink, sourceLines: true }) : ''

  useEffect(() => {
    if (!headingRequest || !doc || headingRequest.docId !== shownDocId) return
    const container = viewerRef.current
    if (!container) return
    const line = findHeadingLine(doc.content, headingRequest.heading)
    if (line === null) {
      container.scrollTo({ top: 0 })
    } else {
      const place = () => {
        const el = findViewerHeadingElByLine(container, line)
        if (el) container.scrollTo({ top: Math.max(0, topInScroller(el, container) - HEADING_JUMP_MARGIN) })
      }
      place()
      requestAnimationFrame(() => requestAnimationFrame(place))
    }
    onHeadingDone?.(headingRequest, line !== null)
  }, [headingRequest, doc, shownDocId, onHeadingDone])

  return (
    <div className="public-view-main">
      <div className="public-view-header">
        <div className="public-view-header-lead">
          {showBrand && (
            <>
              <PublicBrand />
              <span className="public-brand-divider" aria-hidden="true" />
            </>
          )}
          <h1 className="public-view-title">{title}</h1>
        </div>
        <span className="icon-btn-wrap">
          <button type="button" className="icon-btn public-view-settings" aria-label="설정" onClick={() => setSettingsOpen(true)}>
            <IconSettings size={18} />
          </button>
          <IconTooltip text="설정" />
        </span>
        <span className="icon-btn-wrap">
          <button type="button" className="icon-btn public-view-export" aria-label=".md 내보내기" disabled={!doc} onClick={onExport}>
            <IconDownload size={18} />
          </button>
          <IconTooltip text=".md 내보내기" align="end" />
        </span>
      </div>
      <div className="public-view-body content-area" ref={contentAreaRef}>
        {state.status === 'loading' && <p className="public-view-notice">불러오는 중…</p>}
        {state.status === 'not_found' && <p className="public-view-notice">{notFoundMessage}</p>}
        {state.status === 'network' && (
          <div className="public-view-notice">
            <p>링크를 불러오지 못했습니다. 연결을 확인하세요.</p>
            <button type="button" onClick={onRetry}>
              <IconRefresh size={18} />
              다시 시도
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <Viewer
              ref={viewerRef}
              html={html}
              theme={settings.resolvedTheme}
              resolveAttachment={resolveAttachment}
              codeCopy
              onOpenWikiLink={onOpenWikiLink}
            />
            <Outline editorRef={editorRef} containerRef={contentAreaRef} viewerRef={viewerRef} docId={docKey} viewMode="view" />
          </>
        )}
      </div>
      <SettingsDialog
        open={settingsOpen}
        theme={settings.theme}
        onChangeTheme={settings.changeTheme}
        headingFont={settings.headingFont}
        onChangeHeadingFont={settings.changeHeadingFont}
        bodyFont={settings.bodyFont}
        onChangeBodyFont={settings.changeBodyFont}
        fontSize={settings.fontSize}
        onChangeFontSize={settings.changeFontSize}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  )
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false))
  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    function handle(e: MediaQueryListEvent) {
      setNarrow(e.matches)
    }
    mql.addEventListener('change', handle)
    return () => mql.removeEventListener('change', handle)
  }, [])
  return narrow
}

export default function PublicView(props: PublicViewProps) {
  // 문서·폴더 화면이 설정 상태를 따로 갖지 않는다 — 여기서 한 번만 관리한다 (F-230 2.3)
  const settings = usePublicSettings()
  if (props.kind === 'folder') return <PublicFolderView token={props.token} docId={props.docId} settings={settings} />
  return <PublicDocView token={props.token} settings={settings} />
}

// 해시(`#/p/{토큰}/{문서id}`)에서 초기 활성 문서 id 를 읽는다 — 없으면 시작 문서 (F-252.md 4.2·4.4)
function initialSetDocId(): string | null {
  const route = parseHash(location.hash)
  return route.type === 'public' && route.docId ? route.docId : null
}

// `#/p/{토큰}` 문서 단독 공개 보기 + 위키링크로 딸린 묶음 이동 (F-210.md 2.4, F-252.md 4.4)
function PublicDocView({ token, settings }: { token: string; settings: PublicSettings }) {
  const [startState, setStartState] = useState<DocLoadState>({ status: 'loading' })
  // null = 못 받았거나 아직 못 받음 — 이때는 묶음 없이 지금처럼 단일 문서로 취급한다
  const [setDocs, setSetDocs] = useState<PublicSetDoc[] | null>(null)
  const [activeDocId, setActiveDocId] = useState<string | null>(initialSetDocId)
  // forId(요청한 id)와 결과 — activeDocId 가 forId 와 다르면 렌더 중 loading 으로 유도한다
  const [docResult, setDocResult] = useState<{ forId: string; state: DocLoadState } | null>(null)
  // 연달아 재시도하면 응답이 뒤바뀌어 올 수 있다 — 가장 최근 요청의 결과만 반영한다
  const startRequestIdRef = useRef(0)
  const docRequestIdRef = useRef(0)

  const startDocId = setDocs && setDocs.length > 0 ? setDocs[0].id : null
  const isStartDoc = activeDocId === null || activeDocId === startDocId
  const shownDocId = isStartDoc ? startDocId : activeDocId
  const { notice, show: showNotice, dismiss: dismissNotice } = usePublicNotice()
  const { request: headingRequest, requestHeading, clearRequest } = useHeadingRequests()

  useEffect(() => {
    let cancelled = false
    const requestId = ++startRequestIdRef.current
    fetchPublicDoc(token)
      .then((next) => {
        if (!cancelled && startRequestIdRef.current === requestId) setStartState({ status: 'ready', doc: next })
      })
      .catch((err: unknown) => {
        if (cancelled || startRequestIdRef.current !== requestId) return
        setStartState(err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' })
      })
    // 실패해도 시작 문서 표시는 막지 않는다 — 묶음을 못 받으면 위키링크는 plain (4.4)
    fetchPublicSet(token)
      .then((next) => {
        if (!cancelled) setSetDocs(next.docs)
      })
      .catch(() => {
        if (!cancelled) setSetDocs(null)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (isStartDoc || activeDocId === null) return
    const id = activeDocId
    let cancelled = false
    const requestId = ++docRequestIdRef.current
    fetchPublicSetDoc(token, id)
      .then((next) => {
        if (!cancelled && docRequestIdRef.current === requestId) setDocResult({ forId: id, state: { status: 'ready', doc: next } })
      })
      .catch((err: unknown) => {
        if (cancelled || docRequestIdRef.current !== requestId) return
        setDocResult({ forId: id, state: err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' } })
      })
    return () => {
      cancelled = true
    }
  }, [token, activeDocId, isStartDoc])

  const state: DocLoadState = isStartDoc
    ? startState
    : docResult && docResult.forId === activeDocId
      ? docResult.state
      : { status: 'loading' }
  const doc = state.status === 'ready' ? state.doc : null

  // 대상 → 묶음 문서 id. '' 는 지금 문서, 서버 링크 표(links)가 있으면 그것만, 없으면(옛 서버) 묶음 안 제목으로 (F-2018 11.1)
  const resolveSetTarget = useMemo(() => {
    if (!setDocs || setDocs.length < 2) return null
    const links = setDocs.find((d) => d.id === shownDocId)?.links
    return (target: string): string | null => {
      if (target === '') return shownDocId
      if (links) return Object.prototype.hasOwnProperty.call(links, target) ? links[target] : null
      return resolveWikiTarget(target, setDocs)?.id ?? null
    }
  }, [setDocs, shownDocId])

  // 묶음 문서가 2개 이상일 때만 위키링크를 클릭 가능하게 한다 (4.4)
  const resolveWikiLink = useMemo(() => {
    if (!resolveSetTarget) return undefined
    return (target: string) => {
      const id = resolveSetTarget(target)
      return id ? formatPublicHash(token, id) : null
    }
  }, [resolveSetTarget, token])

  const openSetDoc = useCallback(
    (id: string) => {
      setActiveDocId(id)
      history.pushState(null, '', `${location.pathname}${location.search}${formatPublicHash(token, id)}`)
    },
    [token],
  )

  // 8.3 과 같은 순서 — 지금 문서면 제목 이동, 다른 묶음 문서면 연 뒤 이동, 못 풀면 아무것도 안 한다 (F-2018 11.1)
  const onOpenWikiLink = useCallback(
    (target: string, heading?: string | null) => {
      if (!resolveSetTarget) return
      const id = resolveSetTarget(target)
      if (!id) return
      if (id !== shownDocId) openSetDoc(id)
      if (heading) requestHeading(id, heading)
    },
    [resolveSetTarget, shownDocId, openSetDoc, requestHeading],
  )

  const onHeadingDone = useCallback(
    (done: HeadingRequest, found: boolean) => {
      clearRequest(done)
      if (!found) showNotice(`"${done.heading}" 제목을 찾지 못해 문서 처음을 엽니다.`)
    },
    [clearRequest, showNotice],
  )

  // 뒤로·앞으로 가기로 문서 id 가 바뀌면 그 문서를 연다 (F-211 PublicFolderView 와 같은 방식)
  useEffect(() => {
    function handleHashChange() {
      const route = parseHash(location.hash)
      setActiveDocId(route.type === 'public' && route.docId ? route.docId : null)
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const resolveAttachment: ResolveAttachment = useCallback(
    async (id) => {
      if (!doc) return null
      const ext = findAttachmentExt(doc.content, id)
      if (!ext) return null
      const path = isStartDoc
        ? `/pub/docs/${encodeURIComponent(token)}/attachments/${id}.${ext}`
        : `/pub/docs/${encodeURIComponent(token)}/docs/${encodeURIComponent(activeDocId as string)}/attachments/${id}.${ext}`
      const res = await fetch(path, { cache: 'no-store' })
      if (!res.ok) return null
      const blob = await res.blob()
      try {
        const bitmap = await createImageBitmap(blob)
        const { width, height } = bitmap
        bitmap.close?.()
        return { blob, width, height }
      } catch {
        return null
      }
    },
    [doc, token, isStartDoc, activeDocId],
  )

  async function handleExport() {
    if (!doc) return
    const store = {
      async getAttachment(id: string) {
        const ext = findAttachmentExt(doc.content, id)
        if (!ext) return null
        const path = isStartDoc
          ? `/pub/docs/${encodeURIComponent(token)}/attachments/${id}.${ext}`
          : `/pub/docs/${encodeURIComponent(token)}/docs/${encodeURIComponent(activeDocId as string)}/attachments/${id}.${ext}`
        const res = await fetch(path, { cache: 'no-store' })
        if (!res.ok) return null
        return { id, ext, blob: await res.blob() }
      },
    }
    const payload = await buildExportPayload({ text: doc.content, title: doc.title, store })
    const mime = payload.kind === 'zip' ? 'application/zip' : 'text/markdown;charset=utf-8'
    downloadBlob(new Blob([payload.bytes], { type: mime }), payload.filename)
  }

  function retry() {
    if (isStartDoc) {
      const requestId = ++startRequestIdRef.current
      setStartState({ status: 'loading' })
      fetchPublicDoc(token)
        .then((next) => {
          if (startRequestIdRef.current === requestId) setStartState({ status: 'ready', doc: next })
        })
        .catch((err: unknown) => {
          if (startRequestIdRef.current !== requestId) return
          setStartState(err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' })
        })
      return
    }
    const id = activeDocId as string
    const requestId = ++docRequestIdRef.current
    setDocResult(null)
    fetchPublicSetDoc(token, id)
      .then((next) => {
        if (docRequestIdRef.current === requestId) setDocResult({ forId: id, state: { status: 'ready', doc: next } })
      })
      .catch((err: unknown) => {
        if (docRequestIdRef.current !== requestId) return
        setDocResult({ forId: id, state: err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' } })
      })
  }

  return (
    <div className="public-view">
      <NoticeBar notice={notice} onDismiss={dismissNotice} />
      <DocPane
        docKey={activeDocId ?? token}
        state={state}
        resolveAttachment={resolveAttachment}
        onExport={handleExport}
        onRetry={retry}
        settings={settings}
        resolveWikiLink={resolveWikiLink}
        onOpenWikiLink={onOpenWikiLink}
        shownDocId={shownDocId}
        headingRequest={headingRequest}
        onHeadingDone={onHeadingDone}
      />
    </div>
  )
}

type FolderLoadState =
  | { status: 'loading' }
  | { status: 'ready'; folder: PublicFolder }
  | { status: 'not_found' }
  | { status: 'network' }

// `#/p/f/{토큰}[/{문서id}]` 폴더 공개 보기 — 왼쪽 문서 목록 + 오른쪽 문서 본문 (F-211.md 2.3)
function PublicFolderView({ token, docId, settings }: { token: string; docId?: string; settings: PublicSettings }) {
  const [folderState, setFolderState] = useState<FolderLoadState>({ status: 'loading' })
  const [activeDocId, setActiveDocId] = useState<string | null>(docId ?? null)
  // 요청한 문서 id(forId)와 결과. activeDocId 가 forId 와 다르면 렌더 중에 loading 으로 유도한다(react-hooks/set-state-in-effect)
  const [docResult, setDocResult] = useState<{ forId: string; state: DocLoadState } | null>(null)
  const narrow = useNarrow()
  const [listOpen, setListOpen] = useState(false)
  // 폴더별로 첫 문서를 한 번만 고르기 위한 표시. 렌더 중 상태를 맞추는 공식 패턴(React 문서 "Adjusting state when a prop changes")
  const [autoPickedFor, setAutoPickedFor] = useState<string | null>(null)
  // 같은 문서를 연달아 재시도하면 응답이 뒤바뀌어 올 수 있다 — 가장 최근 요청의 결과만 반영한다
  const docRequestIdRef = useRef(0)
  const { notice, show: showNotice, dismiss: dismissNotice } = usePublicNotice()
  const { request: headingRequest, requestHeading, clearRequest } = useHeadingRequests()

  useEffect(() => {
    let cancelled = false
    fetchPublicFolder(token)
      .then((next) => {
        if (!cancelled) setFolderState({ status: 'ready', folder: next })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFolderState(err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // 폴더를 불러온 뒤 문서 id 가 없으면 목록 맨 위 문서를 골라 해시를 교체한다 (2.3)
  if (folderState.status === 'ready' && !activeDocId && autoPickedFor !== token) {
    setAutoPickedFor(token)
    const firstId = firstFolderDocId(folderState.folder)
    if (firstId) {
      setActiveDocId(firstId)
      history.replaceState(null, '', `${location.pathname}${location.search}${formatPublicFolderHash(token, firstId)}`)
    }
  }

  useEffect(() => {
    document.title = folderState.status === 'ready' ? folderState.folder.name || '제목 없는 폴더' : ''
  }, [folderState])

  useEffect(() => {
    if (!activeDocId) return
    let cancelled = false
    const requestId = ++docRequestIdRef.current
    fetchPublicFolderDoc(token, activeDocId)
      .then((next) => {
        if (!cancelled && docRequestIdRef.current === requestId) setDocResult({ forId: activeDocId, state: { status: 'ready', doc: next } })
      })
      .catch((err: unknown) => {
        if (cancelled || docRequestIdRef.current !== requestId) return
        setDocResult({
          forId: activeDocId,
          state: err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' },
        })
      })
    return () => {
      cancelled = true
    }
  }, [token, activeDocId])

  const docState: DocLoadState = docResult && docResult.forId === activeDocId ? docResult.state : { status: 'loading' }
  const doc = docState.status === 'ready' ? docState.doc : null

  // 위키링크는 이 폴더 안 문서만 대상 풀로 쓴다 — 폴더 밖 제목이 새어나가지 않는다 (F-252.md 4.5). 해석기는 최근 수정 순 문서 + 링크 폴더를 보탠 폴더 목록 (F-2018 11.2)
  const folderResolver = useMemo(() => {
    if (folderState.status !== 'ready') return null
    const { folder } = folderState
    return createWikiResolver(
      sortDocsByUpdatedAtDesc(folder.docs).map((d) => ({ id: d.id, title: d.title, folderId: d.folderId })),
      withLinkFolder(folder),
    )
  }, [folderState])
  const sourceFolderId =
    folderState.status === 'ready' ? (folderState.folder.docs.find((d) => d.id === activeDocId)?.folderId ?? null) : null

  const resolveFolderTarget = useCallback(
    (target: string): string | null => {
      if (target === '') return activeDocId
      return folderResolver?.resolve(target, sourceFolderId)?.id ?? null
    },
    [folderResolver, sourceFolderId, activeDocId],
  )

  const resolveWikiLink = useCallback(
    (target: string) => {
      const id = resolveFolderTarget(target)
      return id ? formatPublicFolderHash(token, id) : null
    },
    [resolveFolderTarget, token],
  )

  const onOpenWikiLink = useCallback(
    (target: string, heading?: string | null) => {
      const id = resolveFolderTarget(target)
      if (!id) return
      if (id !== activeDocId) selectDoc(id)
      if (heading) requestHeading(id, heading)
    },
    [resolveFolderTarget, activeDocId, selectDoc, requestHeading],
  )

  const onHeadingDone = useCallback(
    (done: HeadingRequest, found: boolean) => {
      clearRequest(done)
      if (!found) showNotice(`"${done.heading}" 제목을 찾지 못해 문서 처음을 엽니다.`)
    },
    [clearRequest, showNotice],
  )

  const resolveAttachment: ResolveAttachment = useCallback(
    async (id) => {
      if (!doc || !activeDocId) return null
      const ext = findAttachmentExt(doc.content, id)
      if (!ext) return null
      const res = await fetch(`/pub/folders/${encodeURIComponent(token)}/docs/${encodeURIComponent(activeDocId)}/attachments/${id}.${ext}`, {
        cache: 'no-store',
      })
      if (!res.ok) return null
      const blob = await res.blob()
      try {
        const bitmap = await createImageBitmap(blob)
        const { width, height } = bitmap
        bitmap.close?.()
        return { blob, width, height }
      } catch {
        return null
      }
    },
    [doc, activeDocId, token],
  )

  async function handleExport() {
    if (!doc || !activeDocId) return
    const store = {
      async getAttachment(id: string) {
        const ext = findAttachmentExt(doc.content, id)
        if (!ext) return null
        const res = await fetch(`/pub/folders/${encodeURIComponent(token)}/docs/${encodeURIComponent(activeDocId)}/attachments/${id}.${ext}`, {
          cache: 'no-store',
        })
        if (!res.ok) return null
        return { id, ext, blob: await res.blob() }
      },
    }
    const payload = await buildExportPayload({ text: doc.content, title: doc.title, store })
    const mime = payload.kind === 'zip' ? 'application/zip' : 'text/markdown;charset=utf-8'
    downloadBlob(new Blob([payload.bytes], { type: mime }), payload.filename)
  }

  function retryDoc() {
    if (!activeDocId) return
    const requestId = ++docRequestIdRef.current
    setDocResult(null)
    fetchPublicFolderDoc(token, activeDocId)
      .then((next) => {
        if (docRequestIdRef.current === requestId) setDocResult({ forId: activeDocId, state: { status: 'ready', doc: next } })
      })
      .catch((err: unknown) => {
        if (docRequestIdRef.current !== requestId) return
        setDocResult({
          forId: activeDocId,
          state: err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' },
        })
      })
  }

  function selectDoc(id: string) {
    if (id === activeDocId) {
      setListOpen(false)
      return
    }
    setActiveDocId(id)
    history.pushState(null, '', `${location.pathname}${location.search}${formatPublicFolderHash(token, id)}`)
    setListOpen(false)
  }

  // 뒤로·앞으로 가기로 문서 id 가 바뀌면 그 문서를 연다
  useEffect(() => {
    function handleHashChange() {
      const match = /^#\/p\/f\/[^/]+\/(.+)$/.exec(location.hash)
      if (match && match[1] !== activeDocId) setActiveDocId(match[1])
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [activeDocId])

  if (folderState.status === 'loading') {
    return (
      <div className="public-view public-view--folder">
        <div className="public-folder-topbar">
          <PublicBrand />
        </div>
        <p className="public-view-notice">불러오는 중…</p>
      </div>
    )
  }
  if (folderState.status === 'not_found') {
    return (
      <div className="public-view public-view--folder">
        <div className="public-folder-topbar">
          <PublicBrand />
        </div>
        <p className="public-view-notice">링크가 없거나 끊겼습니다.</p>
      </div>
    )
  }
  if (folderState.status === 'network') {
    return (
      <div className="public-view public-view--folder">
        <div className="public-folder-topbar">
          <PublicBrand />
        </div>
        <div className="public-view-notice">
          <p>링크를 불러오지 못했습니다. 연결을 확인하세요.</p>
        </div>
      </div>
    )
  }

  const noDocs = folderState.folder.docs.length === 0

  return (
    <div className="public-view public-view--folder">
      <NoticeBar notice={notice} onDismiss={dismissNotice} />
      {narrow && (
        <div className="public-folder-topbar">
          <PublicBrand />
          <span className="icon-btn-wrap">
            <button
              type="button"
              className="icon-btn public-folder-list-toggle"
              aria-label={listOpen ? '문서 목록 닫기' : '문서 목록 열기'}
              aria-expanded={listOpen}
              onClick={() => setListOpen((v) => !v)}
            >
              {listOpen ? <IconPanelClose size={18} /> : <IconPanelOpen size={18} />}
            </button>
            <IconTooltip text={listOpen ? '문서 목록 닫기' : '문서 목록 열기'} align="end" />
          </span>
        </div>
      )}
      <div className="public-folder-layout">
        {(!narrow || listOpen) && (
          <>
            <PublicFolderList folder={folderState.folder} currentDocId={activeDocId} onSelectDoc={selectDoc} />
            {narrow && <div className="public-folder-backdrop" onClick={() => setListOpen(false)} />}
          </>
        )}
        {noDocs ? (
          <div className="public-view-main">
            <p className="public-view-notice">이 폴더에 문서가 없습니다.</p>
          </div>
        ) : (
          <DocPane
            docKey={activeDocId ?? token}
            state={docState}
            resolveAttachment={resolveAttachment}
            onExport={handleExport}
            onRetry={retryDoc}
            notFoundMessage="이 문서는 더 이상 공유되지 않습니다."
            showBrand={false}
            settings={settings}
            resolveWikiLink={resolveWikiLink}
            onOpenWikiLink={onOpenWikiLink}
            shownDocId={activeDocId}
            headingRequest={headingRequest}
            onHeadingDone={onHeadingDone}
          />
        )}
      </div>
    </div>
  )
}

// 응답 folders 에는 링크 폴더 자신이 없다 — 가리키는 id 가 하나로 정해지면 { 그 id, 폴더 이름, 최상위 } 를 보탠다 (F-2018 11.2)
function withLinkFolder(folder: PublicFolder): WikiFolderRef[] {
  const known = new Set(folder.folders.map((f) => f.id))
  const pointed = new Set<string>()
  for (const d of folder.docs) if (d.folderId !== null && !known.has(d.folderId)) pointed.add(d.folderId)
  for (const f of folder.folders) if (f.parentId !== null && !known.has(f.parentId)) pointed.add(f.parentId)
  const refs: WikiFolderRef[] = folder.folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId }))
  if (pointed.size === 1) refs.push({ id: [...pointed][0], name: folder.name, parentId: null })
  return refs
}
