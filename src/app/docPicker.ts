// 시작 문서 고르기 — 잠긴 금고 문서를 뺀 최근 수정순 목록과 처음 채울 문서 (small 2026-10-14)

export type PickerDoc = { id: string; title: string; updatedAt: number; e2ee?: 'locked' | 'open' }

export function filterPickerDocs<T extends PickerDoc>(docs: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase()
  return docs
    .filter((d) => d.e2ee !== 'locked' && d.title.toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function defaultStartDocId(docs: readonly PickerDoc[], currentDocId: string | null): string {
  const list = filterPickerDocs(docs, '')
  return (list.find((d) => d.id === currentDocId) ?? list[0])?.id ?? ''
}
