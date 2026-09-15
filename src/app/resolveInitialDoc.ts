// 부팅 시 열 문서를 정하는 순수 함수 (specs/features/F-111.md 2-1)

// docs 는 updatedAt 내림차순
export function resolveInitialDoc({
  hashDocId,
  lastDocId,
  docs,
}: {
  hashDocId: string | null
  lastDocId: string | null
  docs: { id: string }[]
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

function fallbackDocId(lastDocId: string | null, docs: { id: string }[]): string | null {
  if (lastDocId && docs.some((doc) => doc.id === lastDocId)) {
    return lastDocId
  }
  return docs.length > 0 ? docs[0].id : null
}
