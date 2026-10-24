// 칸반 카드 아래 첨부 이미지 썸네일 한 줄 — 3장까지, 넘치면 +N (small 2026-10-24)
import { useEffect, useRef } from 'react'
import type { CardImage } from '../../lib/kanban/kanbanImages'
import { revokeAttachmentUrl } from '../../lib/attachmentUrls'
import { fillAttachmentImages, type ResolveAttachment } from '../../viewer/fillMarkdownAssets'

const MAX_THUMBS = 3

export default function KanbanCardImages({ images, resolveAttachment }: { images: CardImage[]; resolveAttachment?: ResolveAttachment }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = images.slice(0, MAX_THUMBS)
  const key = shown.map((i) => i.id).join(',')

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let cancelled = false
    let urls: string[] = []
    void fillAttachmentImages(root, resolveAttachment).then((made) => {
      if (cancelled) made.forEach(revokeAttachmentUrl)
      else urls = made
    })
    return () => {
      cancelled = true
      urls.forEach(revokeAttachmentUrl)
    }
  }, [key, resolveAttachment])

  return (
    <div ref={rootRef} className={`kanban-card-images${shown.length === 1 ? ' kanban-card-images--one' : ''}`}>
      {shown.map((image, i) => (
        <div key={`${key}-${i}`} className="kanban-card-image">
          <img data-attachment={image.id} alt={image.alt} draggable={false} />
          {i === shown.length - 1 && images.length > MAX_THUMBS && <span className="kanban-card-image-more">+{images.length - MAX_THUMBS}</span>}
        </div>
      ))}
    </div>
  )
}
