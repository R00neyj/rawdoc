// 공개 보기 화면 S-5 (specs/features/F-210.md 2.4, F-209.md 2.6) — 저장소를 열지 않는다, 사이드바·상단바·상태바 없음
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
import { fetchPublicDoc, PublicDocError, type PublicDoc } from './publicDoc'

// 원문에서 attachments/{id}.{ext} 참조를 찾아 확장자를 얻는다 — 공개 문서는 id 만으로 GET 경로를 못 만든다 (F-209.md 2.6)
function findAttachmentExt(content: string, id: string): string | null {
  const m = new RegExp(`attachments/${id}\\.(png|jpg|gif|webp)`).exec(content)
  return m ? m[1] : null
}

type LoadState =
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

type PublicViewProps = { token: string }

export default function PublicView({ token }: PublicViewProps) {
  // App.tsx 가 key={token} 으로 그려 토큰마다 새 인스턴스라 effect 에서 다시 'loading' 으로 안 되돌린다
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const contentAreaRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (doc) document.title = doc.title || '제목 없는 문서'
  }, [doc])

  // Outline(F-144) ref 모양의 평범한 객체 — 자식 effect 가 부모보다 먼저 도니 doc 이 바뀔 때 새로 만들어야 곧바로 읽힌다
  const fakeHandle = useMemo(() => (doc ? makeFakeHandle(doc.content) : null), [doc])
  const editorRef = useMemo(() => ({ current: fakeHandle }), [fakeHandle])

  // 원문에서 확장자를 찾아 공개 첨부 경로로 읽는다. 실패는 자리 표시(F-157 문구, F-209.md 2.6)
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

  const title = doc ? doc.title || '제목 없는 문서' : ''
  const html = doc ? renderMarkdown(doc.content) : ''

  return (
    <div className="public-view">
      <div className="public-view-header">
        <h1 className="public-view-title">{title}</h1>
        <button
          type="button"
          className="public-view-export"
          disabled={!doc}
          onClick={() => handleExport()}
        >
          <IconDownload size={18} />
          .md 내보내기
        </button>
      </div>
      <div className="public-view-body content-area" ref={contentAreaRef}>
        {state.status === 'loading' && <p className="public-view-notice">불러오는 중…</p>}
        {state.status === 'not_found' && <p className="public-view-notice">링크가 없거나 끊겼습니다.</p>}
        {state.status === 'network' && (
          <div className="public-view-notice">
            <p>링크를 불러오지 못했습니다. 연결을 확인하세요.</p>
            <button type="button" onClick={retry}>
              다시 시도
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <>
            <Viewer ref={viewerRef} html={html} resolveAttachment={resolveAttachment} codeCopy />
            <Outline editorRef={editorRef} containerRef={contentAreaRef} viewerRef={viewerRef} docId={token} viewMode="view" />
          </>
        )}
      </div>
    </div>
  )
}
