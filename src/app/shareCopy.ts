// 공유 메뉴·명령 팔레트가 함께 쓰는 링크 복사·마크다운 복사 — ShareMenu.tsx 에서 옮김, 순수 함수 (F-2054 6.2)
import { encodeShare, type ShareDoc } from '../lib/shareCodec'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { stripComments } from '../lib/comments'
import { formatShareHash } from './hashRoute'
import type { Notice } from './notice'

export const MAX_LINK_LENGTH = 2_000_000 // Chromium url::kMaxURLChars 기준 (F-130.md 3.2)
export const WARN_LINK_LENGTH = 8_000 // 보수적으로 잡은 경고 기준 (F-130.md 3.2)

export type ShareCopyDeps = {
  getShareDoc: () => ShareDoc
  onNotice: (notice: Notice) => void
  writeText: (text: string) => Promise<void>
  baseUrl: string
}

export async function copyShareLink(deps: ShareCopyDeps): Promise<void> {
  const { getShareDoc, onNotice, writeText, baseUrl } = deps
  const rawDoc = getShareDoc()
  // 공유 링크 주소에는 주석을 담지 않는다 (F-214.md 2.2)
  const doc: ShareDoc = { ...rawDoc, content: stripComments(rawDoc.content) }
  const fragment = await encodeShare(doc)
  const link = `${baseUrl}${formatShareHash(fragment)}`

  if (link.length > MAX_LINK_LENGTH) {
    onNotice({ type: 'error', message: '문서가 너무 커서 링크로 공유할 수 없습니다. .md 내보내기를 이용하세요.' })
    return
  }

  try {
    await writeText(link)
  } catch {
    onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
    return
  }

  if (link.length > WARN_LINK_LENGTH) {
    const kb = Math.ceil(link.length / 1024)
    onNotice({
      type: 'warn',
      message: `링크가 깁니다(약 ${kb}KB). 일부 메신저에서 잘릴 수 있어 .md 내보내기를 권장합니다.`,
    })
    return
  }

  // 이미지 첨부가 있으면 링크에 담기지 않는다는 사실을 알린다 (F-158.md 2.2)
  const hasAttachments = extractAttachmentRefs(doc.content).size > 0
  onNotice({
    type: 'info',
    message: hasAttachments
      ? '공유 링크를 복사했습니다. 이미지는 링크에 담기지 않습니다.'
      : '공유 링크를 복사했습니다. 문서 내용이 링크 주소에 담깁니다.',
  })
}

export async function copyShareMarkdown(deps: ShareCopyDeps): Promise<void> {
  const { getShareDoc, onNotice, writeText } = deps
  const doc = getShareDoc()
  try {
    await writeText(doc.content)
    onNotice({ type: 'info', message: '마크다운을 복사했습니다.' })
  } catch {
    onNotice({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
  }
}
