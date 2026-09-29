// 문서 방 알람의 댓글 푸시 모아 보내기 — 모으기·빼기·예산·보내기·결과 batch, "열어 둠" (specs/features/F-3006.md 4·5장)
import { PUSH_PRESENCE_FRESH_MS, PUSH_SENDS_PER_RUN_MAX, PUSH_STALE_MS } from '../src/lib/pushPayload'
import { commentPushPayload } from '../src/lib/pushText'
import type { PushCommentRow } from '../src/lib/pushText'
import type { NotificationKind } from '../src/lib/docComments'
import { listLivePushSubscriptions, pushResultStatements } from './pushServer'
import type { LivePushSubscription } from './pushServer'
import { pushTopic, sendPush } from './webPush'
import type { PushOutcome, VapidAuth } from './webPush'

export const PUSH_READ_ROWS_MAX = 200
export const PUSH_FOLLOWUP_MS = 1_000
export const PUSH_RETRY_MS = 600_000
export const PUSH_SEND_CONCURRENCY = 6

export type PresenceConn = { email: string; connectedAt: number | null; lastPing: number | null }

export type PendingPushRow = {
  id: string
  recipient_email: string
  kind: NotificationKind
  thread_id: string
  actor_email: string
  doc_title: string
  excerpt: string
  created_at: number
  read_at: number | null
  push_due_at: number
}
export type PushRecipient = { email: string; rows: PendingPushRow[]; ids: string[] }
export type PushSend = { recipient: PushRecipient; subs: LivePushSubscription[] }

export type DocPushInput = {
  db: D1Database
  docId: string
  now: number
  auth: VapidAuth
  present: ReadonlySet<string>
  fetchImpl?: typeof fetch
}
export type DocPushResult = { type: 'done'; next: number | null; followUp: boolean } | { type: 'failed' }

const COLLECT_SQL =
  'SELECT n.id, n.recipient_email, n.kind, n.thread_id, n.actor_email, n.doc_title, n.excerpt, n.created_at, n.read_at, n.push_due_at ' +
  'FROM notifications n WHERE n.doc_id = ?1 AND n.push_due_at > ?2 ' +
  'AND EXISTS (SELECT 1 FROM docs d WHERE d.id = ?1 AND d.e2ee_key IS NULL) ' +
  `ORDER BY n.push_due_at, n.id LIMIT ${PUSH_READ_ROWS_MAX}`
const CLEAR_IDS_SQL = 'UPDATE notifications SET push_due_at = NULL WHERE id IN (SELECT value FROM json_each(?1))'
const CLEAR_STALE_SQL = 'UPDATE notifications SET push_due_at = NULL WHERE doc_id = ?1 AND push_due_at <= ?2'

// 소문자 이메일 — 연결 시각과 마지막 ping 중 늦은 쪽이 90초 안이면 (5장)
export function presentEmails(conns: Iterable<PresenceConn>, now: number): Set<string> {
  const out = new Set<string>()
  for (const c of conns) {
    if (!c.email) continue
    const seen = Math.max(c.connectedAt ?? -Infinity, c.lastPing ?? -Infinity)
    if (seen >= now - PUSH_PRESENCE_FRESH_MS) out.add(c.email.toLowerCase())
  }
  return out
}

// 4.3 표 — 열어 둠·읽음·남은 행 0 은 빼는 행, 나머지는 이메일 오름차순 받는 사람
export function splitRecipients(rows: readonly PendingPushRow[], present: ReadonlySet<string>): { skipped: string[]; recipients: PushRecipient[] } {
  const byEmail = new Map<string, PendingPushRow[]>()
  for (const row of rows) {
    const list = byEmail.get(row.recipient_email)
    if (list) list.push(row)
    else byEmail.set(row.recipient_email, [row])
  }
  const skipped: string[] = []
  const recipients: PushRecipient[] = []
  for (const email of [...byEmail.keys()].sort()) {
    const all = byEmail.get(email)!
    const unread = present.has(email) ? [] : all.filter((r) => r.read_at === null)
    if (unread.length === 0) skipped.push(...all.map((r) => r.id))
    else recipients.push({ email, rows: unread, ids: all.map((r) => r.id) })
  }
  return { skipped, recipients }
}

// 사람 단위로 max 대까지. 넘는 사람부터는 건드리지 않는다. 첫 사람은 늘 들어간다 (4.3)
export function packSends(
  recipients: readonly PushRecipient[],
  subs: readonly LivePushSubscription[],
  max: number,
): { sends: PushSend[]; handled: string[]; deferred: boolean } {
  const byEmail = new Map<string, LivePushSubscription[]>()
  for (const sub of subs) {
    const key = sub.email.toLowerCase()
    const list = byEmail.get(key)
    if (list) list.push(sub)
    else byEmail.set(key, [sub])
  }
  const sends: PushSend[] = []
  const handled: string[] = []
  let count = 0
  for (const recipient of recipients) {
    const mine = byEmail.get(recipient.email) ?? []
    if (mine.length > 0 && sends.length > 0 && count + mine.length > max) return { sends, handled, deferred: true }
    handled.push(...recipient.ids)
    if (mine.length === 0) continue
    sends.push({ recipient, subs: mine })
    count += mine.length
  }
  return { sends, handled, deferred: false }
}

function toPushRow(row: PendingPushRow): PushCommentRow {
  return { kind: row.kind, actorEmail: row.actor_email, docTitle: row.doc_title, excerpt: row.excerpt, threadId: row.thread_id, createdAt: row.created_at }
}

async function eachLimited<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// D1 이 던지면 failed — 재시도 판단은 부르는 쪽 (6장). 푸시 서비스 실패는 그 기기만 건너뛴다
export async function runDocPush(input: DocPushInput): Promise<DocPushResult> {
  const { db, docId, now, auth, present, fetchImpl } = input
  const staleBefore = now - PUSH_STALE_MS
  try {
    const rows = (await db.prepare(COLLECT_SQL).bind(docId, staleBefore).all<PendingPushRow>()).results
    if (rows.length === 0) return { type: 'done', next: null, followUp: false }
    if (rows[0].push_due_at > now) return { type: 'done', next: rows[0].push_due_at, followUp: false }

    const { skipped, recipients } = splitRecipients(rows, present)
    const subs = recipients.length > 0 ? await listLivePushSubscriptions(db, recipients.map((r) => r.email), now) : []
    const { sends, handled, deferred } = packSends(recipients, subs, PUSH_SENDS_PER_RUN_MAX)

    const topic = pushTopic(docId) ?? undefined
    const jobs = sends.flatMap(({ recipient, subs: mine }) => {
      const payload = commentPushPayload(docId, recipient.rows.map(toPushRow))
      return mine.map((sub) => ({ sub, payload }))
    })
    const outcomes: { sub: LivePushSubscription; outcome: PushOutcome }[] = []
    await eachLimited(jobs, PUSH_SEND_CONCURRENCY, async ({ sub, payload }) => {
      const { outcome } = await sendPush(sub, payload, auth, now, topic, fetchImpl)
      outcomes.push({ sub, outcome })
    })

    await db.batch([
      db.prepare(CLEAR_IDS_SQL).bind(JSON.stringify([...skipped, ...handled])),
      db.prepare(CLEAR_STALE_SQL).bind(docId, staleBefore),
      ...outcomes.flatMap(({ sub, outcome }) => pushResultStatements(db, sub, outcome, now)),
    ])
    return { type: 'done', next: null, followUp: deferred || rows.length >= PUSH_READ_ROWS_MAX }
  } catch (err) {
    console.warn(`docRoom: push run failed (${docId})`, err)
    return { type: 'failed' }
  }
}
