// F-2030 3.5 — 알림 문구·시각·크기 표기·Retry-After 해석·계정 알림 판정 순수 함수 (U15~U19)
import { describe, it, expect } from 'vitest'
import {
  QUOTA_HOLD_MS,
  ACCOUNT_RECHECK_MS,
  parseRetryAfter,
  nextUtcMidnight,
  formatResetTime,
  formatMegabytes,
  formatCount,
  RATE_LIMITED_MINUTE_MESSAGE,
  rateLimitedDayMessage,
  docQuotaMessage,
  ACCOUNT_BLOCKED_MESSAGE,
  ACCOUNT_WARNED_MESSAGE,
  planAccountNotices,
} from './usageLimits'

describe('상수', () => {
  it('QUOTA_HOLD_MS 는 30초, ACCOUNT_RECHECK_MS 는 10분', () => {
    expect(QUOTA_HOLD_MS).toBe(30_000)
    expect(ACCOUNT_RECHECK_MS).toBe(600_000)
  })
})

describe('parseRetryAfter (U15)', () => {
  it('헤더가 양의 정수 문자열이면 그 값', () => {
    expect(parseRetryAfter('120', null)).toBe(120)
  })
  it('헤더가 없으면 몸통 값을 올림', () => {
    expect(parseRetryAfter(null, 7.2)).toBe(8)
  })
  it('헤더가 숫자가 아니고 몸통도 없으면 60', () => {
    expect(parseRetryAfter('abc', null)).toBe(60)
  })
  it('헤더·몸통 둘 다 없으면 60', () => {
    expect(parseRetryAfter(null, null)).toBe(60)
  })
  it('0 이하이면 1 로 자른다(헤더 "0")', () => {
    expect(parseRetryAfter('0', null)).toBe(60)
  })
  it('86,400 을 넘으면 86,400 으로 자른다', () => {
    expect(parseRetryAfter('999999', null)).toBe(86400)
  })
})

describe('nextUtcMidnight (U16)', () => {
  it('그날 안이면 다음 UTC 자정, 정확히 자정이면 다음 날 자정', () => {
    expect(nextUtcMidnight(Date.UTC(2026, 8, 24, 3, 0))).toBe(Date.UTC(2026, 8, 25, 0, 0))
    expect(nextUtcMidnight(Date.UTC(2026, 8, 24, 0, 0))).toBe(Date.UTC(2026, 8, 25, 0, 0))
  })
})

describe('formatResetTime (U17)', () => {
  it('타임존별 오전·오후 표기', () => {
    expect(formatResetTime(Date.UTC(2026, 8, 25), 'Asia/Seoul')).toBe('오전 9:00')
    expect(formatResetTime(Date.UTC(2026, 8, 25), 'America/New_York')).toBe('오후 8:00')
  })
})

describe('formatMegabytes', () => {
  it('10MB 미만은 소수 1자리, 이상은 반올림 정수', () => {
    expect(formatMegabytes(5_242_880)).toBe('5.0MB')
    expect(formatMegabytes(10_485_760)).toBe('10MB')
    expect(formatMegabytes(104_857_600)).toBe('100MB')
  })
})

describe('formatCount', () => {
  it('천 단위 콤마', () => {
    expect(formatCount(5000)).toBe('5,000')
    expect(formatCount(10000)).toBe('10,000')
  })
})

describe('문구 함수 (U18)', () => {
  it('L1 상수', () => {
    expect(RATE_LIMITED_MINUTE_MESSAGE).toBe('요청이 많아 잠시 쉬었다가 이어서 저장합니다.')
  })

  it('L2 rateLimitedDayMessage', () => {
    expect(rateLimitedDayMessage(5000, Date.UTC(2026, 8, 25), 'Asia/Seoul')).toBe(
      '오늘 저장 한도(하루 5,000번)를 넘었습니다. 오전 9:00부터 다시 저장됩니다. 그때까지 바뀐 내용은 이 브라우저에 보관됩니다.',
    )
  })

  it('L2 대체 — limit 이 양의 정수가 아니면 괄호를 뺀다', () => {
    expect(rateLimitedDayMessage(undefined, Date.UTC(2026, 8, 25), 'Asia/Seoul')).toBe(
      '오늘 저장 한도를 넘었습니다. 오전 9:00부터 다시 저장됩니다. 그때까지 바뀐 내용은 이 브라우저에 보관됩니다.',
    )
    expect(rateLimitedDayMessage(-1, Date.UTC(2026, 8, 25), 'Asia/Seoul')).toBe(
      '오늘 저장 한도를 넘었습니다. 오전 9:00부터 다시 저장됩니다. 그때까지 바뀐 내용은 이 브라우저에 보관됩니다.',
    )
  })

  it('L3 docQuotaMessage bytes', () => {
    expect(docQuotaMessage('bytes', 104857600)).toBe(
      '계정의 문서 저장 공간(100MB)이 가득 찼습니다. 문서를 지우거나 줄이면 다시 저장됩니다.',
    )
  })

  it('L3 대체', () => {
    expect(docQuotaMessage('bytes', undefined)).toBe(
      '계정의 문서 저장 공간이 가득 찼습니다. 문서를 지우거나 줄이면 다시 저장됩니다.',
    )
  })

  it('L4 docQuotaMessage docs', () => {
    expect(docQuotaMessage('docs', 10000)).toBe(
      '문서가 10,000개에 이르러 새 문서를 서버에 저장하지 못했습니다. 문서를 지우면 다시 저장됩니다.',
    )
  })

  it('L4 대체', () => {
    expect(docQuotaMessage('docs', 0)).toBe(
      '문서 수가 한도에 이르러 새 문서를 서버에 저장하지 못했습니다. 문서를 지우면 다시 저장됩니다.',
    )
  })

  it('L5·L7 상수', () => {
    expect(ACCOUNT_BLOCKED_MESSAGE).toBe('이 계정은 운영자가 쓰기를 막았습니다. 문서 읽기와 내보내기만 할 수 있습니다.')
    expect(ACCOUNT_WARNED_MESSAGE).toBe(
      '운영자가 이 계정의 사용 방식에 주의를 보냈습니다. 이용약관 제7조(금지 행위)를 확인해 주세요. 계속되면 쓰기가 막힐 수 있습니다.',
    )
  })
})

describe('planAccountNotices (U19, 5.3 표)', () => {
  it('막힘이 처음(prev null) → showBlocked', () => {
    expect(planAccountNotices(null, { blocked: true, warned: false }, false)).toEqual({
      showBlocked: true,
      showWarned: false,
      dismissBlocked: false,
      dismissWarned: true,
    })
  })

  it('막힘이 계속(prev.blocked 도 참) → 아무 동작 없음(dismissWarned 는 안전한 no-op)', () => {
    expect(planAccountNotices({ blocked: true, warned: false }, { blocked: true, warned: false }, false)).toEqual({
      showBlocked: false,
      showWarned: false,
      dismissBlocked: false,
      dismissWarned: true,
    })
  })

  it('막힘이 풀림(prev.blocked 참 → next.blocked 거짓) → dismissBlocked', () => {
    const plan = planAccountNotices({ blocked: true, warned: false }, { blocked: false, warned: false }, false)
    expect(plan.dismissBlocked).toBe(true)
    expect(plan.showBlocked).toBe(false)
  })

  it('경고, 이 페이지에서 아직 안 띄움 → showWarned', () => {
    const plan = planAccountNotices(null, { blocked: false, warned: true }, false)
    expect(plan.showWarned).toBe(true)
    expect(plan.dismissWarned).toBe(false)
  })

  it('경고가 거짓이면 dismissWarned', () => {
    const plan = planAccountNotices(null, { blocked: false, warned: false }, true)
    expect(plan.dismissWarned).toBe(true)
    expect(plan.showWarned).toBe(false)
  })

  it('막힘이 참이고 경고도 참이면 L5 만(dismissWarned 로 L7 을 걷는다)', () => {
    const plan = planAccountNotices(null, { blocked: true, warned: true }, false)
    expect(plan.showBlocked).toBe(true)
    expect(plan.showWarned).toBe(false)
    expect(plan.dismissWarned).toBe(true)
  })
})
