// 설정 `연결된 앱` 탭 순수 함수 (specs/features/F-2148.md 2.3). DOM 을 쓰지 않는다
export type ConnectedApp = { id: string; name: string; host: string; createdAt: number; lastUsedAt: number | null }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY_RANGE = 30

function formatDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function localDayNumber(ts: number): number {
  const d = new Date(ts)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

export function formatLastUsed(at: number, now: number): string {
  const diff = now - at
  if (diff < MINUTE) return '방금 전'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}시간 전`
  const days = localDayNumber(now) - localDayNumber(at)
  if (days <= 1) return '어제'
  if (days < DAY_RANGE) return `${days}일 전`
  return formatDate(at)
}

export function connectedAppMeta(app: ConnectedApp, now: number): string {
  const connected = `${formatDate(app.createdAt)} 연결`
  return app.lastUsedAt === null ? `${connected} · 아직 사용 안 함` : `${connected} · 마지막 사용 ${formatLastUsed(app.lastUsedAt, now)}`
}

export function focusAfterRemove(ids: readonly string[], removedId: string): string | null {
  const idx = ids.indexOf(removedId)
  if (idx < 0) return ids[0] ?? null
  return ids[idx + 1] ?? ids[idx - 1] ?? null
}

export function isConnectedAppList(value: unknown): value is ConnectedApp[] {
  if (!Array.isArray(value)) return false
  return value.every((v) => {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    return (
      typeof o.id === 'string' &&
      typeof o.name === 'string' &&
      typeof o.host === 'string' &&
      typeof o.createdAt === 'number' &&
      (o.lastUsedAt === null || typeof o.lastUsedAt === 'number')
    )
  })
}
