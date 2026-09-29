// 탭 사이 알림 결과 메시지 — 모양 검사·더 새 결과 판정·상수 (specs/features/F-2057.md 4.2, U14~U16)
import { describe, expect, it } from 'vitest'
import { NOTIFICATIONS_CHANNEL_NAME, NOTIFICATIONS_FOLLOWER_DELAY_MS, isNewerStart, readNotificationsShare } from '../../../src/app/notificationsShare'
import { NOTIFICATIONS_POLL_MS } from '../../../src/app/notificationsApi'

function message(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'notifications-result',
    v: 1,
    tabId: 't1',
    accountId: 'u1',
    startedAt: 1000,
    etag: 'W/"n1-u1-0-30"',
    data: {
      items: [
        {
          id: 'n1',
          kind: 'mention',
          docId: 'd1',
          commentId: 'c1',
          threadId: 'c1',
          actorEmail: 'a@x.com',
          docTitle: '제목',
          excerpt: '발췌',
          createdAt: 1,
          readAt: null,
        },
      ],
      unread: 1,
    },
    ...over,
  }
}

describe('U14 readNotificationsShare', () => {
  it('올바른 것은 통과, etag null 도 통과', () => {
    expect(readNotificationsShare(message())).toEqual(message())
    expect(readNotificationsShare(message({ etag: null }))).toEqual(message({ etag: null }))
  })

  it('키 하나 더·빠짐·v 2·빈 accountId·빈 tabId·data 모양 틀림·시각 아님 → null', () => {
    const missing = message()
    delete missing.etag
    const bad: unknown[] = [
      message({ extra: 1 }),
      missing,
      message({ v: 2 }),
      message({ kind: 'other' }),
      message({ accountId: '' }),
      message({ tabId: '' }),
      message({ accountId: 5 }),
      message({ data: { items: [] } }),
      message({ data: { items: [{ id: 'x' }], unread: 1 } }),
      message({ startedAt: Number.NaN }),
      message({ startedAt: '1' }),
      message({ etag: 3 }),
      null,
      'x',
      [],
    ]
    for (const raw of bad) expect(readNotificationsShare(raw), JSON.stringify(raw)).toBeNull()
  })
})

describe('U15 isNewerStart', () => {
  it('시각 큰 쪽, 같으면 탭 id 큰 쪽, 자기 자신은 거짓', () => {
    expect(isNewerStart({ startedAt: 2, tabId: 'a' }, { startedAt: 1, tabId: 'z' })).toBe(true)
    expect(isNewerStart({ startedAt: 1, tabId: 'z' }, { startedAt: 2, tabId: 'a' })).toBe(false)
    expect(isNewerStart({ startedAt: 1, tabId: 'b' }, { startedAt: 1, tabId: 'a' })).toBe(true)
    expect(isNewerStart({ startedAt: 1, tabId: 'a' }, { startedAt: 1, tabId: 'b' })).toBe(false)
    const self = { startedAt: 5, tabId: 'x' }
    expect(isNewerStart(self, self)).toBe(false)
  })
})

describe('U16 상수', () => {
  it('채널 이름·뒤따르는 지연·폴링 주기', () => {
    expect(NOTIFICATIONS_CHANNEL_NAME).toBe('md-notifications')
    expect(NOTIFICATIONS_FOLLOWER_DELAY_MS).toBe(10_000)
    expect(NOTIFICATIONS_POLL_MS).toBe(60_000)
  })
})
