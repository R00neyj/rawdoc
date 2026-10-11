import { describe, it, expect } from 'vitest'
import { afterDismiss, afterDonate, decideDonatePrompt, DAY_MS } from '../../../src/lib/donatePrompt'

const NOW = 1_800_000_000_000

describe('decideDonatePrompt', () => {
  it('처음 보는 기기 — 지금은 안 띄우고 7일 뒤로 잡는다', () => {
    expect(decideDonatePrompt('', NOW)).toEqual({ due: false, write: NOW + 7 * DAY_MS })
  })

  it('예정 시각이 지났거나 지금이면 띄운다, 저장은 그대로', () => {
    expect(decideDonatePrompt(String(NOW), NOW)).toEqual({ due: true, write: null })
    expect(decideDonatePrompt(String(NOW - 1), NOW)).toEqual({ due: true, write: null })
  })

  it('아직 이르면 아무것도 안 한다', () => {
    expect(decideDonatePrompt(String(NOW + 1), NOW)).toEqual({ due: false, write: null })
    expect(decideDonatePrompt(String(NOW + 365 * DAY_MS), NOW)).toEqual({ due: false, write: null })
  })

  it('1년 넘게 미래(시계가 뒤로 감)면 새로 7일 뒤로 잡는다', () => {
    expect(decideDonatePrompt(String(NOW + 365 * DAY_MS + 1), NOW)).toEqual({ due: false, write: NOW + 7 * DAY_MS })
  })

  it('깨진 값은 새로 7일 뒤로 잡는다', () => {
    for (const raw of ['abc', '-5', '1.5', '12abc', ' ', 'NaN', '1e20']) {
      expect(decideDonatePrompt(raw, NOW), raw).toEqual({ due: false, write: NOW + 7 * DAY_MS })
    }
  })
})

describe('닫기·후원 뒤 다음 시각', () => {
  it('닫기는 30일, 후원하기는 365일 뒤', () => {
    expect(afterDismiss(NOW)).toBe(NOW + 30 * DAY_MS)
    expect(afterDonate(NOW)).toBe(NOW + 365 * DAY_MS)
  })
})
