import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPendingReads,
  dropSettledReads,
  fetchDocPeople,
  fetchNotifications,
  markNotificationsRead,
  notificationExcerptLine,
  notificationText,
  readDocPeopleResponse,
  readNotificationsResponse,
  shouldFetchNotifications,
  type PendingRead,
} from '../../../src/app/notificationsApi'
import type { NotificationItem, NotificationsResponse } from '../../../src/lib/docComments'

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    kind: 'mention',
    docId: 'd1',
    commentId: 'c1',
    threadId: 't1',
    actorEmail: 'a@x.com',
    docTitle: '제목',
    excerpt: '발췌',
    createdAt: 1000,
    readAt: null,
    ...over,
  }
}

describe('readNotificationsResponse — U1', () => {
  it('올바른 몸통은 값을 돌려준다', () => {
    const body = { items: [item()], unread: 1 }
    expect(readNotificationsResponse(body)).toEqual(body)
  })

  it('items 없음 / kind 틀림 / unread 음수·소수 / readAt 문자열 / HTML 문자열은 null', () => {
    expect(readNotificationsResponse({ unread: 0 })).toBeNull()
    expect(readNotificationsResponse({ items: [item({ kind: 'like' as never })], unread: 1 })).toBeNull()
    expect(readNotificationsResponse({ items: [], unread: -1 })).toBeNull()
    expect(readNotificationsResponse({ items: [], unread: 1.5 })).toBeNull()
    expect(readNotificationsResponse({ items: [item({ readAt: 'x' as never })], unread: 0 })).toBeNull()
    expect(readNotificationsResponse('<html></html>')).toBeNull()
  })
})

describe('readDocPeopleResponse — U2', () => {
  it('올바름 / role 틀림 / people 이 객체', () => {
    expect(readDocPeopleResponse({ people: [{ email: 'a@x.com', role: 'owner' }] })).toEqual({
      people: [{ email: 'a@x.com', role: 'owner' }],
    })
    expect(readDocPeopleResponse({ people: [{ email: 'a@x.com', role: 'admin' }] })).toBeNull()
    expect(readDocPeopleResponse({ people: {} })).toBeNull()
  })
})

describe('fetchNotifications — U3', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('연결 실패 → network', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'))
    expect(await fetchNotifications(null)).toEqual({ ok: false, reason: 'network' })
  })

  it('401 → unauthorized', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    expect(await fetchNotifications(null)).toEqual({ ok: false, reason: 'unauthorized' })
  })

  it('503 → server', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    expect(await fetchNotifications(null)).toEqual({ ok: false, reason: 'server' })
  })

  it('200 HTML(json 파싱 실패) → invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(await fetchNotifications(null)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('200 모양 틀림 → invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }))
    expect(await fetchNotifications(null)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('200 올바름 → ok', async () => {
    const data: NotificationsResponse = { items: [item()], unread: 1 }
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }))
    expect(await fetchNotifications(null)).toEqual({ ok: true, data, etag: null })
  })
})

describe('fetchNotifications 조건부 — F-2057 U13', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })
  const data: NotificationsResponse = { items: [item()], unread: 1 }
  const sentHeaders = (mock: ReturnType<typeof vi.fn>) => new Headers((mock.mock.calls[0][1] as RequestInit).headers)

  it('etag 를 주면 If-None-Match 가 그 값, cache no-store', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }))
    globalThis.fetch = mock
    await fetchNotifications('W/"n1-u1-3-30"')
    expect(sentHeaders(mock).get('If-None-Match')).toBe('W/"n1-u1-3-30"')
    expect((mock.mock.calls[0][1] as RequestInit).cache).toBe('no-store')
  })

  it('null 이면 If-None-Match 없음', async () => {
    const mock = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 }))
    globalThis.fetch = mock
    await fetchNotifications(null)
    expect(sentHeaders(mock).has('If-None-Match')).toBe(false)
  })

  it('304 → notModified', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 304, headers: { ETag: 'W/"a"' } }))
    expect(await fetchNotifications('W/"a"')).toEqual({ ok: true, notModified: true })
  })

  it('null 로 보냈는데 304 → invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 304 }))
    expect(await fetchNotifications(null)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('200 + ETag → 그 값, 200자 넘으면 null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200, headers: { ETag: 'W/"n1-u1-4-30"' } }))
    expect(await fetchNotifications(null)).toEqual({ ok: true, data, etag: 'W/"n1-u1-4-30"' })
    const exact = 'x'.repeat(200)
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200, headers: { ETag: exact } }))
    expect(await fetchNotifications(null)).toEqual({ ok: true, data, etag: exact })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200, headers: { ETag: 'x'.repeat(201) } }))
    expect(await fetchNotifications(null)).toEqual({ ok: true, data, etag: null })
  })

  it('401·5xx·HTML 200 은 조건부여도 지금과 같다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    expect(await fetchNotifications('W/"a"')).toEqual({ ok: false, reason: 'unauthorized' })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 502 }))
    expect(await fetchNotifications('W/"a"')).toEqual({ ok: false, reason: 'server' })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
    expect(await fetchNotifications('W/"a"')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('markNotificationsRead — U4', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('요청이 POST /api/notifications/read, 몸통 JSON 이 그대로', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    globalThis.fetch = fetchMock
    const ok = await markNotificationsRead({ ids: ['a'] })
    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/notifications/read',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: ['a'] }) }),
    )
  })

  it('{ all: true } 도 그대로 보낸다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    globalThis.fetch = fetchMock
    await markNotificationsRead({ all: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/read', expect.objectContaining({ body: JSON.stringify({ all: true }) }))
  })

  it('403 → false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    expect(await markNotificationsRead({ ids: ['a'] })).toBe(false)
  })

  it('연결 실패 → false', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('fail'))
    expect(await markNotificationsRead({ ids: ['a'] })).toBe(false)
  })
})

describe('notificationText — U5', () => {
  it('mention·reply 문구', () => {
    expect(notificationText(item({ kind: 'mention', actorEmail: 'a@x.com', docTitle: '제목' }))).toBe(
      'a@x.com님이 "제목" 댓글에서 멘션했습니다.',
    )
    expect(notificationText(item({ kind: 'reply', actorEmail: 'a@x.com', docTitle: '제목' }))).toBe(
      'a@x.com님이 "제목"의 댓글에 답글을 달았습니다.',
    )
  })

  it('제목이 빈 문자열·공백만이면 제목 없는 문서', () => {
    expect(notificationText(item({ docTitle: '' }))).toContain('"제목 없는 문서"')
    expect(notificationText(item({ docTitle: '   ' }))).toContain('"제목 없는 문서"')
  })

  it('41자는 39자 + …, 40자는 그대로', () => {
    const t41 = 'a'.repeat(41)
    const t40 = 'a'.repeat(40)
    expect(notificationText(item({ docTitle: t41 }))).toContain(`"${'a'.repeat(39)}…"`)
    expect(notificationText(item({ docTitle: t40 }))).toContain(`"${t40}"`)
  })

  it('한글·이모지 섞인 41 코드 포인트는 서로게이트를 자르지 않고 39 + …', () => {
    const t41 = '가'.repeat(38) + '😀😀😀' // 38 + 3 = 41 코드 포인트 (이모지도 1개로 센다)
    expect([...t41].length).toBe(41)
    const result = notificationText(item({ docTitle: t41 }))
    const expected = [...t41].slice(0, 39).join('') + '…'
    expect(result).toContain(`"${expected}"`)
    // 서로게이트 쌍이 갈라지지 않았다 — 결과에 대체 문자가 없다
    expect(result).not.toContain('�')
  })
})

describe('notificationExcerptLine — U6', () => {
  it('줄바꿈을 공백 하나로, 앞뒤 공백을 뺀다', () => {
    expect(notificationExcerptLine('a\nb\r\nc\rd ')).toBe('a b c d')
  })
})

describe('shouldFetchNotifications — U7', () => {
  const base = { now: 10_000, lastStartedAt: null as number | null, inFlight: false, visible: true, online: true, stopped: false }

  it('멈춤·진행 중·오프라인이면 거짓', () => {
    expect(shouldFetchNotifications({ ...base, reason: 'enable', stopped: true })).toBe(false)
    expect(shouldFetchNotifications({ ...base, reason: 'enable', inFlight: true })).toBe(false)
    expect(shouldFetchNotifications({ ...base, reason: 'enable', online: false })).toBe(false)
  })

  it('enable 은 간격을 무시하고 참', () => {
    expect(shouldFetchNotifications({ ...base, reason: 'enable', lastStartedAt: 9_999 })).toBe(true)
  })

  it('interval 은 안 보이면 거짓', () => {
    expect(shouldFetchNotifications({ ...base, reason: 'interval', visible: false, lastStartedAt: null })).toBe(false)
  })

  it('interval 59,999ms 거짓, 60,000ms 참', () => {
    expect(shouldFetchNotifications({ ...base, reason: 'interval', now: 70_000, lastStartedAt: 10_001 })).toBe(false)
    expect(shouldFetchNotifications({ ...base, reason: 'interval', now: 70_000, lastStartedAt: 10_000 })).toBe(true)
  })

  it('visible 4,999ms 거짓, 5,000ms 참', () => {
    expect(shouldFetchNotifications({ ...base, reason: 'visible', now: 10_000, lastStartedAt: 5_002 })).toBe(false)
    expect(shouldFetchNotifications({ ...base, reason: 'visible', now: 10_000, lastStartedAt: 5_000 })).toBe(true)
  })

  it('lastStartedAt 이 null 이면 참', () => {
    expect(shouldFetchNotifications({ ...base, reason: 'online', lastStartedAt: null })).toBe(true)
    expect(shouldFetchNotifications({ ...base, reason: 'open', lastStartedAt: null })).toBe(true)
  })
})

describe('fetchDocPeople — U10', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('200 올바름 → ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ people: [{ email: 'a@x.com', role: 'owner' }] }), { status: 200 }))
    expect(await fetchDocPeople('d1')).toEqual({ ok: true, people: [{ email: 'a@x.com', role: 'owner' }] })
  })

  it('404·409·200 HTML → ok: false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    expect(await fetchDocPeople('d1')).toEqual({ ok: false })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 409 }))
    expect(await fetchDocPeople('d1')).toEqual({ ok: false })
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 }))
    expect(await fetchDocPeople('d1')).toEqual({ ok: false })
  })
})

describe('applyPendingReads·dropSettledReads — U8·U9', () => {
  const A = item({ id: 'A', createdAt: 50, readAt: null })
  const B = item({ id: 'B', createdAt: 150, readAt: null })

  it('ids 대기 [A] — A 가 읽음, unread 4', () => {
    const data: NotificationsResponse = { items: [A, B], unread: 5 }
    const pending: PendingRead[] = [{ kind: 'ids', ids: ['A'], at: 1000, settledAt: null }]
    const result = applyPendingReads(data, pending)
    expect(result.items.find((i) => i.id === 'A')?.readAt).not.toBeNull()
    expect(result.unread).toBe(4)
  })

  it('all 대기(at=100) — createdAt 50 은 읽음, 150 은 안 읽음, unread 1', () => {
    const data: NotificationsResponse = { items: [A, B], unread: 5 }
    const pending: PendingRead[] = [{ kind: 'all', at: 100, settledAt: null }]
    const result = applyPendingReads(data, pending)
    expect(result.items.find((i) => i.id === 'A')?.readAt).not.toBeNull()
    expect(result.items.find((i) => i.id === 'B')?.readAt).toBeNull()
    expect(result.unread).toBe(1)
  })

  it('U9 — 대기 [A] 인데 서버가 이미 A 를 읽음으로 줌 — unread 를 두 번 빼지 않는다', () => {
    const readA = item({ id: 'A', createdAt: 50, readAt: 900 })
    const data: NotificationsResponse = { items: [readA, B], unread: 5 }
    const pending: PendingRead[] = [{ kind: 'ids', ids: ['A'], at: 1000, settledAt: null }]
    const result = applyPendingReads(data, pending)
    expect(result.unread).toBe(5)
  })

  it('dropSettledReads — settledAt 200 인데 시작 199 면 남고, 시작 200 이면 빠진다', () => {
    const pending: PendingRead[] = [{ kind: 'ids', ids: ['A'], at: 1000, settledAt: 200 }]
    expect(dropSettledReads(pending, 199)).toHaveLength(1)
    expect(dropSettledReads(pending, 200)).toHaveLength(0)
  })

  it('끝나지 않은(settledAt null) 대기는 빠지지 않는다', () => {
    const pending: PendingRead[] = [{ kind: 'ids', ids: ['A'], at: 1000, settledAt: null }]
    expect(dropSettledReads(pending, 5000)).toHaveLength(1)
  })
})

describe('F-2111 comment 종류', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('U1: 요청 주소는 etag 와 상관없이 kinds 가 붙은 주소', async () => {
    const data: NotificationsResponse = { items: [], unread: 0 }
    const fake = vi.fn().mockImplementation(async () => new Response(JSON.stringify(data), { status: 200 }))
    globalThis.fetch = fake
    await fetchNotifications(null)
    await fetchNotifications('W/"x"')
    expect(fake.mock.calls[0][0]).toBe('/api/notifications?kinds=mention,reply,comment')
    expect(fake.mock.calls[1][0]).toBe('/api/notifications?kinds=mention,reply,comment')
  })

  it('U2: comment 항목은 통과하고 like 는 null', () => {
    const body = { items: [item({ kind: 'comment' })], unread: 1 }
    expect(readNotificationsResponse(body)).toEqual(body)
    expect(readNotificationsResponse({ items: [item({ kind: 'like' as never })], unread: 1 })).toBeNull()
  })

  it('U3: comment 문구와 빈 제목', () => {
    expect(notificationText(item({ kind: 'comment' }))).toBe('a@x.com님이 "제목"에 댓글을 달았습니다.')
    expect(notificationText(item({ kind: 'comment', docTitle: '' }))).toContain('"제목 없는 문서"')
    expect(notificationText(item({ kind: 'mention' }))).toBe('a@x.com님이 "제목" 댓글에서 멘션했습니다.')
    expect(notificationText(item({ kind: 'reply' }))).toBe('a@x.com님이 "제목"의 댓글에 답글을 달았습니다.')
  })
})
