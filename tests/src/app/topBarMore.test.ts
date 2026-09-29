import { describe, expect, it } from 'vitest'
import { moreDotVisible, moreSheetItems, topBarScreen } from '../../../src/app/topBarMore'

const base = { bootPhase: 'ready' as const, currentDocId: 'd1', sharedDoc: false, sharesOpen: false, helpOpen: false, mapRoute: false }

describe('F-2083 A1 topBarScreen', () => {
  it('문서 있음·다른 화면 없음 → doc', () => {
    expect(topBarScreen(base)).toBe('doc')
  })
  it('문서 없음 → home', () => {
    expect(topBarScreen({ ...base, currentDocId: null })).toBe('home')
  })
  it('다른 화면이 켜지면 문서가 있어도 other', () => {
    expect(topBarScreen({ ...base, sharedDoc: true })).toBe('other')
    expect(topBarScreen({ ...base, sharesOpen: true })).toBe('other')
    expect(topBarScreen({ ...base, helpOpen: true })).toBe('other')
    expect(topBarScreen({ ...base, mapRoute: true })).toBe('other')
    expect(topBarScreen({ ...base, currentDocId: null, helpOpen: true })).toBe('other')
  })
  it('부팅 중 → other', () => {
    expect(topBarScreen({ ...base, bootPhase: 'booting' })).toBe('other')
    expect(topBarScreen({ ...base, bootPhase: 'booting', currentDocId: null })).toBe('other')
  })
})

describe('F-2083 A2 moreSheetItems', () => {
  const all = { screen: 'doc' as const, hasOutline: true, comments: true, notifications: true }
  it('doc 전부 → 7개 순서 그대로', () => {
    expect(moreSheetItems(all)).toEqual(['outline', 'comments', 'share', 'export', 'notifications', 'account', 'settings', 'help', 'guides'])
  })
  it('doc 제목 없음 → outline 빠짐', () => {
    expect(moreSheetItems({ ...all, hasOutline: false })).not.toContain('outline')
  })
  it('doc 댓글 없음 → comments 빠짐', () => {
    expect(moreSheetItems({ ...all, comments: false })).not.toContain('comments')
  })
  it('알림 꺼짐 → notifications 빠짐', () => {
    expect(moreSheetItems({ ...all, notifications: false })).not.toContain('notifications')
  })
  it('home', () => {
    expect(moreSheetItems({ ...all, screen: 'home' })).toEqual(['notifications', 'account', 'settings', 'help', 'guides'])
    expect(moreSheetItems({ ...all, screen: 'home', notifications: false })).toEqual(['account', 'settings', 'help', 'guides'])
  })
  it('other', () => {
    expect(moreSheetItems({ ...all, screen: 'other' })).toEqual(['notifications', 'account', 'settings', 'help', 'guides'])
  })
})

describe('F-2086 A5 팔레트 행 없음', () => {
  it('어느 입력에서도 palette 없음', () => {
    for (const screen of ['doc', 'home', 'other'] as const) {
      expect(moreSheetItems({ screen, hasOutline: true, comments: true, notifications: true })).not.toContain('palette')
    }
  })
})

describe('F-2083 A3 moreDotVisible', () => {
  it('unread 1 → 참', () => {
    expect(moreDotVisible({ screen: 'home', unread: 1, commentsOpenCount: null })).toBe(true)
  })
  it('unread 0·null 이고 댓글 0 → 거짓', () => {
    expect(moreDotVisible({ screen: 'doc', unread: 0, commentsOpenCount: 0 })).toBe(false)
    expect(moreDotVisible({ screen: 'doc', unread: null, commentsOpenCount: 0 })).toBe(false)
  })
  it('doc 에서 댓글 1 → 참', () => {
    expect(moreDotVisible({ screen: 'doc', unread: 0, commentsOpenCount: 1 })).toBe(true)
  })
  it('other·home 에서 댓글만 있으면 거짓', () => {
    expect(moreDotVisible({ screen: 'other', unread: 0, commentsOpenCount: 1 })).toBe(false)
    expect(moreDotVisible({ screen: 'home', unread: 0, commentsOpenCount: 1 })).toBe(false)
  })
  it('둘 다 null → 거짓', () => {
    expect(moreDotVisible({ screen: 'doc', unread: null, commentsOpenCount: null })).toBe(false)
  })
})

describe('F-2085 A2 home 행 없음', () => {
  it('어느 입력에서도 home 이 없다', () => {
    for (const screen of ['doc', 'home', 'other'] as const) {
      for (const notifications of [true, false]) {
        const items: string[] = moreSheetItems({ screen, hasOutline: true, comments: true, notifications })
        expect(items).not.toContain('home')
      }
    }
  })
})
