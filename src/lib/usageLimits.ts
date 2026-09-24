// F-2030 3.5 — 알림 문구·시각·크기 표기·Retry-After 해석·계정 알림 판정 순수 함수. DOM 없음(src/storage 도 읽는다)
export const QUOTA_HOLD_MS = 30_000 // 413 받은 항목을 건너뛰는 시간 (4.3)
export const ACCOUNT_RECHECK_MS = 600_000 // 화면이 다시 보일 때 /api/me 를 다시 읽는 최소 간격 (5.1)

const MB = 1_048_576

// 헤더가 있으면 그 값, 없으면 몸통 값을 올림, 둘 다 아니면 60. 1~86,400 으로 자른다
export function parseRetryAfter(header: string | null, bodyValue: unknown): number {
  let seconds: number
  if (header !== null && /^\d+$/.test(header)) {
    seconds = Number(header)
  } else if (typeof bodyValue === 'number' && Number.isFinite(bodyValue) && bodyValue > 0) {
    seconds = Math.ceil(bodyValue)
  } else {
    seconds = 60
  }
  return Math.min(86_400, Math.max(1, seconds || 60))
}

// nowMs 보다 큰 가장 가까운 UTC 자정
export function nextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return midnight > nowMs ? midnight : midnight + 24 * 60 * 60 * 1000
}

export function formatResetTime(atMs: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(atMs))
}

// 1,048,576 바이트 = 1MB. 10MB 미만은 소수 1자리, 이상은 반올림 정수 (AccountMenu formatUsage 와 같은 규칙)
export function formatMegabytes(bytes: number): string {
  const mb = bytes / MB
  return mb < 10 ? `${mb.toFixed(1)}MB` : `${Math.round(mb)}MB`
}

export function formatCount(n: number): string {
  return n.toLocaleString('ko-KR')
}

function isPositiveInt(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

export const RATE_LIMITED_MINUTE_MESSAGE = '요청이 많아 잠시 쉬었다가 이어서 저장합니다.'

export function rateLimitedDayMessage(limit: number | undefined, resetAtMs: number, timeZone?: string): string {
  const time = formatResetTime(resetAtMs, timeZone)
  const limitPart = isPositiveInt(limit) ? `(하루 ${formatCount(limit)}번)` : ''
  return `오늘 저장 한도${limitPart}를 넘었습니다. ${time}부터 다시 저장됩니다. 그때까지 바뀐 내용은 이 브라우저에 보관됩니다.`
}

export function docQuotaMessage(resource: 'bytes' | 'docs', limit: number | undefined): string {
  if (resource === 'bytes') {
    const limitPart = isPositiveInt(limit) ? `(${formatMegabytes(limit)})` : ''
    return `계정의 문서 저장 공간${limitPart}이 가득 찼습니다. 문서를 지우거나 줄이면 다시 저장됩니다.`
  }
  if (isPositiveInt(limit)) {
    return `문서가 ${formatCount(limit)}개에 이르러 새 문서를 서버에 저장하지 못했습니다. 문서를 지우면 다시 저장됩니다.`
  }
  return '문서 수가 한도에 이르러 새 문서를 서버에 저장하지 못했습니다. 문서를 지우면 다시 저장됩니다.'
}

export const ACCOUNT_BLOCKED_MESSAGE = '이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.'
export const ACCOUNT_WARNED_MESSAGE =
  '운영자가 이 계정의 사용 방식에 주의를 보냈습니다. 이용약관 제7조(금지 행위)를 확인해 주세요. 계속되면 쓰기가 막힐 수 있습니다.'

export type AccountFlags = { blocked: boolean; warned: boolean }
export type AccountNoticePlan = { showBlocked: boolean; showWarned: boolean; dismissBlocked: boolean; dismissWarned: boolean }

// L5·L7 을 띄우고 걷는 규칙 (5.3 표) — prev 는 이 페이지 직전 값(부팅 전이면 null), next 는 새 /api/me 결과
export function planAccountNotices(prev: AccountFlags | null, next: AccountFlags, warnedShownThisPage: boolean): AccountNoticePlan {
  const prevBlocked = prev?.blocked ?? false
  if (next.blocked) {
    // 막힘이 새로 생겼을 때만 L5 를 띄운다. L7 은 L5 가 대신하므로 늘 걷는다(안 떠 있으면 no-op)
    return { showBlocked: !prevBlocked, showWarned: false, dismissBlocked: false, dismissWarned: true }
  }
  return {
    showBlocked: false,
    dismissBlocked: prevBlocked,
    showWarned: next.warned && !warnedShownThisPage,
    dismissWarned: !next.warned,
  }
}
