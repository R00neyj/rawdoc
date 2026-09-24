// 사용량 열·한도 상수·사용량 줄 SQL·사용량 읽기 (specs/features/F-2024.md 2.3, F-2025.md 4장·5장)
export const DAILY_WRITE_LIMIT = 5_000
export const DOC_BYTES_QUOTA = 104_857_600 // 100MiB
export const DOC_COUNT_QUOTA = 10_000

export interface UserUsage {
  writeDay: string | null
  writeCount: number
  contentBytes: number
  docCount: number
  blockedAt: number | null
  warnedAt: number | null
}

export const EMPTY_USAGE: UserUsage = {
  writeDay: null,
  writeCount: 0,
  contentBytes: 0,
  docCount: 0,
  blockedAt: null,
  warnedAt: null,
}

export type UsageRow = {
  write_day: string | null
  write_count: number
  content_bytes: number
  doc_count: number
  blocked_at: number | null
  warned_at: number | null
}

export type DocQuotaBody = { error: 'doc_quota_exceeded'; resource: 'bytes' | 'docs'; used: number; limit: number }

export const USAGE_COLUMNS = 'write_day, write_count, content_bytes, doc_count, blocked_at, warned_at'

// 순수 함수

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function secondsUntilUtcMidnight(now: number): number {
  const nextMidnight = Date.parse(`${utcDay(now)}T00:00:00.000Z`) + 24 * 60 * 60 * 1000
  return Math.ceil((nextMidnight - now) / 1000)
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

export function rowToUsage(row: UsageRow): UserUsage {
  return {
    writeDay: row.write_day,
    writeCount: row.write_count,
    contentBytes: row.content_bytes,
    docCount: row.doc_count,
    blockedAt: row.blocked_at,
    warnedAt: row.warned_at,
  }
}

export function writesToday(usage: UserUsage, now: number): number {
  return usage.writeDay === utcDay(now) ? usage.writeCount : 0
}

export function isDailyLimitReached(usage: UserUsage, now: number): boolean {
  return writesToday(usage, now) >= DAILY_WRITE_LIMIT
}

export function checkDocCreate(usage: UserUsage, contentBytes: number): DocQuotaBody | null {
  if (usage.docCount >= DOC_COUNT_QUOTA) {
    return { error: 'doc_quota_exceeded', resource: 'docs', used: usage.docCount, limit: DOC_COUNT_QUOTA }
  }
  if (usage.contentBytes + contentBytes > DOC_BYTES_QUOTA) {
    return { error: 'doc_quota_exceeded', resource: 'bytes', used: usage.contentBytes, limit: DOC_BYTES_QUOTA }
  }
  return null
}

export function checkDocGrow(usage: UserUsage, deltaBytes: number): DocQuotaBody | null {
  if (deltaBytes <= 0) return null
  if (usage.contentBytes + deltaBytes > DOC_BYTES_QUOTA) {
    return { error: 'doc_quota_exceeded', resource: 'bytes', used: usage.contentBytes, limit: DOC_BYTES_QUOTA }
  }
  return null
}

// D1 문장 — 5.1 표와 글자까지 같다. 상수 이름은 재량, 문장 텍스트는 계약
const DAY_ONLY_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1 WHERE id = ?2'
const DAY_AND_TOTAL_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, content_bytes = content_bytes + CASE WHEN changes() = 1 THEN ?2 ELSE 0 END, doc_count = doc_count + CASE WHEN changes() = 1 THEN ?3 ELSE 0 END WHERE id = ?4'
const TOTAL_ONLY_SQL =
  'UPDATE users SET content_bytes = content_bytes + CASE WHEN changes() = 1 THEN ?1 ELSE 0 END, doc_count = doc_count + CASE WHEN changes() = 1 THEN ?2 ELSE 0 END WHERE id = ?3'
const DELETE_DOC_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, (content_bytes, doc_count) = (SELECT users.content_bytes - COALESCE(SUM(length(CAST(content AS BLOB))), 0), users.doc_count - COUNT(*) FROM docs WHERE id = ?2 AND owner_id = ?3) WHERE id = ?3'
const DELETE_FOLDERS_SQL =
  'UPDATE users SET write_count = CASE WHEN write_day = ?1 THEN write_count + 1 ELSE 1 END, write_day = ?1, (content_bytes, doc_count) = (SELECT users.content_bytes - COALESCE(SUM(length(CAST(content AS BLOB))), 0), users.doc_count - COUNT(*) FROM docs WHERE owner_id = ?2 AND folder_id IN (SELECT value FROM json_each(?3))) WHERE id = ?2'
const READ_USAGE_SQL = `SELECT ${USAGE_COLUMNS} FROM users WHERE id = ?`
// F-2027 4.1 — 하루 + 누계 문장 그대로에 RETURNING 만
const SNAPSHOT_USAGE_SQL = `${DAY_AND_TOTAL_SQL} RETURNING ${USAGE_COLUMNS}`

// D1 문장 만들기 — prepare·bind 만 하고 실행하지 않는다

export function dayUsageStatement(db: D1Database, actorId: string, now: number): D1PreparedStatement {
  return db.prepare(DAY_ONLY_SQL).bind(utcDay(now), actorId)
}

export function docUsageStatements(
  db: D1Database,
  p: { actorId: string; ownerId: string; now: number; deltaBytes: number; deltaDocs: number },
): D1PreparedStatement[] {
  const day = utcDay(p.now)
  if (p.actorId === p.ownerId) {
    return [db.prepare(DAY_AND_TOTAL_SQL).bind(day, p.deltaBytes, p.deltaDocs, p.ownerId)]
  }
  return [
    db.prepare(TOTAL_ONLY_SQL).bind(p.deltaBytes, p.deltaDocs, p.ownerId),
    db.prepare(DAY_ONLY_SQL).bind(day, p.actorId),
  ]
}

// 스냅숏 한 번 = 소유자 하루 +1, 누계 += deltaBytes (앞 문장이 1행을 바꿨을 때만). 문서 수는 바꾸지 않는다
export function snapshotUsageStatement(db: D1Database, ownerId: string, now: number, deltaBytes: number): D1PreparedStatement {
  return db.prepare(SNAPSHOT_USAGE_SQL).bind(utcDay(now), deltaBytes, 0, ownerId)
}

export function deleteDocUsageStatement(db: D1Database, ownerId: string, docId: string, now: number): D1PreparedStatement {
  return db.prepare(DELETE_DOC_SQL).bind(utcDay(now), docId, ownerId)
}

export function deleteFoldersUsageStatement(
  db: D1Database,
  ownerId: string,
  folderIds: string[],
  now: number,
): D1PreparedStatement {
  return db.prepare(DELETE_FOLDERS_SQL).bind(utcDay(now), ownerId, JSON.stringify(folderIds))
}

// D1 읽기

export async function readUsage(env: Env, userId: string): Promise<UserUsage> {
  const row = await env.DB.prepare(READ_USAGE_SQL).bind(userId).first<UsageRow>()
  return row ? rowToUsage(row) : EMPTY_USAGE
}

export async function usageOf(env: Env, user: { id: string; usage?: UserUsage }): Promise<UserUsage> {
  if (user.usage) return user.usage
  return readUsage(env, user.id)
}
