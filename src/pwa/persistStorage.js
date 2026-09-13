// 저장소 영속화 요청 (specs/features/F-118.md, specs/architecture.md 4장)
/**
 * 저장소가 이미 허락돼 있으면 그대로, 아니면 navigator.storage.persist() 를 요청한다
 * @returns {Promise<boolean|null>} 허락 여부. API 가 없으면 null
 */
export async function ensurePersist() {
  if (!navigator.storage?.persist) return null
  const already = await navigator.storage.persisted?.()
  if (already) return true
  return navigator.storage.persist()
}
