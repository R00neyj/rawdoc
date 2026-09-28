import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  E2EE_NOTICE,
  E2EE_CONVERT_STOP_REASON,
  e2eeConvertProgressText,
  e2eeConvertResultNotice,
  e2eeCreateErrorMessage,
} from '../../../src/app/appNotices'
import { E2eeStoreError } from '../../../src/e2ee/e2eeStore'
import { ACCOUNT_BLOCKED_MESSAGE, formatResetTime } from '../../../src/lib/usageLimits'
import type { E2eeConvertOutcome, E2eeConvertStopReason } from '../../../src/e2ee/convert'

const done = (o: Partial<{ done: number; keptAttachments: number; purgeFailed: number }> = {}): E2eeConvertOutcome => ({
  kind: 'done',
  done: 1,
  keptAttachments: 0,
  purgeFailed: 0,
  ...o,
})
const stopped = (reason: E2eeConvertStopReason, o: Partial<{ done: number; total: number; resetAt: number; purgeFailed: number }> = {}): E2eeConvertOutcome => ({
  kind: 'stopped',
  done: 2,
  total: 5,
  reason,
  purgeFailed: 0,
  ...o,
})
const STOP_TO = '2/5개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 이어 옮깁니다.'

describe('e2eeConvertProgressText', () => {
  it('U1 금고로 옮기는 중, 천 단위 구분', () => {
    expect(e2eeConvertProgressText('to-e2ee', 3, 1234)).toBe('금고로 옮기는 중… 3/1,234')
  })
  it('U2 금고에서 빼는 중', () => {
    expect(e2eeConvertProgressText('from-e2ee', 0, 2)).toBe('금고에서 빼는 중… 0/2')
  })
})

describe('e2eeConvertResultNotice', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('U3 옮기기 완료, 문서', () => {
    expect(e2eeConvertResultNotice(done(), 'to-e2ee', 'doc', '메모')).toEqual({ type: 'info', message: '"메모"을(를) 금고로 옮겼습니다.' })
  })
  it('U4 옮기기 완료, 폴더', () => {
    expect(e2eeConvertResultNotice(done({ done: 1234 }), 'to-e2ee', 'folder', '일')).toEqual({
      type: 'info',
      message: '"일" 폴더를 금고로 옮겼습니다(문서 1,234개).',
    })
  })
  it('U5 빼기 완료, 문서·폴더', () => {
    expect(e2eeConvertResultNotice(done(), 'from-e2ee', 'doc', '메모')).toEqual({ type: 'info', message: '"메모"을(를) 금고에서 뺐습니다.' })
    expect(e2eeConvertResultNotice(done({ done: 2 }), 'from-e2ee', 'folder', '일')).toEqual({
      type: 'info',
      message: '"일" 폴더를 금고에서 뺐습니다(문서 2개).',
    })
  })
  it('U6 옮기기, 남긴 이미지', () => {
    expect(e2eeConvertResultNotice(done({ keptAttachments: 3 }), 'to-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: '"메모"을(를) 금고로 옮겼습니다. 다른 문서가 쓰는 이미지 3개는 암호화하지 않은 원본도 서버에 남아 있습니다.',
    })
  })
  it('U7 빼기, 남긴 이미지', () => {
    expect(e2eeConvertResultNotice(done({ keptAttachments: 3 }), 'from-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: '"메모"을(를) 금고에서 뺐습니다. 다른 금고 문서가 쓰는 이미지 3개는 암호화한 원본도 남겨 두었습니다.',
    })
  })
  it('U8 옮기기 취소', () => {
    expect(e2eeConvertResultNotice(stopped('cancelled'), 'to-e2ee', 'doc', '메모')).toEqual({ type: 'info', message: STOP_TO })
  })
  it('U9 빼기 취소', () => {
    expect(e2eeConvertResultNotice(stopped('cancelled'), 'from-e2ee', 'doc', '메모')).toEqual({
      type: 'info',
      message: '2/5개를 빼고 멈췄습니다. 다시 누르면 남은 것부터 이어 뺍니다.',
    })
  })
  it('U10 하루 한도, resetAt 있음', () => {
    const resetAt = Date.UTC(2026, 8, 29)
    expect(e2eeConvertResultNotice(stopped('day-limit', { resetAt }), 'to-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: `${STOP_TO} 오늘 저장 한도에 닿았습니다. ${formatResetTime(resetAt)}부터 다시 누를 수 있습니다.`,
    })
  })
  it('U11 하루 한도, resetAt 없음이면 지금 시각', () => {
    vi.useFakeTimers()
    const now = Date.UTC(2026, 8, 28, 3, 4, 5)
    vi.setSystemTime(now)
    expect(e2eeConvertResultNotice(stopped('day-limit'), 'to-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: `${STOP_TO} 오늘 저장 한도에 닿았습니다. ${formatResetTime(now)}부터 다시 누를 수 있습니다.`,
    })
  })
  it('U12 계정 차단', () => {
    expect(e2eeConvertResultNotice(stopped('account-blocked'), 'to-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: `${STOP_TO} ${ACCOUNT_BLOCKED_MESSAGE}`,
    })
  })
  it('U13 나머지 멈춤 사유 11개', () => {
    const keys = Object.keys(E2EE_CONVERT_STOP_REASON) as (keyof typeof E2EE_CONVERT_STOP_REASON)[]
    expect(keys).toHaveLength(11)
    for (const key of keys) {
      expect(e2eeConvertResultNotice(stopped(key), 'to-e2ee', 'doc', '메모')).toEqual({
        type: 'warn',
        message: `${STOP_TO} ${E2EE_CONVERT_STOP_REASON[key]}`,
      })
    }
  })
  it('U14 옮기기, 기록 삭제 실패', () => {
    expect(e2eeConvertResultNotice(done({ purgeFailed: 2 }), 'to-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: '"메모"을(를) 금고로 옮겼습니다. 서버의 실시간 편집 기록 2건을 지우지 못해, 옮기기 전 내용이 그 기록에 남아 있을 수 있습니다.',
    })
  })
  it('U15 빼기, 기록 삭제 실패', () => {
    expect(e2eeConvertResultNotice(done({ purgeFailed: 2 }), 'from-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: '"메모"을(를) 금고에서 뺐습니다. 서버의 옛 실시간 편집 기록 2건을 지우지 못했습니다.',
    })
  })
  it('U16 취소여도 기록 삭제 실패면 경고', () => {
    expect(e2eeConvertResultNotice(stopped('cancelled', { purgeFailed: 1 }), 'to-e2ee', 'doc', '메모')).toEqual({
      type: 'warn',
      message: `${STOP_TO} 서버의 실시간 편집 기록 1건을 지우지 못해, 옮기기 전 내용이 그 기록에 남아 있을 수 있습니다.`,
    })
  })
  it('U17 완료 → 이미지 → 기록 순서', () => {
    expect(e2eeConvertResultNotice(done({ done: 4, keptAttachments: 1, purgeFailed: 1 }), 'to-e2ee', 'folder', '일')).toEqual({
      type: 'warn',
      message:
        '"일" 폴더를 금고로 옮겼습니다(문서 4개). 다른 문서가 쓰는 이미지 1개는 암호화하지 않은 원본도 서버에 남아 있습니다. 서버의 실시간 편집 기록 1건을 지우지 못해, 옮기기 전 내용이 그 기록에 남아 있을 수 있습니다.',
    })
  })
})

describe('e2eeCreateErrorMessage', () => {
  it('U18 잠김', () => {
    expect(e2eeCreateErrorMessage(new E2eeStoreError('locked'))).toBe(E2EE_NOTICE.locked)
  })
  it('U19 너무 큼·이미지 너무 많음', () => {
    expect(e2eeCreateErrorMessage(new E2eeStoreError('too-large'))).toBe(E2EE_NOTICE.createTooLarge)
    expect(e2eeCreateErrorMessage(new E2eeStoreError('too-many-refs'))).toBe(E2EE_NOTICE.tooManyRefs)
  })
  it('U20 그 밖은 null', () => {
    expect(e2eeCreateErrorMessage(new E2eeStoreError('e2ee-folder'))).toBeNull()
    expect(e2eeCreateErrorMessage(new Error('x'))).toBeNull()
    expect(e2eeCreateErrorMessage('locked')).toBeNull()
    expect(e2eeCreateErrorMessage(null)).toBeNull()
  })
})
