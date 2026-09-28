// 실시간 알림 띠 판정 세 가지 — U1~U15 (F-2070 7.1)
import { describe, expect, it } from 'vitest'
import { disconnectedNoticeMessage, isOwnServerDoc, liveStopNoticeBranch } from '../../../src/app/liveNotices'
import { LIVE_NOTICE, READ_ONLY_LIVE_NOTICE } from '../../../src/app/appNotices'

describe('isOwnServerDoc', () => {
  it('U1 서버 저장소의 내 문서(role 없음)면 참', () => {
    expect(isOwnServerDoc('server', { role: undefined }, null)).toBe(true)
  })
  it('U2 role 이 owner 여도 참', () => {
    expect(isOwnServerDoc('server', { role: 'owner' }, null)).toBe(true)
  })
  it('U3 공유받은 문서(edit·view)면 거짓', () => {
    expect(isOwnServerDoc('server', { role: 'edit' }, null)).toBe(false)
    expect(isOwnServerDoc('server', { role: 'view' }, null)).toBe(false)
  })
  it('U4 공유 화면이 열려 있으면 거짓', () => {
    expect(isOwnServerDoc('server', { role: undefined }, { title: 't', content: '', lineEnding: 'lf' })).toBe(false)
  })
  it('U5 서버 저장소가 아니면 거짓', () => {
    expect(isOwnServerDoc('idb', { role: undefined }, null)).toBe(false)
    expect(isOwnServerDoc('memory', { role: undefined }, null)).toBe(false)
  })
  it('U6 currentDoc 이 null 이어도 참 — 지금 식 그대로', () => {
    expect(isOwnServerDoc('server', null, null)).toBe(true)
  })
})

describe('disconnectedNoticeMessage', () => {
  it('U7 편집 세션·영속 정상이면 N5', () => {
    expect(disconnectedNoticeMessage(false, false)).toBe(LIVE_NOTICE.disconnected)
    expect(disconnectedNoticeMessage(false, undefined)).toBe(LIVE_NOTICE.disconnected)
  })
  it('U8 편집 세션·영속 깨짐이면 N5′', () => {
    expect(disconnectedNoticeMessage(false, true)).toBe(LIVE_NOTICE.disconnectedVolatile)
  })
  it('U9 읽기 전용 세션이면 영속과 무관하게 N5v', () => {
    expect(disconnectedNoticeMessage(true, false)).toBe(READ_ONLY_LIVE_NOTICE.disconnected)
    expect(disconnectedNoticeMessage(true, true)).toBe(READ_ONLY_LIVE_NOTICE.disconnected)
  })
})

describe('liveStopNoticeBranch', () => {
  it('U10 읽기 전용 + revoked → read-only-revoked', () => {
    expect(liveStopNoticeBranch('revoked', true)).toBe('read-only-revoked')
  })
  it('U11 읽기 전용 + signed-out → read-only-signed-out', () => {
    expect(liveStopNoticeBranch('signed-out', true)).toBe('read-only-signed-out')
  })
  it('U12 편집 + revoked → revoked', () => {
    expect(liveStopNoticeBranch('revoked', false)).toBe('revoked')
  })
  it('U13 not-found·deleted 는 세션과 무관하게 gone', () => {
    for (const reason of ['not-found', 'deleted'] as const) {
      for (const readOnly of [true, false]) expect(liveStopNoticeBranch(reason, readOnly)).toBe('gone')
    }
  })
  it('U14 편집 + signed-out → signed-out', () => {
    expect(liveStopNoticeBranch('signed-out', false)).toBe('signed-out')
  })
  it('U15 forbidden·read-only·null 은 알림 없음', () => {
    for (const reason of ['forbidden', 'read-only', null] as const) {
      for (const readOnly of [true, false]) expect(liveStopNoticeBranch(reason, readOnly)).toBeNull()
    }
  })
})
