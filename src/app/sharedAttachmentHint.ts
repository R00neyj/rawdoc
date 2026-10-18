import type { AttachmentExt, Doc } from '../types'
import { isSharedDoc } from './docMeta'

// 공유받은 문서는 캐시에 없어 저장소가 첨부 확장자를 못 찾는다 — 열린 본문에서 찾아 그 문서 권한으로 받게 한다 (F-212 2.2)
export function sharedAttachmentHint(
  doc: Pick<Doc, 'id' | 'role'> | null | undefined,
  readText: () => string | null,
  id: string,
): { ext: AttachmentExt; docId: string } | null {
  if (!doc || !isSharedDoc(doc)) return null
  const text = readText()
  if (text === null) return null
  const m = new RegExp(`attachments/${id}\\.(png|jpg|gif|webp)`).exec(text)
  return m ? { ext: m[1] as AttachmentExt, docId: doc.id } : null
}
