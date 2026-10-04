// F-3014 A16 달 계산 — UTC 기준 (specs/features/F-3014.md 6장)
import { describe, expect, it } from 'vitest'
import { githubMonth, githubQuotaResetAt } from '../../../src/lib/githubContract'

describe('F-3014 A16 githubMonth·githubQuotaResetAt', () => {
  it('달은 UTC — 10월 31일 23:59 UTC 는 10월', () => {
    expect(githubMonth(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10')
    expect(githubMonth(Date.UTC(2026, 10, 1, 0, 0))).toBe('2026-11')
    expect(githubMonth(Date.UTC(2026, 0, 1))).toBe('2026-01')
  })

  it('다음 달 1일 00:00 UTC, 12월은 다음 해 1월', () => {
    expect(githubQuotaResetAt(Date.UTC(2026, 9, 31, 23, 59))).toBe(Date.UTC(2026, 10, 1))
    expect(githubQuotaResetAt(Date.UTC(2026, 11, 15, 12))).toBe(Date.UTC(2027, 0, 1))
    expect(githubQuotaResetAt(Date.UTC(2026, 11, 1))).toBe(Date.UTC(2027, 0, 1))
  })
})
