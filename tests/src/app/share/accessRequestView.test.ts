import { describe, it, expect } from 'vitest'
import { accessControlView, accessRequestErrorMessage } from '../../../../src/app/share/accessRequestView'
import type { AccessRequestStatus } from '../../../../src/lib/share/accessRequest'

const base: AccessRequestStatus = { target: 'doc', owner: false, memberRole: null, targetId: null, request: null }

function ymd(ms: number) {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('accessControlView', () => {
  it('null 이면 둘 다 없다', () => {
    expect(accessControlView(null)).toEqual({ openHref: null, request: null })
  })

  it('주인·편집 권한은 openHref 만', () => {
    expect(accessControlView({ ...base, owner: true, targetId: 'd1' })).toEqual({ openHref: '/?app=1#/d/d1', request: null })
    expect(accessControlView({ ...base, memberRole: 'edit', targetId: 'd1' })).toEqual({ openHref: '/?app=1#/d/d1', request: null })
  })

  it('보기 권한은 openHref + 편집만 고르는 form', () => {
    expect(accessControlView({ ...base, memberRole: 'view', targetId: 'd1' })).toEqual({
      openHref: '/?app=1#/d/d1',
      request: { mode: 'form', roles: ['edit'] },
    })
  })

  it('권한 없음이면 보기·편집 form', () => {
    expect(accessControlView(base)).toEqual({ openHref: null, request: { mode: 'form', roles: ['view', 'edit'] } })
  })

  it('대기·거절은 그 mode', () => {
    expect(accessControlView({ ...base, request: { state: 'pending', role: 'view', retryAt: null } }).request).toEqual({ mode: 'pending', role: 'view' })
    expect(accessControlView({ ...base, request: { state: 'rejected', role: 'edit', retryAt: 99 } }).request).toEqual({ mode: 'rejected', retryAt: 99 })
  })

  it('보기 회원의 편집 대기면 openHref 도 있다', () => {
    expect(accessControlView({ ...base, memberRole: 'view', targetId: 'd1', request: { state: 'pending', role: 'edit', retryAt: null } })).toEqual({
      openHref: '/?app=1#/d/d1',
      request: { mode: 'pending', role: 'edit' },
    })
  })

  it('폴더 링크의 openHref 는 앱 첫 화면', () => {
    expect(accessControlView({ ...base, target: 'folder', memberRole: 'edit', targetId: 'f1' }).openHref).toBe('/?app=1#/')
  })
})

describe('accessRequestErrorMessage', () => {
  it('오류 값마다 문구', () => {
    expect(accessRequestErrorMessage('gone', null)).toBe('링크가 끊겨 권한을 요청할 수 없습니다.')
    expect(accessRequestErrorMessage('already_member', null)).toBe('이미 이 권한이 있습니다.')
    expect(accessRequestErrorMessage('too_many_pending', null)).toBe('기다리는 요청이 너무 많습니다. 보낸 요청이 처리된 뒤 다시 시도해 주세요.')
    expect(accessRequestErrorMessage('owner_full', null)).toBe('소유자가 받은 요청이 많아 지금은 보낼 수 없습니다.')
    expect(accessRequestErrorMessage('blocked', null)).toBe('계정이 제한되어 요청할 수 없습니다.')
    expect(accessRequestErrorMessage('rate_limited', null)).toBe('요청을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
    expect(accessRequestErrorMessage('failed', null)).toBe('요청을 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  })

  it('cooldown 은 지역 시간 날짜', () => {
    const at = new Date(2026, 9, 19, 23, 30).getTime()
    expect(accessRequestErrorMessage('cooldown', at)).toBe(`${ymd(at)}부터 다시 요청할 수 있습니다.`)
    expect(accessRequestErrorMessage('cooldown', at)).toBe('2026-10-19부터 다시 요청할 수 있습니다.')
  })
})
