// 보기 모드 화면 (specs/features/F-123.md 3.3, ia.md 3.9)
// editor 를 import 하지 않는다 (architecture.md 1장)
import { Fragment, useEffect, useMemo, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, Ref } from 'react'
import 'github-markdown-css/github-markdown-light.css'
import './viewer.css'

import brokenImageSvg from '@material-symbols/svg-400/outlined/broken_image.svg?raw'
import contentCopySvg from '@material-symbols/svg-400/outlined/content_copy.svg?raw'
import checkSvg from '@material-symbols/svg-400/outlined/check.svg?raw'

const DEFAULT_MISSING_TEXT = '이미지를 찾을 수 없습니다' // F-157 2.2 자리 표시와 같은 문구
const COPY_TOOLTIP = '코드 복사'
const COPY_FAIL_TOOLTIP = '복사하지 못했습니다'
const COPY_RESET_MS = 1500

export type AttachmentRecord = { blob: Blob; width: number; height: number }
export type ResolveAttachment = (id: string) => Promise<AttachmentRecord | null>

// 자리 표시로 바꾼다 (F-157 2.2 와 같은 모양, F-158 2.1)
function showPlaceholder(container: HTMLElement, alt: string, text: string): void {
  container.replaceChildren()
  container.classList.add('md-image-missing')
  container.style.aspectRatio = ''
  const icon = document.createElement('span')
  icon.className = 'md-image-missing-icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = brokenImageSvg
  const label = document.createElement('span')
  label.className = 'md-image-missing-text'
  label.textContent = text
  container.append(icon, label)
  container.setAttribute('role', 'img')
  container.setAttribute('aria-label', alt || '이미지')
}

// blob URL 을 img.src 에 넣고 불러오기 전에도 높이가 정해지게 aspect-ratio 를 준다 (F-157 2.2)
function showImage(container: HTMLElement, img: HTMLImageElement, url: string, width: number, height: number): void {
  container.classList.remove('md-image-missing')
  container.removeAttribute('role')
  container.removeAttribute('aria-label')
  if (width > 0 && height > 0) container.style.aspectRatio = `${width} / ${height}`
  img.src = url
}

// pre 오른쪽 위에 코드 복사 버튼을 붙인다. 누르면 아이콘을 1.5초 체크로 바꾸고, 실패하면 툴팁만 바꾼다 (F-210 2.5)
function buildCopyButton(getCode: () => string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'code-copy-btn'
  btn.setAttribute('aria-label', COPY_TOOLTIP)
  btn.title = COPY_TOOLTIP
  btn.innerHTML = contentCopySvg
  btn.addEventListener('click', () => {
    function onSuccess() {
      btn.innerHTML = checkSvg
      btn.title = COPY_TOOLTIP
      setTimeout(() => {
        btn.innerHTML = contentCopySvg
      }, COPY_RESET_MS)
    }
    function onFail() {
      btn.title = COPY_FAIL_TOOLTIP
    }
    // 비보안 컨텍스트·미지원 브라우저는 navigator.clipboard 자체가 없어 호출이 동기적으로 던진다 (ShareMenu.tsx 등 다른 호출부와 동일하게 감싼다)
    try {
      navigator.clipboard.writeText(getCode()).then(onSuccess, onFail)
    } catch {
      onFail()
    }
  })
  return btn
}

type BreadcrumbEntry = { id: string; name: string }

// 보기 모드·공유 화면 우클릭 메뉴가 열릴 정보 (specs/features/F-170.md 2·3.3장)
export type ViewContextMenuInfo = { x: number; y: number; hasSelection: boolean; container: HTMLElement | null }

type ViewerProps = {
  html: string
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

  // 그린 뒤 pre > code 마다 복사 버튼을 붙인다 (codeCopy 가 참일 때만, F-210 2.5)
  useEffect(() => {
    const root = containerRef.current
    if (!root || !codeCopy) return
    root.querySelectorAll('pre > code').forEach((code) => {
      const pre = code.parentElement
      if (!pre) return
      pre.appendChild(buildCopyButton(() => code.textContent ?? ''))
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
