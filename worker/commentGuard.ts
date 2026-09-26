// 사후 검사의 순수 판정 — 연결이 comments Y.Map 에 직접 쓴 것을 고친다 (specs/features/F-502.md 3장). yjs·D1 을 부르지 않는다
import {
  COMMENTS_PER_DOC_MAX,
  REPLIES_PER_THREAD_MAX,
  commentAllowed,
  groupCommentThreads,
  isCommentId,
  validateCommentEntry,
} from '../src/lib/docComments'
import type { CommentActor, CommentAuthor, CommentEntry } from '../src/lib/docComments'

export type CommentChange = { key: string; action: 'add' | 'update' | 'delete'; oldValue: unknown }
export type CommentFixActor = { userId: string; email: string; role: 'owner' | 'edit' | 'view' }
export type CommentFix = { op: 'set'; key: string; value: CommentEntry } | { op: 'delete'; key: string }

function validEntry(value: unknown): CommentEntry | null {
  const result = validateCommentEntry(value)
  return result.ok ? result.entry : null
}

function sameAuthor(a: CommentAuthor, actor: CommentFixActor): boolean {
  return a.id === actor.userId && a.email === actor.email
}

// resolved 밖 여덟 필드 — 검사를 통과한 값은 키 순서가 같아 JSON 으로 비교된다
function frozenPart(e: CommentEntry): string {
  return JSON.stringify([e.v, e.parent, e.anchor, e.quote, e.body, e.mentions, e.author, e.createdAt])
}

function byLatest(a: { id: string; entry: CommentEntry }, b: { id: string; entry: CommentEntry }): number {
  if (a.entry.createdAt !== b.entry.createdAt) return b.entry.createdAt - a.entry.createdAt
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

// 규칙 0 — 행위자를 모르면 그 트랜잭션의 댓글 변경을 모두 되돌린다
function revertAll(changes: readonly CommentChange[]): CommentFix[] {
  const fixes = new Map<string, CommentFix>()
  for (const change of changes) {
    if (change.action === 'add') {
      fixes.set(change.key, { op: 'delete', key: change.key })
      continue
    }
    const old = validEntry(change.oldValue)
    if (old) fixes.set(change.key, { op: 'set', key: change.key, value: old })
    else if (change.action === 'update') fixes.set(change.key, { op: 'delete', key: change.key })
  }
  return [...fixes.values()]
}

export function planCommentFixes(
  after: ReadonlyMap<string, unknown>,
  changes: readonly CommentChange[],
  actor: CommentFixActor | null,
): CommentFix[] {
  if (!actor) return revertAll(changes)

  const who: CommentActor = { kind: 'server', userId: actor.userId, role: actor.role, blocked: false }
  const stamp: CommentAuthor = { id: actor.userId, email: actor.email }
  const state = new Map(after)
  const fixes = new Map<string, CommentFix>()
  const added = new Set<string>()
  const fix = (f: CommentFix) => {
    fixes.set(f.key, f)
    if (f.op === 'set') state.set(f.key, f.value)
    else state.delete(f.key)
  }

  // 1 — 지우기. 첫 댓글을 먼저 판정해야 스레드 삭제가 딸린 답글을 허용한다
  const deletes = changes.filter((c) => c.action === 'delete').map((c) => ({ key: c.key, old: validEntry(c.oldValue) }))
  const allowedRoots = new Set<string>()
  for (const { key, old } of deletes) {
    if (!old || old.parent !== null) continue
    if (commentAllowed(who, 'delete', old)) allowedRoots.add(key)
    else fix({ op: 'set', key, value: old })
  }
  for (const { key, old } of deletes) {
    if (!old || old.parent === null) continue
    if (!commentAllowed(who, 'delete', old) && !allowedRoots.has(old.parent)) fix({ op: 'set', key, value: old })
  }

  // 2·3 — 바꾸기와 더하기
  for (const change of changes) {
    if (change.action === 'delete') continue
    const old = change.action === 'update' ? validEntry(change.oldValue) : null
    const next = validEntry(after.get(change.key))
    if (old) {
      if (!next || old.parent !== null || frozenPart(next) !== frozenPart(old) || !commentAllowed(who, 'resolve')) {
        fix({ op: 'set', key: change.key, value: old })
      }
      else if (next.resolved && !sameAuthor(next.resolved.by, actor)) {
        fix({ op: 'set', key: change.key, value: { ...next, resolved: { by: stamp, at: next.resolved.at } } })
      }
      continue
    }
    added.add(change.key)
    if (!isCommentId(change.key) || !next) {
      fix({ op: 'delete', key: change.key })
      continue
    }
    const foreign = !sameAuthor(next.author, actor) || (next.resolved !== null && !sameAuthor(next.resolved.by, actor))
    if (foreign) {
      fix({ op: 'set', key: change.key, value: { ...next, author: stamp, resolved: next.resolved ? { by: stamp, at: next.resolved.at } : null } })
    }
  }

  // 4 — 부모 잃은 답글·답글의 답글·모양 틀린 값
  const grouped = groupCommentThreads(state.entries())
  for (const key of [...grouped.invalid, ...grouped.strays]) fix({ op: 'delete', key })

  // 5 — 한도. 이번에 더한 것만, 늦은 것부터
  let total = 0
  for (const thread of grouped.threads) {
    let over = thread.replies.length - REPLIES_PER_THREAD_MAX
    if (over > 0) {
      const newest = thread.replies.filter((r) => added.has(r.id)).sort(byLatest)
      for (const r of newest) {
        if (over <= 0) break
        fix({ op: 'delete', key: r.id })
        over--
      }
    }
    total += 1 + thread.replies.filter((r) => state.has(r.id)).length
  }
  let over = total - COMMENTS_PER_DOC_MAX
  if (over > 0) {
    const candidates: { id: string; entry: CommentEntry; replies: string[] }[] = []
    for (const thread of grouped.threads) {
      if (added.has(thread.id)) candidates.push({ id: thread.id, entry: thread.root, replies: thread.replies.map((r) => r.id) })
      for (const r of thread.replies) if (added.has(r.id) && state.has(r.id)) candidates.push({ id: r.id, entry: r.entry, replies: [] })
    }
    candidates.sort(byLatest)
    for (const c of candidates) {
      if (over <= 0) break
      if (!state.has(c.id)) continue
      fix({ op: 'delete', key: c.id })
      over--
      // 지운 첫 댓글의 답글은 부모를 잃는다 — 함께 지우고 센다
      for (const id of c.replies) {
        if (!state.has(id)) continue
        fix({ op: 'delete', key: id })
        over--
      }
    }
  }

  return [...fixes.values()]
}
