// 그려 둔 마크다운 HTML 안 첨부 이미지·Mermaid 를 채운다 — Viewer 보기 모드와 인쇄(printDoc.ts)가 같은 함수를 쓴다 (specs/features/F-279.md 4.6)
import brokenImageSvg from '@material-symbols/svg-400/outlined/broken_image.svg?raw'
import { renderMermaid } from '../lib/mermaidRender'
import { createAttachmentUrl } from '../lib/attachmentUrls'

const DEFAULT_MISSING_TEXT = '이미지를 찾을 수 없습니다' // F-157 2.2 자리 표시와 같은 문구

export type AttachmentRecord = { blob: Blob; width: number; height: number; e2ee?: true }
export type ResolveAttachment = (id: string) => Promise<AttachmentRecord | null>

// 자리 표시로 바꾼다 (F-157 2.2 와 같은 모양, F-158 2.1)
export function showPlaceholder(container: HTMLElement, alt: string, text: string): void {
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
export function showImage(container: HTMLElement, img: HTMLImageElement, url: string, width: number, height: number): void {
  container.classList.remove('md-image-missing')
  container.removeAttribute('role')
  container.removeAttribute('aria-label')
  if (width > 0 && height > 0) container.style.aspectRatio = `${width} / ${height}`
  img.src = url
}

// root 안 img[data-attachment] 를 전부 채우고 끝날 때까지 기다린다. 만든 blob URL 목록을 돌려준다(호출 쪽이 나중에 해제)
export async function fillAttachmentImages(root: HTMLElement, resolveAttachment?: ResolveAttachment): Promise<string[]> {
  const urls: string[] = []
  const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[data-attachment]'))

  await Promise.all(
    images.map(async (img) => {
      const container = img.parentElement
      const id = img.dataset.attachment
      const alt = img.alt
      if (!container || !id) return

      if (!resolveAttachment) {
        showPlaceholder(container, alt, DEFAULT_MISSING_TEXT)
        return
      }

      try {
        const record = await resolveAttachment(id)
        if (!record) {
          showPlaceholder(container, alt, DEFAULT_MISSING_TEXT)
          return
        }
        const url = createAttachmentUrl(record)
        urls.push(url)
        showImage(container, img, url, record.width, record.height)
        await img.decode().catch(() => {})
      } catch {
        showPlaceholder(container, alt, DEFAULT_MISSING_TEXT)
      }
    }),
  )

  return urls
}

// root 안 .md-mermaid[data-mermaid-source] 를 전부 렌더링하고 끝날 때까지 기다린다 (F-258 2.2)
export async function fillMermaidBlocks(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('.md-mermaid[data-mermaid-source]'))

  await Promise.all(
    nodes.map(async (node) => {
      const source = node.dataset.mermaidSource
      if (source === undefined) return
      const result = await renderMermaid(source)
      if ('svg' in result) {
        node.innerHTML = result.svg
      } else {
        node.replaceChildren()
        const errorEl = document.createElement('div')
        errorEl.className = 'md-mermaid-error'
        errorEl.textContent = result.error
        node.appendChild(errorEl)
      }
    }),
  )
}
