// 부팅 시 열 문서를 정하는 순수 함수 (specs/features/F-111.md 2-1)
import { firstListedDocId } from './vaultVisibility'

type InitialDocLike = { id: string; e2ee?: 'locked' | 'open' }

// docs 는 updatedAt 내림차순. 해시는 전체로 판정하고(잠긴 문서는 P1), 앱이 고르는 대체 문서만 잠긴 금고 문서를 건너뛴다 (F-4003 2.2)
export function resolveInitialDoc({
  hashDocId,
  lastDocId,
  docs,
}: {
  hashDocId: string | null
  lastDocId: string | null
  docs: InitialDocLike[]
}): { docId: string | null; notFound: boolean } {
  if (hashDocId) {
    const found = docs.some((doc) => doc.id === hashDocId)
    if (found) {
      return { docId: hashDocId, notFound: false }
    }
    return { docId: fallbackDocId(lastDocId, docs), notFound: true }
  }
  return { docId: fallbackDocId(lastDocId, docs), notFound: false }
}

function fallbackDocId(lastDocId: string | null, docs: InitialDocLike[]): string | null {
  if (lastDocId && docs.some((doc) => doc.id === lastDocId && doc.e2ee !== 'locked')) {
    return lastDocId
  }
  return firstListedDocId(docs)
}
