// 안 쓰는 첨부 정리 (specs/features/F-156.md 2.7, F-406.md 5장)
import { extractAttachmentRefs } from '../lib/imageBlock'

const GRACE_MS = 24 * 60 * 60 * 1000
const IDLE_TIMEOUT_MS = 2000

export type GcStore = {
  kind: string
  // attachmentRefs — 금고 문서만(있을 때만). 잠긴 금고 문서는 content 가 비어 attachmentRefs 로만 참조를 안다 (F-406 5장)
  list(): Promise<{ content: string; attachmentRefs?: string[] }[]>
  listAttachments(): Promise<{ id: string; createdAt: number }[]>
  removeAttachment(id: string): Promise<void>
}

// 모든 문서 content 참조 ∪ attachmentRefs 합집합에 없고 createdAt 이 24시간 이전인 첨부를 지운다. 메모리 저장소는 건너뛴다. 실패는 조용히 넘긴다 (2.7, F-406 5장)
export async function cleanupUnusedAttachments({
  store,
  now = Date.now,
}: {
  store: GcStore | null | undefined
  now?: () => number
}): Promise<void> {
  if (!store || store.kind !== 'idb') return
  try {
    const [docs, attachments] = await Promise.all([store.list(), store.listAttachments()])

    const referenced = new Set<string>()
    for (const doc of docs) {
      for (const id of extractAttachmentRefs(doc.content ?? '')) referenced.add(id)
      if (Array.isArray(doc.attachmentRefs)) {
        for (const id of doc.attachmentRefs) referenced.add(id)
      }
    }

    const cutoff = now() - GRACE_MS
    const toRemove = attachments.filter((a) => !referenced.has(a.id) && a.createdAt < cutoff)
    await Promise.all(toRemove.map((a) => store.removeAttachment(a.id)))
  } catch {
    // 정리 실패는 조용히 넘긴다 (2.7)
  }
}

// 앱 시작 후 문서 목록을 읽고 나서 1회. requestIdleCallback, 없으면 setTimeout 2초(2.7). 반환값은 취소 함수
export function scheduleAttachmentGc(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(() => run())
    return () => cancelIdleCallback(handle)
  }
  const timer = setTimeout(run, IDLE_TIMEOUT_MS)
  return () => clearTimeout(timer)
}
