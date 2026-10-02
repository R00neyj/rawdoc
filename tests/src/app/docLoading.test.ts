import { describe, it, expect } from 'vitest'
import { isDocLoading, type DocLoadingInput } from '../../../src/app/docLoading'

const base: DocLoadingInput = {
  currentDocId: 'a',
  openDocId: null,
  sharedScreen: false,
  e2eeLocked: false,
  offlineView: false,
  liveStopped: false,
  deletedElsewhere: false,
}

describe('isDocLoading — 문서를 골랐는데 본문이 아직 안 올라온 동안', () => {
  it('문서를 골랐고 본문이 없으면 로딩 중이다', () => {
    expect(isDocLoading(base)).toBe(true)
  })

  it('다른 문서 본문이 남아 있어도 로딩 중이다', () => {
    expect(isDocLoading({ ...base, openDocId: 'old' })).toBe(true)
  })

  it('본문이 올라왔으면 아니다', () => {
    expect(isDocLoading({ ...base, openDocId: 'a' })).toBe(false)
  })

  it('문서를 고르지 않았으면 아니다', () => {
    expect(isDocLoading({ ...base, currentDocId: null })).toBe(false)
  })

  it.each([
    ['공유 화면', { sharedScreen: true }],
    ['잠긴 금고 문서', { e2eeLocked: true }],
    ['오프라인 보기(캐시 없음)', { offlineView: true }],
    ['실시간 연결이 멈춤', { liveStopped: true }],
    ['다른 곳에서 지워짐', { deletedElsewhere: true }],
  ] as const)('%s 이면 끝내 안 열릴 수 있어 아니다', (_name, patch) => {
    expect(isDocLoading({ ...base, ...patch })).toBe(false)
  })
})
