// 알림 띠 규칙 — 순수 함수 (specs/ia.md 4.2, specs/features/F-102.md 5.5, F-118.md 2장)
const PROTECTED_TYPES = new Set(['error', 'update', 'warn'])

/**
 * @param {{type:'info'|'error'|'update'|'warn'}|null} current
 * @param {{type:'info'|'error'|'update'|'warn'}} next
 * @returns 새 알림이 이전 알림을 대체한다. 단 현재가 error·update·warn 이면 info 는
 *   대체하지 못한다 (warn 은 error·update 로는 대체된다 — 기본 규칙 그대로)
 */
export function pushNotice(current, next) {
  if (current && PROTECTED_TYPES.has(current.type) && next.type === 'info') {
    return current
  }
  return next
}
