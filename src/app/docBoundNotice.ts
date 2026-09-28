// 특정 문서에 대한 알림(`새 문서로 저장` 버튼이 달린 것)을 그 문서에 묶는다 (리뷰 A5)
// error·warn 알림은 문서를 바꿔도 남아서(notice.ts), 버튼이 지금 열린 다른 문서의 본문으로 새 문서를 만들 수 있었다

// 누를 때 지금 문서가 알림을 만든 문서일 때만 run 을 부른다
export function guardForDoc(docId: string, getCurrentDocId: () => string | null, run: () => void): () => void {
  return () => {
    if (getCurrentDocId() !== docId) return
    run()
  }
}

// 알림 id → 묶인 문서 id 가운데 지금 문서가 아닌 것 — 문서를 바꾸면 걷는다
export function staleDocBoundNotices(bound: ReadonlyMap<number, string>, currentDocId: string | null): number[] {
  const stale: number[] = []
  for (const [noticeId, docId] of bound) {
    if (docId !== currentDocId) stale.push(noticeId)
  }
  return stale
}
