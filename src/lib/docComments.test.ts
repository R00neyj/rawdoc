import { describe, expect, it } from 'vitest'

import {
  ANCHOR_CONTEXT_CHARS,
  COMMENTS_PER_DOC_MAX,
  COMMENT_AUTHOR_ID_MAX,
  COMMENT_BODY_MAX,
  COMMENT_EMAIL_MAX,
  COMMENT_ID_MAX,
  COMMENT_OPS_PER_MINUTE,
  COMMENT_QUOTE_MAX,
  MENTIONS_PER_COMMENT_MAX,
  NOTIFICATIONS_LIST_DEFAULT,
  NOTIFICATIONS_LIST_MAX,
  NOTIFICATIONS_PER_RECIPIENT_MAX,
  NOTIFICATIONS_READ_IDS_MAX,
  NOTIFICATION_RETAIN_DAYS,
  REANCHOR_CANDIDATES_MAX,
  REPLIES_PER_THREAD_MAX,
  checkCommentBody,
  checkCommentCapacity,
  commentAllowed,
  commentQuote,
  commentRejectReason,
  commentSig,
  finalizeMentions,
  groupCommentThreads,
  isCommentId,
  normalizeCommentBody,
  parseCommentRecords,
  parseMentions,
  readCommentAnchor,
  recordAnchorSig,
  shortHash,
  sortThreadsByPosition,
  toAnchorRange,
  validateCommentEntry,
} from './docComments'
import type { CommentAnchor, CommentEntry, CommentRecord, CommentThread } from './docComments'

// ----- 테스트 헬퍼 -----

function fakeAnchor(): CommentAnchor {
  return {
    start: { tname: 'content', item: { client: 1, clock: 0 }, assoc: 0 },
    end: { tname: 'content', item: { client: 1, clock: 5 }, assoc: -1 },
  }
}

function rawRoot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    parent: null,
    anchor: fakeAnchor(),
    quote: 'quoted text',
    body: 'hello @a@b.com',
    mentions: ['a@b.com'],
    author: { id: 'user-1', email: 'user1@example.com' },
    createdAt: 1000,
    resolved: null,
    ...overrides,
  }
}

function rawReply(parent: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    parent,
    anchor: null,
    quote: '',
    body: 'reply text',
    mentions: [],
    author: { id: 'user-1', email: 'user1@example.com' },
    createdAt: 1000,
    resolved: null,
    ...overrides,
  }
}

function fakeEntry(authorId: string | null, overrides: Partial<CommentEntry> = {}): CommentEntry {
  return {
    v: 1,
    parent: null,
    anchor: null,
    quote: '',
    body: 'x',
    mentions: [],
    author: authorId === null ? { id: null, email: null } : { id: authorId, email: `${authorId}@example.com` },
    createdAt: 0,
    resolved: null,
    ...overrides,
  }
}

function threadOf(id: string, createdAt: number, replies: { id: string; createdAt: number }[] = []): CommentThread {
  return {
    id,
    root: fakeEntry('u1', { createdAt }),
    replies: replies.map((r) => ({ id: r.id, entry: fakeEntry('u1', { parent: id, createdAt: r.createdAt }) })),
  }
}

function baseRecord(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: 'root1',
    parent: null,
    body: 'hello',
    mentions: [],
    authorId: 'u1',
    authorEmail: 'u1@example.com',
    createdAt: 1000,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: 'quoted',
    prefix: 'pre',
    suffix: 'suf',
    anchorFrom: 10,
    anchorLength: 6,
    ...overrides,
  }
}

function replyRecord(parent: string, id: string, overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id,
    parent,
    body: 'reply',
    mentions: [],
    authorId: 'u1',
    authorEmail: 'u1@example.com',
    createdAt: 1,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: '',
    prefix: '',
    suffix: '',
    anchorFrom: null,
    anchorLength: null,
    ...overrides,
  }
}

// ----- B1 상수 -----

describe('F-501 B1 상수', () => {
  it('2.1 값 그대로', () => {
    expect(COMMENT_BODY_MAX).toBe(1_000)
    expect(COMMENTS_PER_DOC_MAX).toBe(500)
    expect(REPLIES_PER_THREAD_MAX).toBe(100)
    expect(MENTIONS_PER_COMMENT_MAX).toBe(10)
    expect(COMMENT_QUOTE_MAX).toBe(200)
    expect(ANCHOR_CONTEXT_CHARS).toBe(32)
    expect(COMMENT_OPS_PER_MINUTE).toBe(30)
    expect(NOTIFICATION_RETAIN_DAYS).toBe(90)
    expect(NOTIFICATIONS_PER_RECIPIENT_MAX).toBe(300)
    expect(REANCHOR_CANDIDATES_MAX).toBe(1_000)
    expect(COMMENT_ID_MAX).toBe(64)
    expect(COMMENT_EMAIL_MAX).toBe(254)
    expect(COMMENT_AUTHOR_ID_MAX).toBe(128)
  })
})

// ----- B2 validateCommentEntry 정상 -----

describe('F-501 B2 validateCommentEntry 정상 항목', () => {
  it('올바른 첫 댓글(서버 작성자)', () => {
    const raw = rawRoot()
    const result = validateCommentEntry(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.entry).toEqual(raw)
      expect(result.entry).not.toBe(raw)
    }
  })

  it('답글', () => {
    const raw = rawReply('parent-1')
    const result = validateCommentEntry(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.entry).toEqual(raw)
  })

  it('로컬 첫 댓글', () => {
    const raw = rawRoot({ author: { id: null, email: null }, mentions: [] })
    const result = validateCommentEntry(raw)
    expect(result.ok).toBe(true)
  })

  it('고아 첫 댓글(anchor: null)', () => {
    const raw = rawRoot({ anchor: null })
    const result = validateCommentEntry(raw)
    expect(result.ok).toBe(true)
  })

  it('해결된 첫 댓글', () => {
    const raw = rawRoot({ resolved: { by: { id: 'user-1', email: 'user1@example.com' }, at: 2000 } })
    const result = validateCommentEntry(raw)
    expect(result.ok).toBe(true)
  })
})

// ----- B3 사유 14개 -----

describe('F-501 B3 validateCommentEntry 사유', () => {
  it('not_object', () => {
    expect(validateCommentEntry(null)).toEqual({ ok: false, error: 'not_object' })
    expect(validateCommentEntry([1, 2])).toEqual({ ok: false, error: 'not_object' })
    expect(validateCommentEntry('x')).toEqual({ ok: false, error: 'not_object' })
  })

  it('unknown_field', () => {
    expect(validateCommentEntry({ ...rawRoot(), extra: 1 })).toEqual({ ok: false, error: 'unknown_field' })
  })

  it('bad_version', () => {
    expect(validateCommentEntry(rawRoot({ v: 2 }))).toEqual({ ok: false, error: 'bad_version' })
  })

  it('bad_parent', () => {
    expect(validateCommentEntry(rawRoot({ parent: 'bad id!' }))).toEqual({ ok: false, error: 'bad_parent' })
  })

  it('bad_anchor', () => {
    expect(validateCommentEntry(rawRoot({ anchor: {} }))).toEqual({ ok: false, error: 'bad_anchor' })
    expect(validateCommentEntry(rawReply('parent-1', { anchor: fakeAnchor() }))).toEqual({ ok: false, error: 'bad_anchor' })
  })

  it('bad_quote', () => {
    expect(validateCommentEntry(rawRoot({ quote: '' }))).toEqual({ ok: false, error: 'bad_quote' })
    expect(validateCommentEntry(rawReply('parent-1', { quote: 'x' }))).toEqual({ ok: false, error: 'bad_quote' })
  })

  it('bad_body', () => {
    expect(validateCommentEntry(rawRoot({ body: '  untrimmed  ' }))).toEqual({ ok: false, error: 'bad_body' })
  })

  it('empty_body', () => {
    expect(validateCommentEntry(rawRoot({ body: '' }))).toEqual({ ok: false, error: 'empty_body' })
  })

  it('body_too_long', () => {
    expect(validateCommentEntry(rawRoot({ body: 'a'.repeat(1001), mentions: [] }))).toEqual({ ok: false, error: 'body_too_long' })
  })

  it('bad_mentions', () => {
    expect(validateCommentEntry(rawRoot({ mentions: ['zzz@not-in-body.com'] }))).toEqual({ ok: false, error: 'bad_mentions' })
  })

  it('too_many_mentions', () => {
    expect(validateCommentEntry(rawRoot({ mentions: new Array(11).fill('a@b.com') }))).toEqual({ ok: false, error: 'too_many_mentions' })
  })

  it('bad_author', () => {
    expect(validateCommentEntry(rawRoot({ author: { id: 'u1' } }))).toEqual({ ok: false, error: 'bad_author' })
  })

  it('bad_created_at', () => {
    expect(validateCommentEntry(rawRoot({ createdAt: -1 }))).toEqual({ ok: false, error: 'bad_created_at' })
    expect(validateCommentEntry(rawRoot({ createdAt: 1.5 }))).toEqual({ ok: false, error: 'bad_created_at' })
  })

  it('bad_resolved', () => {
    expect(validateCommentEntry(rawRoot({ resolved: { by: 'x', at: 100 } }))).toEqual({ ok: false, error: 'bad_resolved' })
    expect(validateCommentEntry(rawReply('parent-1', { resolved: { by: { id: 'user-1', email: 'a@b.com' }, at: 1 } }))).toEqual({
      ok: false,
      error: 'bad_resolved',
    })
  })
})

// ----- B4 우선순위 -----

describe('F-501 B4 여러 사유가 겹치면 먼저 나오는 것', () => {
  it('bad_version + body_too_long → bad_version', () => {
    expect(validateCommentEntry(rawRoot({ v: 2, body: 'a'.repeat(1001) }))).toEqual({ ok: false, error: 'bad_version' })
  })

  it('bad_quote + bad_author → bad_quote', () => {
    expect(validateCommentEntry(rawRoot({ quote: '', author: { id: 'u1' } }))).toEqual({ ok: false, error: 'bad_quote' })
  })
})

// ----- B5 checkCommentBody / normalizeCommentBody -----

describe('F-501 B5 checkCommentBody', () => {
  it('규칙대로', () => {
    expect(checkCommentBody('')).toBe('empty_body')
    expect(checkCommentBody(' ')).toBe('bad_body')
    expect(checkCommentBody('a')).toBeNull()
    expect(checkCommentBody('a'.repeat(1000))).toBeNull()
    expect(checkCommentBody('a'.repeat(1001))).toBe('body_too_long')
    expect(checkCommentBody('a\r\nb')).toBe('bad_body')
    expect(checkCommentBody(' a')).toBe('bad_body')
  })

  it('normalizeCommentBody', () => {
    expect(normalizeCommentBody(' a\r\nb \n')).toBe('a\nb')
  })
})

// ----- B6 commentAllowed -----

describe('F-501 B6 commentAllowed', () => {
  const own = fakeEntry('u1')
  const other = fakeEntry('u2')

  it('server owner, 안 막힘', () => {
    const actor = { kind: 'server' as const, userId: 'u1', role: 'owner' as const, blocked: false }
    expect(commentAllowed(actor, 'add')).toBe(true)
    expect(commentAllowed(actor, 'reply')).toBe(true)
    expect(commentAllowed(actor, 'resolve')).toBe(true)
    expect(commentAllowed(actor, 'delete', own)).toBe(true)
    expect(commentAllowed(actor, 'delete', other)).toBe(true)
    expect(commentAllowed(actor, 'delete')).toBe(false)
  })

  it('server edit, 안 막힘', () => {
    const actor = { kind: 'server' as const, userId: 'u1', role: 'edit' as const, blocked: false }
    expect(commentAllowed(actor, 'add')).toBe(true)
    expect(commentAllowed(actor, 'reply')).toBe(true)
    expect(commentAllowed(actor, 'resolve')).toBe(true)
    expect(commentAllowed(actor, 'delete', own)).toBe(true)
    expect(commentAllowed(actor, 'delete', other)).toBe(false)
    expect(commentAllowed(actor, 'delete')).toBe(false)
  })

  it('server view, 안 막힘', () => {
    const actor = { kind: 'server' as const, userId: 'u1', role: 'view' as const, blocked: false }
    expect(commentAllowed(actor, 'add')).toBe(true)
    expect(commentAllowed(actor, 'reply')).toBe(true)
    expect(commentAllowed(actor, 'resolve')).toBe(true)
    expect(commentAllowed(actor, 'delete', own)).toBe(true)
    expect(commentAllowed(actor, 'delete', other)).toBe(false)
    expect(commentAllowed(actor, 'delete')).toBe(false)
  })

  it('server, blocked: 역할 무관 전부 거짓', () => {
    for (const role of ['owner', 'edit', 'view'] as const) {
      const actor = { kind: 'server' as const, userId: 'u1', role, blocked: true }
      expect(commentAllowed(actor, 'add')).toBe(false)
      expect(commentAllowed(actor, 'reply')).toBe(false)
      expect(commentAllowed(actor, 'resolve')).toBe(false)
      expect(commentAllowed(actor, 'delete', own)).toBe(false)
      expect(commentAllowed(actor, 'delete', other)).toBe(false)
      expect(commentAllowed(actor, 'delete')).toBe(false)
    }
  })

  it('local, canEdit: true', () => {
    const actor = { kind: 'local' as const, canEdit: true }
    expect(commentAllowed(actor, 'add')).toBe(true)
    expect(commentAllowed(actor, 'reply')).toBe(true)
    expect(commentAllowed(actor, 'resolve')).toBe(true)
    expect(commentAllowed(actor, 'delete', own)).toBe(true)
    expect(commentAllowed(actor, 'delete', other)).toBe(true)
    expect(commentAllowed(actor, 'delete')).toBe(false)
  })

  it('local, canEdit: false', () => {
    const actor = { kind: 'local' as const, canEdit: false }
    expect(commentAllowed(actor, 'add')).toBe(false)
    expect(commentAllowed(actor, 'reply')).toBe(false)
    expect(commentAllowed(actor, 'resolve')).toBe(false)
    expect(commentAllowed(actor, 'delete', own)).toBe(false)
    expect(commentAllowed(actor, 'delete', other)).toBe(false)
    expect(commentAllowed(actor, 'delete')).toBe(false)
  })
})

// ----- B7 groupCommentThreads -----

describe('F-501 B7 groupCommentThreads', () => {
  it('threads·strays·invalid 로 가른다', () => {
    const entries: [string, unknown][] = [
      ['root1', rawRoot({ createdAt: 200 })],
      ['root2', rawRoot({ createdAt: 100 })],
      ['reply1', rawReply('root1', { createdAt: 50 })],
      ['reply2', rawReply('root1', { createdAt: 10 })],
      ['reply3', rawReply('root2', { createdAt: 5 })],
      ['strayA', rawReply('ghost')],
      ['strayB', rawReply('reply1')],
      ['strayC', rawReply('strayC')],
      ['zzzInvalid', {}],
      ['bad id!', rawRoot()],
    ]
    const { threads, strays, invalid } = groupCommentThreads(entries)

    expect(threads.map((t) => t.id)).toEqual(['root2', 'root1'])
    expect(threads[1].replies.map((r) => r.id)).toEqual(['reply2', 'reply1'])
    expect(threads[0].replies.map((r) => r.id)).toEqual(['reply3'])
    expect(strays).toEqual(['strayA', 'strayB', 'strayC'])
    expect(invalid).toEqual(['bad id!', 'zzzInvalid'])
  })
})

// ----- B8 sortThreadsByPosition -----

describe('F-501 B8 sortThreadsByPosition', () => {
  it('anchored 는 from→to→createdAt, orphans 는 createdAt', () => {
    const t1 = threadOf('t1', 100)
    const t2 = threadOf('t2', 200)
    const t3 = threadOf('t3', 300)
    const t4 = threadOf('t4', 100)
    const t5 = threadOf('t5', 50)
    const ranges = new Map([
      ['t1', { from: 5, to: 10 }],
      ['t2', { from: 5, to: 8 }],
      ['t3', { from: 2, to: 4 }],
      ['t4', null],
    ])
    const { anchored, orphans } = sortThreadsByPosition([t1, t2, t3, t4, t5], ranges)
    expect(anchored.map((t) => t.id)).toEqual(['t3', 't2', 't1'])
    expect(orphans.map((t) => t.id)).toEqual(['t5', 't4'])
  })
})

// ----- B9 toAnchorRange -----

describe('F-501 B9 toAnchorRange', () => {
  it('규칙대로', () => {
    expect(toAnchorRange(null, 3)).toBeNull()
    expect(toAnchorRange(3, null)).toBeNull()
    expect(toAnchorRange(3, 3)).toBeNull()
    expect(toAnchorRange(4, 3)).toBeNull()
    expect(toAnchorRange(3, 4)).toEqual({ from: 3, to: 4 })
  })
})

// ----- B10 checkCommentCapacity -----

function threadsWithCounts(rootCount: number, replyCounts: number[] = []): CommentThread[] {
  const threads: CommentThread[] = []
  for (let i = 0; i < rootCount; i++) {
    const n = replyCounts[i] ?? 0
    threads.push({
      id: `t${i}`,
      root: fakeEntry('u1'),
      replies: Array.from({ length: n }, (_, j) => ({ id: `t${i}-r${j}`, entry: fakeEntry('u1', { parent: `t${i}` }) })),
    })
  }
  return threads
}

describe('F-501 B10 checkCommentCapacity', () => {
  it('문서 499개에 추가 → null, 500개 → doc_full', () => {
    expect(checkCommentCapacity(threadsWithCounts(499), null)).toBeNull()
    expect(checkCommentCapacity(threadsWithCounts(500), null)).toBe('doc_full')
  })

  it('스레드 답글 99개에 추가 → null, 100개 → thread_full', () => {
    expect(checkCommentCapacity(threadsWithCounts(1, [99]), 't0')).toBeNull()
    expect(checkCommentCapacity(threadsWithCounts(1, [100]), 't0')).toBe('thread_full')
  })

  it('문서도 가득, 스레드도 가득 → doc_full 먼저', () => {
    const counts = new Array(400).fill(0)
    counts[0] = 100
    expect(checkCommentCapacity(threadsWithCounts(400, counts), 't0')).toBe('doc_full')
  })

  it('없는 parent → null', () => {
    expect(checkCommentCapacity(threadsWithCounts(2), 'ghost')).toBeNull()
  })
})

// ----- B11 commentRejectReason -----

describe('F-501 B11 commentRejectReason', () => {
  it('매핑', () => {
    expect(commentRejectReason('body_too_long')).toBe('too_long')
    expect(commentRejectReason('doc_full')).toBe('too_many')
    expect(commentRejectReason('thread_full')).toBe('too_many')
    expect(commentRejectReason('bad_anchor')).toBe('invalid')
    expect(commentRejectReason('too_many_mentions')).toBe('invalid')
  })
})

// ----- B12 parseMentions -----

describe('F-501 B12 parseMentions', () => {
  it('6.1 표의 예 전부', () => {
    expect(parseMentions('a@kim@x.com')).toEqual([])
    expect(parseMentions('(@kim@x.com)')).toEqual(['kim@x.com'])
    expect(parseMentions('메일@kim@x.com')).toEqual(['kim@x.com'])
    expect(parseMentions('@kim@x.com.')).toEqual(['kim@x.com'])
    expect(parseMentions('@kim@x.com님')).toEqual(['kim@x.com'])
    expect(parseMentions('@kim@x.com,@lee@y.org')).toEqual(['kim@x.com', 'lee@y.org'])
    expect(parseMentions('@kim@x.com_z')).toEqual([])
    expect(parseMentions('@kim@x')).toEqual([])
    expect(parseMentions('@Kim@X.com @kim@x.com')).toEqual(['kim@x.com'])
    expect(parseMentions('@@kim@x.com')).toEqual([])
    expect(parseMentions('`@kim@x.com`')).toEqual(['kim@x.com'])
    expect(parseMentions('\n@kim@x.com')).toEqual(['kim@x.com'])
  })
})

// ----- B13 finalizeMentions -----

describe('F-501 B13 finalizeMentions', () => {
  it('본문에 있는 것만 소문자·본문 순서, 앞 10개', () => {
    const addrs = Array.from({ length: 12 }, (_, i) => `a${i}@x.com`)
    const body = addrs.map((a) => `@${a}`).join(' ')
    const picked = [...addrs, 'notinbody@x.com', addrs[0].toUpperCase(), addrs[1]]
    expect(finalizeMentions(body, picked)).toEqual(addrs.slice(0, 10))
  })
})

// ----- B14 validateCommentEntry 멘션 관련 -----

describe('F-501 B14 validateCommentEntry 멘션', () => {
  it('본문에 없는 이메일', () => {
    expect(validateCommentEntry(rawRoot({ mentions: ['zzz@not-in-body.com'] })).ok).toBe(false)
  })

  it('로컬 작성자인데 멘션 있음', () => {
    const raw = rawRoot({ author: { id: null, email: null } })
    const result = validateCommentEntry(raw)
    expect(result).toEqual({ ok: false, error: 'bad_mentions' })
  })

  it('대문자 멘션', () => {
    const result = validateCommentEntry(rawRoot({ mentions: ['A@B.COM'], body: 'hello @a@b.com' }))
    expect(result).toEqual({ ok: false, error: 'bad_mentions' })
  })
})

// ----- B15 shortHash -----

describe('F-501 B15 shortHash', () => {
  it('시험값', () => {
    expect(shortHash('')).toBe('cbf29ce484222325')
    expect(shortHash('a')).toBe('af63dc4c8601ec8c')
    expect(shortHash('foobar')).toBe('85944171f73967e8')
    expect(shortHash('댓글')).toBe('c8f9ec798637a89b')
  })

  it('모두 길이 16, 소문자 16진수', () => {
    for (const v of ['', 'a', 'foobar', '댓글', 'hello world']) {
      expect(shortHash(v)).toMatch(/^[0-9a-f]{16}$/)
    }
  })
})

// ----- F-502 H1 shortHash 가 BigInt 참조 구현과 같다 -----

function bigIntFnv(input: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

describe('F-502 H1 shortHash 참조 구현', () => {
  it('B15 넷 + 한글 1,000자 + 제어 문자 섞인 글', () => {
    const korean = Array.from({ length: 1_000 }, (_, i) => String.fromCharCode(0xac00 + ((i * 37) % 11_172))).join('')
    const mixed = Array.from({ length: 600 }, (_, i) => String.fromCharCode(i % 40) + 'x가😀'[i % 4]).join('')
    for (const v of ['', 'a', 'foobar', '댓글', korean, mixed, '￿'.repeat(300)]) {
      expect(shortHash(v)).toBe(bigIntFnv(v))
    }
  })
})

// ----- B16 commentSig -----

describe('F-501 B16 commentSig', () => {
  it('resolved 만 바꾸면 달라지고, anchor·quote 만 바꾸면 같다', () => {
    const base = fakeEntry('u1', { body: 'hi', createdAt: 10 })
    const resolvedChanged = { ...base, resolved: { by: { id: 'u1', email: 'u1@example.com' }, at: 20 } }
    expect(commentSig(base)).not.toBe(commentSig(resolvedChanged))

    const anchorQuoteChanged = { ...base, anchor: fakeAnchor(), quote: 'different quote' }
    expect(commentSig(base)).toBe(commentSig(anchorQuoteChanged))
  })
})

// ----- B17 recordAnchorSig -----

describe('F-501 B17 recordAnchorSig', () => {
  it('anchorFrom 만 바꾸면 같고, suffix·anchorLength 를 바꾸면 다르다', () => {
    const base = baseRecord()
    expect(recordAnchorSig(base)).toBe(recordAnchorSig({ ...base, anchorFrom: 999 }))
    expect(recordAnchorSig(base)).not.toBe(recordAnchorSig({ ...base, suffix: 'zzzz' }))
    expect(recordAnchorSig(base)).not.toBe(recordAnchorSig({ ...base, anchorLength: 7 }))
  })
})

// ----- B18 commentQuote -----

describe('F-501 B18 commentQuote', () => {
  it('200자는 그대로, 201자는 잘리고, 서로게이트 걸침을 피한다', () => {
    const exact = 'a'.repeat(200)
    expect(commentQuote(exact)).toBe(exact)

    const over = 'a'.repeat(201)
    const cut = commentQuote(over)
    expect(cut.length).toBe(200)
    expect(cut.endsWith('…')).toBe(true)

    const straddling = 'a'.repeat(198) + '😀' + 'a'.repeat(51)
    const cutStraddling = commentQuote(straddling)
    expect(cutStraddling.length).toBe(199)
    expect(cutStraddling.endsWith('…')).toBe(true)
    const secondToLast = cutStraddling.codePointAt(cutStraddling.length - 2)!
    expect(secondToLast >= 0xd800 && secondToLast <= 0xdbff).toBe(false)
  })
})

// ----- B19 parseCommentRecords -----

describe('F-501 B19 parseCommentRecords', () => {
  it('배열이 아님 → invalid', () => {
    expect(parseCommentRecords({})).toEqual({ ok: false, reason: 'invalid' })
  })

  it('501개 → too_many', () => {
    const records = Array.from({ length: 501 }, () => ({}))
    expect(parseCommentRecords(records)).toEqual({ ok: false, reason: 'too_many' })
  })

  it('답글 101개 스레드 → too_many', () => {
    const records = [baseRecord({ id: 'root1' }), ...Array.from({ length: 101 }, (_, i) => replyRecord('root1', `r${i}`))]
    expect(parseCommentRecords(records)).toEqual({ ok: false, reason: 'too_many' })
  })

  it('키 하나 더함 → invalid', () => {
    expect(parseCommentRecords([{ ...baseRecord(), extra: 1 }])).toEqual({ ok: false, reason: 'invalid' })
  })

  it('답글의 답글 → invalid', () => {
    const records = [baseRecord({ id: 'root1' }), replyRecord('root1', 'reply1'), replyRecord('reply1', 'reply2')]
    expect(parseCommentRecords(records)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('없는 부모 → invalid', () => {
    const records = [baseRecord({ id: 'root1' }), replyRecord('ghost', 'reply1')]
    expect(parseCommentRecords(records)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('중복 id → invalid', () => {
    const records = [baseRecord({ id: 'dup' }), baseRecord({ id: 'dup' })]
    expect(parseCommentRecords(records)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('앵커 필드가 세 모양 밖 → invalid', () => {
    expect(parseCommentRecords([baseRecord({ anchorFrom: 10, anchorLength: null })])).toEqual({ ok: false, reason: 'invalid' })
    expect(parseCommentRecords([baseRecord({ anchorLength: 6, quote: 'wrong-length-quote' })])).toEqual({ ok: false, reason: 'invalid' })
  })

  it('로컬 작성자인데 resolvedById 문자열 → invalid', () => {
    const records = [
      baseRecord({ authorId: null, authorEmail: null, mentions: [], resolvedAt: 500, resolvedById: 'someone', resolvedBy: 'someone@x.com' }),
    ]
    expect(parseCommentRecords(records)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('올바른 배열은 통과한다', () => {
    const result = parseCommentRecords([baseRecord()])
    expect(result.ok).toBe(true)
  })
})

// ----- B20 readCommentAnchor -----

describe('F-501 B20 readCommentAnchor', () => {
  it('올바른 앵커는 같은 값의 새 객체', () => {
    const anchor = fakeAnchor()
    const read = readCommentAnchor(anchor)
    expect(read).toEqual(anchor)
  })

  it('틀린 모양은 null', () => {
    const bad = [
      {},
      { start: {}, end: fakeAnchor().end },
      { start: { tname: 'content', item: 'x', assoc: 0 }, end: fakeAnchor().end },
      { start: { tname: 'content', item: { client: 'a', clock: 0 }, assoc: 0 }, end: fakeAnchor().end },
      { start: { tname: 'content', item: { client: 1, clock: -1 }, assoc: 0 }, end: fakeAnchor().end },
      { start: { tname: 'content', item: { client: 1, clock: 0 } }, end: fakeAnchor().end },
      { start: { tname: 'content', item: { client: 1, clock: 0 }, assoc: -1 }, end: fakeAnchor().end },
      { start: { tname: 'content', item: { client: 1, clock: 0 }, assoc: 0, type: 'x' }, end: fakeAnchor().end },
      { start: { tname: 'content', item: null, assoc: 0 }, end: fakeAnchor().end },
      { start: { tname: 'title', item: { client: 1, clock: 0 }, assoc: 0 }, end: fakeAnchor().end },
    ]
    for (const anchor of bad) {
      expect(readCommentAnchor(anchor)).toBeNull()
    }
  })
})

// ----- B21 isCommentId -----

describe('F-501 B21 isCommentId', () => {
  it('규칙대로', () => {
    expect(isCommentId(crypto.randomUUID())).toBe(true)
    expect(isCommentId('')).toBe(false)
    expect(isCommentId('a'.repeat(65))).toBe(false)
    expect(isCommentId('a b')).toBe(false)
    expect(isCommentId('가')).toBe(false)
    expect(isCommentId(123)).toBe(false)
  })
})

describe('F-503 B22 알림 API 상수', () => {
  it('30·50·50', () => {
    expect(NOTIFICATIONS_LIST_DEFAULT).toBe(30)
    expect(NOTIFICATIONS_LIST_MAX).toBe(50)
    expect(NOTIFICATIONS_READ_IDS_MAX).toBe(50)
  })
})
