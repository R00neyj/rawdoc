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
import Outline from './Outline'
import { IconDownload } from './icons'
import { buildExportPayload } from './exportDoc'
import {
  fetchPublicDoc,
  fetchPublicFolder,
  fetchPublicFolderDoc,
  firstFolderDocId,
  PublicDocError,
  type PublicDoc,
  type PublicFolder,
} from './publicDoc'
import { formatPublicFolderHash } from './hashRoute'
import PublicFolderList from './PublicFolderList'
import PublicBrand from './PublicBrand'

const NARROW_QUERY = '(max-width: 1023px)'

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
function DocPane({
  docKey,
  state,
  resolveAttachment,
  onExport,
  onRetry,
  notFoundMessage = '링크가 없거나 끊겼습니다.',
  showBrand = true,
}: {
  docKey: string
  state: DocLoadState
  resolveAttachment: ResolveAttachment
  onExport: () => void
  onRetry: () => void
  notFoundMessage?: string
  showBrand?: boolean
}) {
  const contentAreaRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null)
  const doc = state.status === 'ready' ? state.doc : null

  useEffect(() => {
    if (doc) document.title = doc.title || '제목 없는 문서'
  }, [doc])

  const fakeHandle = useMemo(() => (doc ? makeFakeHandle(doc.content) : null), [doc])
  const editorRef = useMemo(() => ({ current: fakeHandle }), [fakeHandle])

  const title = doc ? doc.title || '제목 없는 문서' : ''
  const html = doc ? renderMarkdown(doc.content) : ''

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
        <button type="button" className="public-view-export" disabled={!doc} onClick={onExport}>
          <IconDownload size={18} />
          .md 내보내기
        </button>
      </div>
      <div className="public-view-body content-area" ref={contentAreaRef}>
        {state.status === 'loading' && <p className="public-view-notice">불러오는 중…</p>}
        {state.status === 'not_found' && <p className="public-view-notice">{notFoundMessage}</p>}
        {state.status === 'network' && (
          <div className="public-view-notice">
            <p>링크를 불러오지 못했습니다. 연결을 확인하세요.</p>
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <Viewer ref={viewerRef} html={html} resolveAttachment={resolveAttachment} codeCopy />
            <Outline editorRef={editorRef} containerRef={contentAreaRef} viewerRef={viewerRef} docId={docKey} viewMode="view" />
          </>
        )}
      </div>
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
  if (props.kind === 'folder') return <PublicFolderView token={props.token} docId={props.docId} />
  return <PublicDocView token={props.token} />
}

// `#/p/{토큰}` 문서 단독 공개 보기 (F-210.md 2.4)
function PublicDocView({ token }: { token: string }) {
  const [state, setState] = useState<DocLoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    fetchPublicDoc(token)
      .then((next) => {
        if (!cancelled) setState({ status: 'ready', doc: next })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState(err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' })
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const doc = state.status === 'ready' ? state.doc : null

  const resolveAttachment: ResolveAttachment = useCallback(
    async (id) => {
      if (!doc) return null
      const ext = findAttachmentExt(doc.content, id)
      if (!ext) return null
      const res = await fetch(`/pub/docs/${encodeURIComponent(token)}/attachments/${id}.${ext}`, { cache: 'no-store' })
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
    [doc, token],
  )

  async function handleExport() {
    if (!doc) return
    const store = {
      async getAttachment(id: string) {
        const ext = findAttachmentExt(doc.content, id)
        if (!ext) return null
        const res = await fetch(`/pub/docs/${encodeURIComponent(token)}/attachments/${id}.${ext}`, { cache: 'no-store' })
        if (!res.ok) return null
        return { id, ext, blob: await res.blob() }
      },
    }
    const payload = await buildExportPayload({ text: doc.content, title: doc.title, store })
    const mime = payload.kind === 'zip' ? 'application/zip' : 'text/markdown;charset=utf-8'
    downloadBlob(new Blob([payload.bytes], { type: mime }), payload.filename)
  }

  function retry() {
    setState({ status: 'loading' })
    fetchPublicDoc(token)
      .then((next) => setState({ status: 'ready', doc: next }))
      .catch((err: unknown) => {
        setState(err instanceof PublicDocError && err.kind === 'not_found' ? { status: 'not_found' } : { status: 'network' })
      })
  }

  return (
    <div className="public-view">
      <DocPane docKey={token} state={state} resolveAttachment={resolveAttachment} onExport={handleExport} onRetry={retry} />
    </div>
  )
}

type FolderLoadState =
  | { status: 'loading' }
  | { status: 'ready'; folder: PublicFolder }
  | { status: 'not_found' }
  | { status: 'network' }

// `#/p/f/{토큰}[/{문서id}]` 폴더 공개 보기 — 왼쪽 문서 목록 + 오른쪽 문서 본문 (F-211.md 2.3)
function PublicFolderView({ token, docId }: { token: string; docId?: string }) {
  const [folderState, setFolderState] = useState<FolderLoadState>({ status: 'loading' })
  const [activeDocId, setActiveDocId] = useState<string | null>(docId ?? null)
  // 요청한 문서 id(forId)와 결과. activeDocId 가 forId 와 다르면 렌더 중에 loading 으로 유도한다(react-hooks/set-state-in-effect)
  const [docResult, setDocResult] = useState<{ forId: string; state: DocLoadState } | null>(null)
  const narrow = useNarrow()
  const [listOpen, setListOpen] = useState(false)
  // 폴더별로 첫 문서를 한 번만 고르기 위한 표시. 렌더 중 상태를 맞추는 공식 패턴(React 문서 "Adjusting state when a prop changes")
  const [autoPickedFor, setAutoPickedFor] = useState<string | null>(null)

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
    fetchPublicFolderDoc(token, activeDocId)
      .then((next) => {
        if (!cancelled) setDocResult({ forId: activeDocId, state: { status: 'ready', doc: next } })
      })
      .catch((err: unknown) => {
        if (cancelled) return
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
    setDocResult(null)
    fetchPublicFolderDoc(token, activeDocId)
      .then((next) => setDocResult({ forId: activeDocId, state: { status: 'ready', doc: next } }))
      .catch((err: unknown) => {
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
      {narrow && (
        <div className="public-folder-topbar">
          <PublicBrand />
          <button type="button" className="public-folder-list-toggle" onClick={() => setListOpen((v) => !v)}>
            목록
          </button>
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
          />
        )}
      </div>
    </div>
  )
}
