// 멘션 후보 — 토큰 찾기·거르기·고르기·한도·후보 캐시 (specs/features/F-507.md 3.2). React·DOM 없음
import { finalizeMentions, MENTIONS_PER_COMMENT_MAX } from '../lib/docComments'

export const MENTION_CANDIDATES_MAX = 8 // F-500 4.9
export const MENTION_QUERY_MAX = 254 // COMMENT_EMAIL_MAX 와 같은 값
export const MENTION_PEOPLE_TTL_MS = 300_000

export type MentionPerson = { email: string; role: 'owner' | 'edit' | 'view' }
export type MentionToken = { start: number; end: number; query: string }

// parseMentions 의 앞 글자 규칙(MENTION_BEFORE_BAD)과 같은 판정 — `@` 도 이 글자 집합에 든다
const MENTION_TOKEN_CHAR = /[A-Za-z0-9._%+\-@]/

export function mentionTokenAt(text: string, caret: number): MentionToken | null {
  let start = caret
  while (start > 0 && MENTION_TOKEN_CHAR.test(text[start - 1])) start--
  if (start === caret || text[start] !== '@') return null
  const query = text.slice(start + 1, caret)
  if (query.length > MENTION_QUERY_MAX) return null
  let end = caret
  while (end < text.length && MENTION_TOKEN_CHAR.test(text[end])) end++
  return { start, end, query }
}

export function filterMentionCandidates(people: readonly MentionPerson[], query: string, selfEmail: string): MentionPerson[] {
  const self = selfEmail.toLowerCase()
  const q = query.toLowerCase()
  const others = people.filter((p) => p.email.toLowerCase() !== self)
  const matched = q === '' ? others : others.filter((p) => p.email.toLowerCase().includes(q))
  const startsWithQuery: MentionPerson[] = []
  const rest: MentionPerson[] = []
  for (const p of matched) {
    if (p.email.toLowerCase().startsWith(q)) startsWithQuery.push(p)
    else rest.push(p)
  }
  return [...startsWithQuery, ...rest].slice(0, MENTION_CANDIDATES_MAX)
}

export function applyMentionPick(text: string, token: MentionToken, email: string): { text: string; caret: number } {
  const replacement = `@${email}`
  const before = text.slice(0, token.start) + replacement
  const after = text.slice(token.end)
  const caretAfterEmail = before.length
  const nextChar = after[0]
  if (nextChar !== undefined && /\s/.test(nextChar)) {
    return { text: before + after, caret: caretAfterEmail + 1 }
  }
  return { text: before + ' ' + after, caret: caretAfterEmail + 1 }
}

export function mentionLimitReached(body: string, picked: readonly string[]): boolean {
  return finalizeMentions(body, picked).length >= MENTIONS_PER_COMMENT_MAX
}

export type PeopleCache = {
  get(docId: string): Promise<readonly MentionPerson[] | null>
  peek(docId: string): readonly MentionPerson[] | undefined
}

export function createPeopleCache(deps: {
  load: (docId: string) => Promise<readonly MentionPerson[] | null>
  now: () => number
  online: () => boolean
}): PeopleCache {
  const cache = new Map<string, { people: readonly MentionPerson[]; expiresAt: number }>()
  const inflight = new Map<string, Promise<readonly MentionPerson[] | null>>()

  function peek(docId: string): readonly MentionPerson[] | undefined {
    const entry = cache.get(docId)
    if (!entry) return undefined
    if (entry.expiresAt <= deps.now()) return undefined
    return entry.people
  }

  function get(docId: string): Promise<readonly MentionPerson[] | null> {
    const fresh = peek(docId)
    if (fresh !== undefined) return Promise.resolve(fresh)
    const pending = inflight.get(docId)
    if (pending) return pending
    if (!deps.online()) return Promise.resolve(null)
    const promise = deps.load(docId).then((result) => {
      inflight.delete(docId)
      if (result !== null) cache.set(docId, { people: result, expiresAt: deps.now() + MENTION_PEOPLE_TTL_MS })
      return result
    })
    inflight.set(docId, promise)
    return promise
  }

  return { get, peek }
}
