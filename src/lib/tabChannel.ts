// 탭 사이 채널 이름·대기 시간 상수·탭 id 생성 — F-296 6.1 에서 옮겨 옴 (specs/features/F-297.md 5.1). 순수 — BroadcastChannel 을 만들지 않는다
export const TAB_CHANNEL_NAME = 'md-tabs' // 저장소 식별자에 제품명을 쓰지 않는다 (CLAUDE.md 불변조건)
export const CLAIM_WAIT_MS = 150

export function newTabId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}
