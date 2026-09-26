import { describe, expect, it, vi } from 'vitest'
import {
  applyMentionPick,
  createPeopleCache,
  filterMentionCandidates,
  mentionLimitReached,
  mentionTokenAt,
  type MentionPerson,
} from './mentionCandidates'
import { finalizeMentions } from '../lib/docComments'

describe('mentionTokenAt — U11 (r1)', () => {
  it('r1 의 열 가지 입력', () => {
    expect(mentionTokenAt('@', 1)).toEqual({ start: 0, end: 1, query: '' })
    expect(mentionTokenAt('안녕@', 3)).toEqual({ start: 2, end: 3, query: '' })
    expect(mentionTokenAt('(@b', 3)).toEqual({ start: 1, end: 3, query: 'b' })
    expect(mentionTokenAt('@b@x', 4)).toEqual({ start: 0, end: 4, query: 'b@x' })
    expect(mentionTokenAt('a@b', 3)).toBeNull()
    expect(mentionTokenAt('메일 a@b.com', 9)).toBeNull()
    expect(mentionTokenAt('x@', 2)).toBeNull()
    expect(mentionTokenAt('.@b', 3)).toBeNull()
  })

  it("'@bo|b@x.com'(캐럿 |) 은 { start: 0, end: 끝, query: 'bo' }", () => {
    const text = '@bob@x.com'
    expect(mentionTokenAt(text, 3)).toEqual({ start: 0, end: text.length, query: 'bo' })
  })
})

describe('mentionTokenAt — U12', () => {
  it('범위를 넘는 질의(255자)면 null', () => {
    const text = '@' + 'a'.repeat(255)
    expect(mentionTokenAt(text, text.length)).toBeNull()
    const ok = '@' + 'a'.repeat(254)
    expect(mentionTokenAt(ok, ok.length)).not.toBeNull()
  })
})

describe('filterMentionCandidates — U13', () => {
  const people: MentionPerson[] = [
    { email: 'a@x.com', role: 'owner' },
    { email: 'b@x.com', role: 'edit' },
    { email: 'ab@x.com', role: 'edit' },
    { email: 'c@y.com', role: 'view' },
  ]

  it("query '' 는 나를 뺀 API 순서 그대로", () => {
    expect(filterMentionCandidates(people, '', 'A@X.COM')).toEqual([
      { email: 'b@x.com', role: 'edit' },
      { email: 'ab@x.com', role: 'edit' },
      { email: 'c@y.com', role: 'view' },
    ])
  })

  it("query 'b' 는 시작 일치(b@x.com) 먼저, ab@x.com 뒤", () => {
    expect(filterMentionCandidates(people, 'b', 'A@X.COM')).toEqual([
      { email: 'b@x.com', role: 'edit' },
      { email: 'ab@x.com', role: 'edit' },
    ])
  })

  it("query 'y.c' 는 c@y.com", () => {
    expect(filterMentionCandidates(people, 'y.c', 'A@X.COM')).toEqual([{ email: 'c@y.com', role: 'view' }])
  })

  it("query 'zz' 는 빈 배열", () => {
    expect(filterMentionCandidates(people, 'zz', 'A@X.COM')).toEqual([])
  })

  it('사람 12명, query \'\' 는 8명(최대)', () => {
    const twelve: MentionPerson[] = Array.from({ length: 12 }, (_, i) => ({ email: `p${i}@x.com`, role: 'edit' as const }))
    expect(filterMentionCandidates(twelve, '', 'self@x.com')).toHaveLength(8)
  })
})

describe('applyMentionPick — U14', () => {
  it("'@b' — 뒤에 글자 없으면 공백 하나를 넣고 캐럿은 그 뒤", () => {
    const result = applyMentionPick('@b', { start: 0, end: 2, query: 'b' }, 'b@x.com')
    expect(result.text).toBe('@b@x.com ')
    expect(result.caret).toBe('@b@x.com'.length + 1)
  })

  it("'@b뒤' — 다음 글자가 공백류가 아니면 공백을 넣는다", () => {
    const result = applyMentionPick('@b뒤', { start: 0, end: 2, query: 'b' }, 'b@x.com')
    expect(result.text).toBe('@b@x.com 뒤')
    expect(result.caret).toBe('@b@x.com '.length)
  })

  it("'@b 뒤' — 이미 공백이 있으면 그 공백 뒤로 캐럿", () => {
    const result = applyMentionPick('@b 뒤', { start: 0, end: 2, query: 'b' }, 'b@x.com')
    expect(result.text).toBe('@b@x.com 뒤')
    expect(result.caret).toBe('@b@x.com '.length)
  })

  it("'(@b' — 앞 글자는 그대로 둔다", () => {
    const result = applyMentionPick('(@b', { start: 1, end: 3, query: 'b' }, 'b@x.com')
    expect(result.text).toBe('(@b@x.com ')
  })

  it('토큰이 캐럿 오른쪽으로 이어진 경우 — 뒤 글자까지 바뀐다', () => {
    // '@bob@x.com' 에서 토큰이 [0, 10) 전체 — 캐럿이 중간에 있어도 오른쪽 글자까지 교체된다
    const result = applyMentionPick('@bob@x.com', { start: 0, end: 10, query: 'bo' }, 'bob@x.com')
    expect(result.text).toBe('@bob@x.com ')
  })
})

describe('고른 뒤 finalizeMentions — U15', () => {
  it('applyMentionPick 결과 본문 + picked', () => {
    const applied = applyMentionPick('@b', { start: 0, end: 2, query: 'b' }, 'b@x.com')
    expect(finalizeMentions(applied.text, ['b@x.com'])).toEqual(['b@x.com'])
  })

  it('고른 이메일 글자를 지운 본문', () => {
    expect(finalizeMentions('그냥 글', ['b@x.com'])).toEqual([])
  })

  it('손으로 친 @c@y.com 만 있는 본문 — 고르지 않았으므로 빈 배열', () => {
    expect(finalizeMentions('손으로 @c@y.com 씀', [])).toEqual([])
  })
})

describe('mentionLimitReached — U16', () => {
  const emails = Array.from({ length: 11 }, (_, i) => `p${i}@x.com`)
  function bodyWith(n: number): string {
    return emails.slice(0, n).map((e) => `@${e}`).join(' ')
  }

  it('서로 다른 10명 고르면 참', () => {
    expect(mentionLimitReached(bodyWith(10), emails.slice(0, 10))).toBe(true)
  })

  it('9명이면 거짓', () => {
    expect(mentionLimitReached(bodyWith(9), emails.slice(0, 9))).toBe(false)
  })

  it('11명이면 참(10개에서 자름)', () => {
    expect(mentionLimitReached(bodyWith(11), emails.slice(0, 11))).toBe(true)
  })
})

describe('createPeopleCache — U17', () => {
  it('같은 문서 get 두 번(첫 요청 진행 중) — load 1번', async () => {
    let resolveLoad: (v: readonly MentionPerson[] | null) => void = () => {}
    const load = vi.fn(() => new Promise<readonly MentionPerson[] | null>((resolve) => { resolveLoad = resolve }))
    const cache = createPeopleCache({ load, now: () => 0, online: () => true })
    const p1 = cache.get('d1')
    const p2 = cache.get('d1')
    resolveLoad([{ email: 'a@x.com', role: 'owner' }])
    await Promise.all([p1, p2])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('성공 뒤 4분59초는 캐시, 5분1초는 다시 요청', async () => {
    let now = 0
    const load = vi.fn(async () => [{ email: 'a@x.com', role: 'owner' }] as const)
    const cache = createPeopleCache({ load, now: () => now, online: () => true })
    await cache.get('d1')
    now = 4 * 60_000 + 59_000
    await cache.get('d1')
    expect(load).toHaveBeenCalledTimes(1)
    now = 5 * 60_000 + 1_000
    await cache.get('d1')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('실패 뒤 다시 get 하면 다시 부른다(캐시하지 않는다)', async () => {
    const load = vi.fn(async () => null)
    const cache = createPeopleCache({ load, now: () => 0, online: () => true })
    expect(await cache.get('d1')).toBeNull()
    expect(await cache.get('d1')).toBeNull()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('online() 거짓 + 캐시 없음 — load 0번, null', async () => {
    const load = vi.fn(async () => [{ email: 'a@x.com', role: 'owner' }] as const)
    const cache = createPeopleCache({ load, now: () => 0, online: () => false })
    expect(await cache.get('d1')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it('online() 거짓 + 캐시 있음 — load 0번, 캐시 값', async () => {
    const now = 0
    let online = true
    const load = vi.fn(async () => [{ email: 'a@x.com', role: 'owner' }] as const)
    const cache = createPeopleCache({ load, now: () => now, online: () => online })
    await cache.get('d1')
    online = false
    const result = await cache.get('d1')
    expect(result).toEqual([{ email: 'a@x.com', role: 'owner' }])
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('createPeopleCache — U18 문서 둘', () => {
  it('문서마다 따로 load', async () => {
    const load = vi.fn(async (docId: string) => [{ email: `${docId}@x.com`, role: 'owner' as const }])
    const cache = createPeopleCache({ load, now: () => 0, online: () => true })
    await cache.get('d1')
    await cache.get('d2')
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledWith('d1')
    expect(load).toHaveBeenCalledWith('d2')
  })
})
