// 후원 알림 띠 주기 — 저장값은 다음에 띄울 epoch ms 문자열 하나 (small 2026-10-11)
export const DAY_MS = 86_400_000
const FIRST_DELAY_MS = 7 * DAY_MS
const DISMISS_SNOOZE_MS = 30 * DAY_MS
const DONATE_SNOOZE_MS = 365 * DAY_MS

// write 가 null 이 아니면 그 값을 저장한다. 깨진 값·1년 넘는 미래(시계 되감김)는 처음처럼 7일 뒤로
export function decideDonatePrompt(raw: string, now: number): { due: boolean; write: number | null } {
  const at = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (!Number.isSafeInteger(at) || at > now + DONATE_SNOOZE_MS) return { due: false, write: now + FIRST_DELAY_MS }
  return { due: at <= now, write: null }
}

export function afterDismiss(now: number): number {
  return now + DISMISS_SNOOZE_MS
}

export function afterDonate(now: number): number {
  return now + DONATE_SNOOZE_MS
}
