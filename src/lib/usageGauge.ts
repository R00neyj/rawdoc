// 계정 메뉴 사용량 게이지 — 비율·단계·문구, 80% 주의·90% 위험 (small 2026-10-11)
import { formatCount, formatMegabytes } from './usageLimits'

export type GaugeLevel = 'normal' | 'warn' | 'danger'
export type Gauge = { percent: number; level: GaugeLevel }
export type GaugeKey = 'images' | 'docBytes' | 'docCount'
export type GaugeRow = { key: GaugeKey; label: string; value: string; used: number; limit: number; gauge: Gauge; hint: string | null }

type UsageLike = {
  used: number
  limit: number
  docs?: { bytes: number; bytesLimit: number; count: number; countLimit: number }
}

const WARN_RATIO = 0.8
const DANGER_RATIO = 0.9
const HINT_IMAGES = '곧 저장할 수 없게 됩니다. 안 쓰는 이미지를 지워 주세요'
const HINT_DOCS = '곧 저장할 수 없게 됩니다. 안 쓰는 문서를 지워 주세요'

export function usageGauge(used: number, limit: number): Gauge | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null
  const ratio = Math.max(0, used) / limit
  const level: GaugeLevel = ratio >= DANGER_RATIO ? 'danger' : ratio >= WARN_RATIO ? 'warn' : 'normal'
  return { percent: Math.min(100, Math.round(ratio * 1000) / 10), level }
}

function row(key: GaugeKey, label: string, used: number, limit: number, value: string, hint: string): GaugeRow | null {
  const gauge = usageGauge(used, limit)
  if (!gauge) return null
  return { key, label, value, used, limit, gauge, hint: gauge.level === 'danger' ? hint : null }
}

// docs 는 네 값이 모두 맞을 때만 두 줄을 함께 그린다 (F-2030 7장)
export function usageGaugeRows(usage: UsageLike): GaugeRow[] {
  const rows: (GaugeRow | null)[] = [
    row('images', '이미지', usage.used, usage.limit, `${formatMegabytes(usage.used)} / ${formatMegabytes(usage.limit)}`, HINT_IMAGES),
  ]
  const d = usage.docs
  const docsValid =
    d != null && [d.bytes, d.bytesLimit, d.count, d.countLimit].every(Number.isFinite) && d.bytesLimit > 0 && d.countLimit > 0
  if (d && docsValid) {
    rows.push(row('docBytes', '문서 용량', d.bytes, d.bytesLimit, `${formatMegabytes(d.bytes)} / ${formatMegabytes(d.bytesLimit)}`, HINT_DOCS))
    rows.push(row('docCount', '문서 수', d.count, d.countLimit, `${formatCount(d.count)} / ${formatCount(d.countLimit)}개`, HINT_DOCS))
  }
  return rows.filter((r): r is GaugeRow => r !== null)
}
