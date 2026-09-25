// 첨부 blob: 주소 만들기·거두기 — 금고 첨부 주소는 따로 기억해 잠그기 blobs 단계가 한 번에 거둔다 (specs/features/F-406.md 3.2)

const e2eeUrls = new Set<string>()

// 첨부 레코드로 blob: 주소를 만든다. e2ee 면 금고 주소 목록에 넣는다
export function createAttachmentUrl(record: { blob: Blob; e2ee?: true }): string {
  const url = URL.createObjectURL(record.blob)
  if (record.e2ee) e2eeUrls.add(url)
  return url
}

// 주소 하나를 거두고 목록에서 뺀다 (평문 주소도 받는다)
export function revokeAttachmentUrl(url: string): void {
  URL.revokeObjectURL(url)
  e2eeUrls.delete(url)
}

// 목록의 금고 주소를 모두 거두고 비운다. 거둔 개수를 돌려준다 — 잠그기 blobs 단계
export function revokeE2eeAttachmentUrls(): number {
  const count = e2eeUrls.size
  for (const url of e2eeUrls) URL.revokeObjectURL(url)
  e2eeUrls.clear()
  return count
}

// 목록에 남은 금고 주소 수 (테스트용)
export function countE2eeAttachmentUrls(): number {
  return e2eeUrls.size
}
