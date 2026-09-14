// 보기 모드 화면 (specs/features/F-123.md 3.3, ia.md 3.9)
// editor 를 import 하지 않는다 (architecture.md 1장)
import { useEffect, useRef } from 'react'
import 'github-markdown-css/github-markdown-light.css'
import './viewer.css'

import brokenImageSvg from '@material-symbols/svg-400/outlined/broken_image.svg?raw'

const DEFAULT_MISSING_TEXT = '이미지를 찾을 수 없습니다' // F-157 2.2 자리 표시와 같은 문구

// 자리 표시로 바꾼다 (F-157 2.2 와 같은 모양, F-158 2.1)
function showPlaceholder(container, alt, text) {
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
function showImage(container, img, url, width, height) {
  container.classList.remove('md-image-missing')
  container.removeAttribute('role')
  container.removeAttribute('aria-label')
  if (width > 0 && height > 0) container.style.aspectRatio = `${width} / ${height}`
  img.src = url
}

// resolveAttachment(id) 는 생략하면(F-130 공유 화면) 항상 자리 표시, missingImageText 는 그 문구(생략 시 F-157 2.2 문구)
export default function Viewer({ html, onOpenWikiLink, resolveAttachment, missingImageText, ref }) {
  const containerRef = useRef(null)
  const urlsRef = useRef([])

  function setRefs(node) {
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
    const images = root.querySelectorAll('img[data-attachment]')

    images.forEach((img) => {
      const container = img.parentElement
      const id = img.dataset.attachment
      const alt = img.alt

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

  function handleClick(event) {
    const anchor = event.target.closest?.('a.wikilink')
    if (!anchor) return
    event.preventDefault()
    if (onOpenWikiLink) onOpenWikiLink(anchor.dataset.wikilink)
  }

  return (
    <div
      ref={setRefs}
      className="viewer markdown-body"
      tabIndex={0}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
