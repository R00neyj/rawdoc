import { describe, it, expect } from 'vitest'
import { usageGauge, usageGaugeRows } from '../../../src/lib/usageGauge'

const MB = 1_048_576

describe('usageGauge 단계·비율', () => {
  it('79.9% 보통, 80% 주의, 89.9% 주의, 90% 위험', () => {
    expect(usageGauge(799, 1000)).toEqual({ percent: 79.9, level: 'normal' })
    expect(usageGauge(800, 1000)).toEqual({ percent: 80, level: 'warn' })
    expect(usageGauge(899, 1000)).toEqual({ percent: 89.9, level: 'warn' })
    expect(usageGauge(900, 1000)).toEqual({ percent: 90, level: 'danger' })
  })

  it('한도를 넘으면 막대는 100% 에서 멈추고 위험', () => {
    expect(usageGauge(1500, 1000)).toEqual({ percent: 100, level: 'danger' })
  })

  it('음수 사용량은 0', () => {
    expect(usageGauge(-5, 1000)).toEqual({ percent: 0, level: 'normal' })
  })

  it('한도 0·음수·숫자 아님, 사용량 숫자 아님이면 null', () => {
    expect(usageGauge(10, 0)).toBeNull()
    expect(usageGauge(10, -1)).toBeNull()
    expect(usageGauge(10, Number.NaN)).toBeNull()
    expect(usageGauge(Number.NaN, 100)).toBeNull()
    expect(usageGauge(10, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('usageGaugeRows', () => {
  it('이미지·문서 용량·문서 수 세 줄, 한도는 서버 값 그대로', () => {
    const rows = usageGaugeRows({
      used: 12 * MB,
      limit: 300 * MB,
      docs: { bytes: 3.2 * MB, bytesLimit: 100 * MB, count: 120, countLimit: 10_000 },
    })
    expect(rows.map((r) => [r.key, r.label, r.value])).toEqual([
      ['images', '이미지', '12MB / 300MB'],
      ['docBytes', '문서 용량', '3.2MB / 100MB'],
      ['docCount', '문서 수', '120 / 10,000개'],
    ])
    expect(rows.every((r) => r.hint === null)).toBe(true)
  })

  it('이미지 한도가 300MB 가 아니면 그 값을 쓴다', () => {
    const [row] = usageGaugeRows({ used: 0, limit: 500 * MB })
    expect(row.value).toBe('0.0MB / 500MB')
  })

  it('90% 이상인 줄만 안내 한 줄 — 이미지·문서 문구가 다르다', () => {
    const rows = usageGaugeRows({
      used: 280 * MB,
      limit: 300 * MB,
      docs: { bytes: 84 * MB, bytesLimit: 100 * MB, count: 9_500, countLimit: 10_000 },
    })
    expect(rows.map((r) => [r.key, r.gauge.level, r.hint])).toEqual([
      ['images', 'danger', '곧 저장할 수 없게 됩니다. 안 쓰는 이미지를 지워 주세요'],
      ['docBytes', 'warn', null],
      ['docCount', 'danger', '곧 저장할 수 없게 됩니다. 안 쓰는 문서를 지워 주세요'],
    ])
  })

  it('docs 가 없거나 한 값이라도 틀리면 문서 두 줄을 모두 숨긴다', () => {
    expect(usageGaugeRows({ used: 0, limit: 300 * MB }).map((r) => r.key)).toEqual(['images'])
    const bad = { bytes: 1, bytesLimit: 100, count: 1, countLimit: 0 }
    expect(usageGaugeRows({ used: 0, limit: 300 * MB, docs: bad }).map((r) => r.key)).toEqual(['images'])
    const nan = { bytes: Number.NaN, bytesLimit: 100, count: 1, countLimit: 10 }
    expect(usageGaugeRows({ used: 0, limit: 300 * MB, docs: nan }).map((r) => r.key)).toEqual(['images'])
  })

  it('이미지 한도가 틀리면 이미지 줄만 숨긴다', () => {
    const rows = usageGaugeRows({ used: 0, limit: 0, docs: { bytes: 1, bytesLimit: 100, count: 1, countLimit: 10 } })
    expect(rows.map((r) => r.key)).toEqual(['docBytes', 'docCount'])
  })
})
