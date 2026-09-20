// 인쇄 전용 영역을 채워 window.print() 를 부르고 되돌린다 (specs/features/F-279.md 4장)
import { fillAttachmentImages, fillMermaidBlocks, type ResolveAttachment } from '../viewer/fillMarkdownAssets'

// 순수 — 비었거나 공백뿐이면 '제목 없는 문서' (10장 A1)
export function printTitle(title: string): string {
  return title.trim() ? title : '제목 없는 문서'
}

let activeCleanup: (() => void) | null = null

export async function printDoc(args: {
  root: HTMLElement | null
  html: string
  title: string
  resolveAttachment?: ResolveAttachment
  print?: () => void
}): Promise<void> {
  const { root, html, title, resolveAttachment, print = () => window.print() } = args

  // root 없음 방어 — 예외 없이 끝나고 print 를 부르지 않는다 (10장 A2)
  if (!root) return

  // 이전 인쇄가 안 끝났으면 먼저 되돌린다
  activeCleanup?.()

  root.replaceChildren()
  const heading = document.createElement('h1')
  heading.className = 'doc-title-view'
  heading.textContent = title || '제목 없는 문서'
  const body = document.createElement('div')
  body.className = 'markdown-body'
  body.innerHTML = html
  root.append(heading, body)

  const urls = await fillAttachmentImages(root, resolveAttachment)
  await fillMermaidBlocks(root)
  try {
    await document.fonts.ready
  } catch {
    // 없거나 실패하면 무시
  }

  const prevTitle = document.title
  const prevTheme = document.documentElement.getAttribute('data-theme')
  document.title = printTitle(title)
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.setAttribute('data-printing', '1')

  function cleanup() {
    document.title = prevTitle
    if (prevTheme !== null) document.documentElement.setAttribute('data-theme', prevTheme)
    else document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-printing')
    for (const url of urls) URL.revokeObjectURL(url)
    root!.replaceChildren()
    window.removeEventListener('afterprint', cleanup)
    if (activeCleanup === cleanup) activeCleanup = null
  }

  activeCleanup = cleanup
  window.addEventListener('afterprint', cleanup, { once: true })

  try {
    print()
  } catch {
    cleanup()
  }
}
