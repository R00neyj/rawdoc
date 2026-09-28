// 저장소 영속화 요청 — 이미 허락돼 있으면 그대로, 아니면 persist() 요청, 결과 반환(API 없으면 null) (specs/features/F-118.md, specs/architecture.md 4장)
export async function ensurePersist(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null
  const already = await navigator.storage.persisted?.()
  if (already) return true
  return navigator.storage.persist()
}
