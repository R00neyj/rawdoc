// 보기 모드 화면 (specs/features/F-123.md 3.3, ia.md 3.9)
// editor 를 import 하지 않는다 (architecture.md 1장)
import { Fragment, useEffect, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, Ref } from 'react'
import 'github-markdown-css/github-markdown-light.css'
import './viewer.css'

import { createCodeCopyButton } from '../lib/codeCopyButton'
import { displayLangFromClass } from '../lib/codeLang'
import { renderMermaid } from '../lib/mermaidRender'
import { showPlaceholder, showImage } from './fillMarkdownAssets'

const DEFAULT_MISSING_TEXT = '이미지를 찾을 수 없습니다' // F-157 2.2 자리 표시와 같은 문구

export type AttachmentRecord = { blob: Blob; width: number; height: number }
export type ResolveAttachment = (id: string) => Promise<AttachmentRecord | null>

type BreadcrumbEntry = { id: string; name: string }

// 보기 모드·공유 화면 우클릭 메뉴가 열릴 정보 (specs/features/F-170.md 2·3.3장)
export type ViewContextMenuInfo = { x: number; y: number; hasSelection: boolean; container: HTMLElement | null }

type ViewerProps = {
  html: string
  // 앱 테마(white|sepia|dark) — mermaid 다이어그램 렌더링에 쓰인다. 생략하면 'white' (F-260.md 2.4)
  theme?: string
  // 본문 맨 위 제목 (F-217.md 2.1) — 생략하면(공유·공개 보기 화면, 이미 자체 제목 줄이 있다) 그리지 않는다
  title?: string
  // 문서가 든 폴더 경로 (F-234.md 3.4) — 생략하거나 비면 그리지 않는다
  breadcrumb?: BreadcrumbEntry[]
  onNavigateFolder?: (id: string) => void
  onOpenWikiLink?: (target: string) => void
  resolveAttachment?: ResolveAttachment
  missingImageText?: string
  codeCopy?: boolean
  // 생략하면(F-210 공개 보기) 우클릭은 브라우저 기본 메뉴 그대로 (F-170.md 3.3)
  onContextMenu?: (info: ViewContextMenuInfo) => void
  ref?: Ref<HTMLDivElement | null>
}

// resolveAttachment(id) 는 생략하면(F-130 공유 화면) 항상 자리 표시, missingImageText 는 그 문구(생략 시 F-157 2.2 문구)
// codeCopy 는 참이면 pre > code 마다 복사 버튼을 붙인다. 지금은 공개 보기(S-5)에서만 켠다 (F-210 2.5)
export default function Viewer({
  html,
  theme,
  title,
  breadcrumb,
  onNavigateFolder,
  onOpenWikiLink,
  resolveAttachment,
  missingImageText,
  codeCopy,
  onContextMenu,
  ref,
}: ViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const urlsRef = useRef<string[]>([])
  // 매 렌더 새 객체면 React 가 같은 html 로도 innerHTML 을 다시 써서 채운 이미지 src 가 사라진다
  const innerHtml = useMemo(() => ({ __html: html }), [html])

  function setRefs(node: HTMLDivElement | null) {
    containerRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref && typeof ref === 'object') ref.current = node
  }

  // 그린 뒤 img[data-attachment] 마다 첨부를 읽어 채우고, 다시 그리거나 사라질 때 blob URL 을 해제한다 (F-158 2.1)
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    for (const url of urlsRef.current) URL.revokeObjectURL(url)
    urlsRef.current = []

    let cancelled = false
    const images = root.querySelectorAll<HTMLImageElement>('img[data-attachment]')

    images.forEach((img) => {
      const container = img.parentElement
      const id = img.dataset.attachment
      const alt = img.alt
      if (!container || !id) return

      if (!resolveAttachment) {
        showPlaceholder(container, alt, missingImageText ?? DEFAULT_MISSING_TEXT)
        return
      }

      Promise.resolve()
        .then(() => resolveAttachment(id))
        .then((record) => {
          if (cancelled) return
          if (!record) {
            showPlaceholder(container, alt, DEFAULT_MISSING_TEXT)
            return
          }
          const url = URL.createObjectURL(record.blob)
          urlsRef.current.push(url)
          showImage(container, img, url, record.width, record.height)
        })
        .catch(() => {
          if (!cancelled) showPlaceholder(container, alt, DEFAULT_MISSING_TEXT)
        })
    })

    return () => {
      cancelled = true
    }
  }, [html, resolveAttachment, missingImageText])

  useEffect(() => {
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url)
      urlsRef.current = []
    }
  }, [])

  // 그린 뒤 .md-mermaid[data-mermaid-source] 마다 렌더링해 채운다 (F-258 2.4, 이미지 로드와 같은 패턴)
  // theme 이 바뀌면(F-260 2.4) html 은 그대로라도 다시 그린다 — 의존성 배열에 theme 을 넣는다
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    let cancelled = false
    const nodes = root.querySelectorAll<HTMLElement>('.md-mermaid[data-mermaid-source]')

    nodes.forEach((node) => {
      const source = node.dataset.mermaidSource
      if (source === undefined) return

      renderMermaid(source, theme ?? 'white').then((result) => {
        if (cancelled) return
        if ('svg' in result) {
          node.innerHTML = result.svg
        } else {
          node.replaceChildren()
          const errorEl = document.createElement('div')
          errorEl.className = 'md-mermaid-error'
          errorEl.textContent = result.error
          node.appendChild(errorEl)
        }
      })
    })

    return () => {
      cancelled = true
    }
  }, [html, theme])

  // 그린 뒤 pre > code 마다 머리줄(언어 + 복사 버튼)을 조립해 붙인다 (codeCopy 가 참일 때만, F-210 2.5, F-293 3.6)
  useEffect(() => {
    const root = containerRef.current
    if (!root || !codeCopy) return
    root.querySelectorAll('pre > code').forEach((code) => {
      const pre = code.parentElement
      if (!pre) return
      // 멱등 가드 — StrictMode 이중 실행으로 이미 감싸져 있으면 다시 만들지 않는다 (F-293 3.6)
      if (pre.parentElement?.classList.contains('md-code')) return

      const wrap = document.createElement('div')
      wrap.className = 'md-code'
      const head = document.createElement('div')
      head.className = 'md-code-head'
      const word = displayLangFromClass(code.className)
      if (word) {
        const lang = document.createElement('span')
        lang.className = 'md-code-lang'
        lang.textContent = word
        head.appendChild(lang)
      }
      head.appendChild(createCodeCopyButton(() => code.textContent ?? ''))

      pre.replaceWith(wrap)
      wrap.appendChild(head)
      wrap.appendChild(pre)
    })
  }, [html, codeCopy])

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement
    const anchor = target.closest?.<HTMLAnchorElement>('a.wikilink')
    if (!anchor) return
    event.preventDefault()
    if (onOpenWikiLink && anchor.dataset.wikilink) onOpenWikiLink(anchor.dataset.wikilink)
  }

  // 우클릭 메뉴 (F-170.md 2·3.3장) — Shift+우클릭은 브라우저 기본 메뉴 그대로 둔다
  function handleContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onContextMenu || event.shiftKey) return
    event.preventDefault()
    const root = containerRef.current
    const sel = window.getSelection()
    const hasSelection = Boolean(
      sel && !sel.isCollapsed && root && sel.anchorNode && root.contains(sel.anchorNode) && sel.focusNode && root.contains(sel.focusNode),
    )
    onContextMenu({ x: event.clientX, y: event.clientY, hasSelection, container: root })
  }

  return (
    <div
      ref={setRefs}
      className={`viewer${codeCopy ? ' viewer--code-copy' : ''}`}
      tabIndex={0}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    >
      {/* 폴더 안일 때만 제목 위에 경로 (F-234.md 3.4) — 제목 자체와 같은 조건(title !== undefined) */}
      {title !== undefined && breadcrumb && breadcrumb.length > 0 && (
        <span className="doc-title-label">
          {breadcrumb.map((entry, i) => (
            <Fragment key={entry.id}>
              {i > 0 && (
                <span className="doc-title-crumb-sep" aria-hidden="true">
                  {' / '}
                </span>
              )}
              <button
                type="button"
                className="doc-title-crumb"
                aria-label={`${entry.name} 폴더로 이동`}
                onClick={() => onNavigateFolder?.(entry.id)}
              >
                {entry.name}
              </button>
            </Fragment>
          ))}
        </span>
      )}
      {/* 목차(F-144) 항목에 넣지 않는다 — extractHeadings 는 본문(html)만 읽는다 (F-217.md 2.1) */}
      {title !== undefined && <h1 className="doc-title-view">{title || '제목 없는 문서'}</h1>}
      <div className="markdown-body" dangerouslySetInnerHTML={innerHtml} />
    </div>
  )
}
