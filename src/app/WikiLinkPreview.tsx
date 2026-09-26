// 위키링크 미리보기 창 — 포인터 감시, 본문 읽기, Viewer 로 그리기, 닫기 조건 (specs/features/F-2044.md 4·5장)
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'

import Viewer, { type ResolveAttachment } from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { findHeadingLine } from '../viewer/headingTarget'
import { findViewerHeadingElByLine, topInScroller } from './outlinePosition'
import { findWikiLinkAt } from '../editor/preview/wikiLinks'
import { isComposing } from '../editor/composition'
import type { EditorHandle } from '../editor/Editor'
import type { WikiResolver } from '../lib/wikiResolve'
import type { Doc } from '../types'
import {
  createHoverIntent,
  placeWikiPreview,
  previewEligibility,
  slicePreviewText,
  type PreviewPlacement,
  type PreviewRect,
} from './wikiPreview'
import '../styles/wikiPreview.css'

export type WikiPreviewDocMeta = { id: string; role?: 'owner' | 'edit' | 'view'; e2ee?: 'locked' | 'open' }

type ReadDoc = Pick<Doc, 'title' | 'content' | 'folderId' | 'e2ee'>

type Session = {
  key: string
  targetId: string
  heading: string | null
  title: string
  anchorRect: PreviewRect
  status: 'loading' | 'ready' | 'blank' | 'error' | 'shared' | 'locked'
  folderId: string | null
  html?: string
  sliceText?: string
  truncated?: boolean
  e2eeOpen: boolean
}

type LinkInfo = { key: string; targetId: string; heading: string | null; title: string; el: Element; pointerY: number }

type WikiLinkPreviewProps = {
  enabled: boolean
  containerRef: RefObject<HTMLElement | null>
  editorRef: RefObject<EditorHandle | null>
  viewMode: 'live' | 'raw' | 'view'
  theme: string
  currentDocId: string | null
  currentFolderId: string | null
  wikiResolver: WikiResolver
  docs: readonly WikiPreviewDocMeta[]
  readDoc: (id: string) => Promise<ReadDoc | null>
  resolveAttachmentFor: (isE2eeDoc: boolean) => ResolveAttachment
  onOpenWikiLink: (target: string, heading: string | null, source: { docId: string; folderId: string | null }) => void
}

function rectOf(r: { left: number; top: number; right: number; bottom: number }): PreviewRect {
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

// anchor 는 포인터가 올라간 링크의 getClientRects() 가운데 포인터 y 를 담은 사각형 (3.2)
function anchorRectFor(el: Element, pointerY: number): PreviewRect {
  const rects = el.getClientRects()
  for (const r of rects) {
    if (pointerY >= r.top && pointerY <= r.bottom) return rectOf(r)
  }
  return rectOf(el.getBoundingClientRect())
}

function isModifierOnly(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'
}

export default function WikiLinkPreview({
  enabled,
  containerRef,
  editorRef,
  viewMode,
  theme,
  currentDocId,
  currentFolderId,
  wikiResolver,
  docs,
  readDoc,
  resolveAttachmentFor,
  onOpenWikiLink,
}: WikiLinkPreviewProps) {
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const linkInfoRef = useRef<LinkInfo | null>(null)
  const lastPosRef = useRef<{ x: number; y: number } | null>(null)
  const readCacheRef = useRef<{ key: string; doc: ReadDoc | null } | null>(null)
  const previewElRef = useRef<HTMLDivElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const effectiveEnabled = enabled && (viewMode === 'live' || viewMode === 'view')

  function lookupDoc(id: string): WikiPreviewDocMeta | undefined {
    return docs.find((d) => d.id === id)
  }

  const applyOpen = useCallback(
    (key: string) => {
      const info = linkInfoRef.current
      if (!info || info.key !== key) return
      const meta = lookupDoc(info.targetId)
      const eligibility = previewEligibility({ id: info.targetId, role: meta?.role, e2ee: meta?.e2ee }, currentDocId)
      if (eligibility === 'missing' || eligibility === 'self') return
      const anchorRect = anchorRectFor(info.el, info.pointerY)

      if (eligibility === 'shared') {
        setSession({ key, targetId: info.targetId, heading: info.heading, title: info.title, anchorRect, status: 'shared', folderId: null, e2eeOpen: false })
        return
      }
      if (eligibility === 'locked') {
        setSession({ key, targetId: info.targetId, heading: info.heading, title: info.title, anchorRect, status: 'locked', folderId: null, e2eeOpen: false })
        return
      }

      const cached = readCacheRef.current?.key === key ? readCacheRef.current.doc : undefined
      if (cached === undefined) {
        setSession({ key, targetId: info.targetId, heading: info.heading, title: info.title, anchorRect, status: 'loading', folderId: null, e2eeOpen: false })
      } else {
        applyReadResult(key, cached, anchorRect, info)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentDocId, docs],
  )

  function applyReadResult(key: string, doc: ReadDoc | null, anchorRect: PreviewRect, info: LinkInfo) {
    if (!doc) {
      setSession({ key, targetId: info.targetId, heading: info.heading, title: info.title, anchorRect, status: 'error', folderId: null, e2eeOpen: false })
      return
    }
    if (doc.e2ee === 'locked') {
      setSession({ key, targetId: info.targetId, heading: info.heading, title: doc.title || info.title, anchorRect, status: 'locked', folderId: doc.folderId, e2eeOpen: false })
      return
    }
    const slice = slicePreviewText(doc.content)
    if (slice.text.trim() === '') {
      setSession({ key, targetId: info.targetId, heading: info.heading, title: doc.title, anchorRect, status: 'blank', folderId: doc.folderId, e2eeOpen: doc.e2ee === 'open' })
      return
    }
    const html = renderMarkdown(slice.text, {
      sourceLines: true,
      resolveWikiLink: (t: string) => {
        if (t === '') return `#/d/${info.targetId}`
        const m = wikiResolver.resolve(t, doc.folderId)
        return m ? `#/d/${m.id}` : null
      },
    })
    setSession({
      key,
      targetId: info.targetId,
      heading: info.heading,
      title: doc.title,
      anchorRect,
      status: 'ready',
      folderId: doc.folderId,
      html,
      sliceText: slice.text,
      truncated: slice.truncated,
      e2eeOpen: doc.e2ee === 'open',
    })
  }

  function closePreview() {
    setSession(null)
    linkInfoRef.current = null
    readCacheRef.current = null
  }

  const hoverIntentRef = useRef(
    createHoverIntent({
      open: (key) => openRef.current(key),
      close: () => closeRef.current(),
    }),
  )
  const openRef = useRef(applyOpen)
  const closeRef = useRef(closePreview)
  useEffect(() => {
    openRef.current = applyOpen
    closeRef.current = closePreview
  })

  // 4.1 조건이 깨지면 대기 중인 열기를 취소하고, 열려 있으면 닫는다
  useEffect(() => {
    if (!effectiveEnabled) hoverIntentRef.current.dismiss()
  }, [effectiveEnabled])

  // 문서·모드가 바뀌면 판정을 새로 시작한다 (4.3 — 대상이 바뀌면 닫는다)
  useEffect(() => {
    hoverIntentRef.current.dismiss()
    linkInfoRef.current = null
    lastPosRef.current = null
  }, [currentDocId, viewMode])

  function findLinkUnderPointer(target: Element | null): { targetStr: string; heading: string | null; el: Element } | null {
    if (!target) return null
    if (viewMode === 'view') {
      const a = target.closest('a.wikilink:not(.wikilink--missing)')
      if (!a || !(a instanceof HTMLElement)) return null
      const t = a.dataset.wikilink
      if (t === undefined) return null
      return { targetStr: t, heading: a.dataset.wikilinkHeading ?? null, el: a }
    }
    const span = target.closest('.md-wikilink:not(.md-wikilink--missing)')
    if (!span) return null
    const view = editorRef.current?.view
    if (!view) return null
    const pos = view.posAtDOM(span)
    const link = findWikiLinkAt(view.state, pos)
    if (!link) return null
    return { targetStr: link.target, heading: link.heading, el: span }
  }

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!effectiveEnabled) return
      if (e.pointerType !== 'mouse') return
      if (e.buttons !== 0) return
      const last = lastPosRef.current
      if (last && last.x === e.clientX && last.y === e.clientY) return
      lastPosRef.current = { x: e.clientX, y: e.clientY }

      if (isComposing(editorRef.current?.view)) return

      const found = findLinkUnderPointer(e.target as Element | null)
      if (!found) {
        linkInfoRef.current = null
        hoverIntentRef.current.pointerOnLink(null)
        return
      }

      // '' 는 지금 문서 헤딩 링크 — 언제나 self, 미리보기 대상이 아니다 (2장)
      if (found.targetStr === '') {
        linkInfoRef.current = null
        hoverIntentRef.current.pointerOnLink(null)
        return
      }

      const resolved = wikiResolver.resolve(found.targetStr, currentFolderId)
      if (!resolved) {
        linkInfoRef.current = null
        hoverIntentRef.current.pointerOnLink(null)
        return
      }
      const meta = lookupDoc(resolved.id)
      const eligibility = previewEligibility({ id: resolved.id, role: meta?.role, e2ee: meta?.e2ee }, currentDocId)
      if (eligibility === 'missing' || eligibility === 'self') {
        linkInfoRef.current = null
        hoverIntentRef.current.pointerOnLink(null)
        return
      }

      const key = `${resolved.id}\u0000${found.heading ?? ''}`
      const prev = linkInfoRef.current
      if (!prev || prev.key !== key) {
        linkInfoRef.current = { key, targetId: resolved.id, heading: found.heading, title: resolved.title, el: found.el, pointerY: e.clientY }
        if (eligibility === 'ok') {
          readCacheRef.current = null
          readDoc(resolved.id).then((doc) => {
            readCacheRef.current = { key, doc }
            if (sessionRef.current?.key === key && sessionRef.current.status === 'loading') {
              const anchorRect = sessionRef.current.anchorRect
              applyReadResult(key, doc, anchorRect, linkInfoRef.current ?? { key, targetId: resolved.id, heading: found.heading, title: resolved.title, el: found.el, pointerY: e.clientY })
            }
          })
        }
      } else {
        prev.pointerY = e.clientY
      }
      hoverIntentRef.current.pointerOnLink(key)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveEnabled, viewMode, currentFolderId, currentDocId, docs, wikiResolver],
  )

  const handlePointerLeaveContainer = useCallback(() => {
    linkInfoRef.current = null
    hoverIntentRef.current.pointerOnLink(null)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return undefined
    el.addEventListener('pointermove', handlePointerMove)
    el.addEventListener('pointerleave', handlePointerLeaveContainer)
    return () => {
      el.removeEventListener('pointermove', handlePointerMove)
      el.removeEventListener('pointerleave', handlePointerLeaveContainer)
    }
  }, [containerRef, handlePointerMove, handlePointerLeaveContainer])

  // 4.3 — 닫히는 조건들. dismiss() 는 대기 취소 + 열려 있으면 close(), Esc 만 열려 있을 때로 가둔다
  useEffect(() => {
    function onKeyDownCapture(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!sessionRef.current) return
        e.preventDefault()
        e.stopPropagation()
        hoverIntentRef.current.dismiss()
        const back = returnFocusRef.current
        if (back && back.isConnected) back.focus()
        else editorRef.current?.focus()
        return
      }
      if (isModifierOnly(e.key)) return
      const root = previewElRef.current
      if (root && root.contains(e.target as Node)) return
      hoverIntentRef.current.dismiss()
    }
    function onPointerDown(e: PointerEvent) {
      const root = previewElRef.current
      if (root && root.contains(e.target as Node)) return
      hoverIntentRef.current.dismiss()
    }
    function onScrollCapture(e: Event) {
      const root = previewElRef.current
      if (root && root.contains(e.target as Node)) return
      hoverIntentRef.current.dismiss()
    }
    function onResizeOrBlur() {
      hoverIntentRef.current.dismiss()
    }
    function onCompositionStart() {
      hoverIntentRef.current.dismiss()
    }

    document.addEventListener('keydown', onKeyDownCapture, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('scroll', onScrollCapture, true)
    window.addEventListener('resize', onResizeOrBlur)
    window.addEventListener('blur', onResizeOrBlur)
    const contentEl = containerRef.current
    contentEl?.addEventListener('compositionstart', onCompositionStart)

    return () => {
      document.removeEventListener('keydown', onKeyDownCapture, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('scroll', onScrollCapture, true)
      window.removeEventListener('resize', onResizeOrBlur)
      window.removeEventListener('blur', onResizeOrBlur)
      contentEl?.removeEventListener('compositionstart', onCompositionStart)
    }
  }, [containerRef, editorRef])

  useEffect(() => () => hoverIntentRef.current.dispose(), [])

  // 위치 계산 — size 는 계산된 스타일(width·max-height)을 읽는다(3.2). ContextMenu.tsx 처럼 DOM 에 직접 쓴다
  const placementRef = useRef<PreviewPlacement | null>(null)
  useLayoutEffect(() => {
    const el = previewElRef.current
    if (!session || !el) {
      placementRef.current = null
      return
    }
    const cs = getComputedStyle(el)
    const width = parseFloat(cs.width) || 400
    const height = parseFloat(cs.maxHeight) || 400
    const placement = placeWikiPreview(session.anchorRect, { width, height }, { width: window.innerWidth, height: window.innerHeight })
    placementRef.current = placement
    el.style.width = `${placement.width}px`
    el.style.maxHeight = `${placement.maxHeight}px`
    el.style.left = `${placement.left}px`
    if (placement.side === 'below') {
      el.style.top = `${placement.top}px`
      el.style.bottom = 'auto'
    } else {
      el.style.bottom = `${placement.bottom}px`
      el.style.top = 'auto'
    }
    el.dataset.side = placement.side
    el.style.visibility = 'visible'

    // [[문서#제목]] 이면 그 제목이 창 맨 위에 오도록 스크롤 (5.2)
    if (session.status === 'ready' && session.heading) {
      const viewerRoot = el.querySelector('.viewer')
      const line = findHeadingLine(session.sliceText ?? '', session.heading)
      if (viewerRoot && line !== null) {
        const headingEl = findViewerHeadingElByLine(viewerRoot, line)
        if (headingEl) {
          ;(viewerRoot as HTMLElement).scrollTop = Math.max(0, topInScroller(headingEl, viewerRoot as HTMLElement & { scrollTop: number }))
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.key, session?.status, session?.html])

  function handleInnerWikiLink(target: string, heading?: string | null) {
    const s = sessionRef.current
    if (!s) return
    onOpenWikiLink(target, heading ?? null, { docId: s.targetId, folderId: s.folderId })
    closePreview()
  }

  function handleOpenFull() {
    const s = sessionRef.current
    if (!s) return
    onOpenWikiLink('', null, { docId: s.targetId, folderId: s.folderId })
    closePreview()
  }

  // 바깥 링크·이미지 링크(target=_blank) — 브라우저 기본 동작이 끝난 다음 작업에서 닫는다 (5.3)
  function handleRootClick(e: ReactMouseEvent<HTMLDivElement>) {
    const anchor = (e.target as HTMLElement).closest?.('a')
    if (!anchor) return
    if (anchor.classList.contains('wikilink')) return // Viewer 가 이미 처리한다
    if (anchor.target === '_blank') {
      setTimeout(() => closePreview(), 0)
    }
  }

  function handleFocusIn(e: ReactFocusEvent<HTMLDivElement>) {
    const related = e.relatedTarget as HTMLElement | null
    if (related && !previewElRef.current?.contains(related)) {
      returnFocusRef.current = related
    }
  }

  function handleFocusOut(e: ReactFocusEvent<HTMLDivElement>) {
    const related = e.relatedTarget as HTMLElement | null
    if (related && previewElRef.current?.contains(related)) return
    // 포인터가 창 위에 없으면 닫는다 (4.6)
    const root = previewElRef.current
    if (root && root.matches(':hover')) return
    hoverIntentRef.current.dismiss()
  }

  const resolveAttachment = useMemo(
    () => resolveAttachmentFor(session?.e2eeOpen ?? false),
    [resolveAttachmentFor, session?.e2eeOpen],
  )

  if (!session) return null

  const titleOrFallback = session.title || '제목 없는 문서'

  return createPortal(
    <div
      ref={previewElRef}
      className="wiki-preview"
      data-side="below"
      role="dialog"
      aria-label={`${titleOrFallback} 미리보기`}
      onPointerEnter={() => hoverIntentRef.current.pointerInPreview(true)}
      onPointerLeave={() => hoverIntentRef.current.pointerInPreview(false)}
      onClick={handleRootClick}
      onFocus={handleFocusIn}
      onBlur={handleFocusOut}
    >
      {session.status === 'loading' && <p className="wiki-preview-note">불러오는 중…</p>}
      {session.status === 'error' && <p className="wiki-preview-note">문서를 불러오지 못했습니다.</p>}
      {session.status === 'shared' && (
        <>
          <h1 className="doc-title-view">{titleOrFallback}</h1>
          <p className="wiki-preview-note">공유받은 문서는 열어야 볼 수 있습니다.</p>
        </>
      )}
      {session.status === 'locked' && <p className="wiki-preview-note">금고가 잠겨 있어 볼 수 없습니다.</p>}
      {session.status === 'blank' && (
        <>
          <h1 className="doc-title-view">{titleOrFallback}</h1>
          <p className="wiki-preview-note">빈 문서입니다.</p>
        </>
      )}
      {session.status === 'ready' && (
        <>
          <Viewer
            html={session.html ?? ''}
            theme={theme}
            title={session.title}
            onOpenWikiLink={handleInnerWikiLink}
            resolveAttachment={resolveAttachment}
          />
          {session.truncated && (
            <p className="wiki-preview-more">
              문서가 길어 앞부분만 보여 줍니다.{' '}
              <button type="button" onClick={handleOpenFull}>
                문서 열기
              </button>
            </p>
          )}
        </>
      )}
    </div>,
    document.body,
  )
}
