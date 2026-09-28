// App 알림 띠 문구·금고 옮기기 결과 알림 (F-2059 2.3, F-2060)
import type { Notice } from './notice'
import type { E2eeConvertDirection, E2eeConvertOutcome, E2eeConvertStopReason } from '../e2ee/convert'
import { isE2eeStoreError } from '../e2ee/e2eeStore'
import { ACCOUNT_BLOCKED_MESSAGE, formatCount, formatResetTime } from '../lib/usageLimits'

// 읽기 전용 세션의 알림 띠 문구 — N9·N10·N5v (F-506 5.2)
export const READ_ONLY_LIVE_NOTICE = {
  revoked: '이 문서를 볼 수 없게 되어 실시간 연결을 멈췄습니다.',
  signedOut: '로그인이 만료되어 실시간 연결을 멈췄습니다.',
  disconnected: '서버와 연결이 끊겼습니다. 다시 연결되면 최신 내용을 받습니다.',
} as const

// 실시간 알림 띠 문구 (F-305 11.2)
export const LIVE_NOTICE = {
  forbidden: '편집 권한이 없어 읽기만 할 수 있습니다.',
  revoked: '편집 권한이 없어져 읽기만 할 수 있습니다.',
  gone: '이 문서가 삭제되었거나 접근할 수 없게 되었습니다. 지금 화면의 내용은 저장되지 않습니다.',
  signedOut: '로그인이 만료되어 실시간 편집을 멈췄습니다. 지금 화면의 내용은 새 문서로 저장할 수 있습니다.',
  // N5 는 F-301 9.2 원래 문구 그대로, N5′ 는 영속이 없는 세션 — F-305 N5 (F-306 11.2)
  disconnected: '서버와 연결이 끊겼습니다. 편집은 이 브라우저에 저장되고 다시 연결되면 합쳐집니다',
  disconnectedVolatile: '서버와 연결이 끊겼습니다. 다시 연결되면 이어서 저장됩니다. 그 전에 창을 닫으면 끊긴 뒤의 편집은 사라집니다.',
  offlineView: '오프라인에서는 이 문서를 읽기만 할 수 있습니다. 연결되면 편집할 수 있습니다.',
  merged: '연결이 끊긴 동안 한 편집을 합쳤습니다. 같은 곳을 다른 사람도 고쳤다면 문장이 섞였을 수 있습니다',
  tooLarge: '문서가 1MB 를 넘어 서버에 저장되지 않습니다. 내용을 줄이거나 문서를 나눠 주세요',
} as const

// 금고 문서 알림 (F-405 8장)
export const E2EE_NOTICE = {
  folderRule: '금고 폴더에는 금고 문서와 금고 폴더만 넣을 수 있습니다.',
  locked: '금고가 잠겨 있어 저장하지 못했습니다. 금고를 연 뒤 다시 해 주세요.',
  unavailable: '금고 정보를 불러오지 못해 금고 폴더에 문서를 만들지 못했습니다.',
  tooManyRefs: '금고 문서 하나에는 이미지를 1,000개까지 넣을 수 있습니다. 이미지를 줄여야 저장됩니다.',
  createTooLarge: '문서가 너무 커서 금고에 넣을 수 없습니다(금고 문서는 약 750KB까지).',
  saveTooLarge: '금고 문서가 약 750KB를 넘어 저장하지 못했습니다. 내용을 줄이거나 문서를 나눠 주세요.',
} as const

// 금고로 옮기기·빼기 알림 (F-407 8장)
export const E2EE_CONVERT_NOTICE = {
  offline: '금고로 옮기거나 빼려면 인터넷에 연결해야 합니다.',
  busy: '금고 옮기기가 진행 중입니다. 끝나거나 멈춘 뒤 다시 누르세요.',
  insideFolder: '금고 폴더 안의 문서는 폴더째 빼야 합니다. 폴더의 ⋯ 메뉴에서 금고에서 빼기…를 고르세요.',
} as const

export const E2EE_CONVERT_STOP_REASON: Record<Exclude<E2eeConvertStopReason, 'cancelled' | 'day-limit' | 'account-blocked'>, string> = {
  offline: '인터넷 연결이 끊겼습니다.',
  'rate-limited': '요청이 계속 거절되었습니다. 잠시 뒤 다시 누르세요.',
  'doc-quota': '계정의 문서 저장 공간이 모자랍니다. 금고 문서는 암호화로 약 1.34배 커집니다.',
  'attachment-quota': '이미지 저장 공간(300MB)이 모자랍니다.',
  locked: '금고가 잠겼습니다. 금고를 연 뒤 다시 누르세요.',
  conflict: '다른 곳에서 먼저 바뀐 문서가 있습니다.',
  'pending-sync': '아직 서버에 올리지 못한 편집이 있는 문서가 있습니다. 저장이 끝난 뒤 다시 누르세요.',
  'attachment-too-large': '암호화하면 5MB를 넘는 이미지가 있습니다. 그 이미지를 줄여 다시 넣은 뒤 다시 누르세요.',
  'not-ready': '다른 곳에서 폴더에 새 문서가 생겼습니다.',
  'too-large': '약 750KB를 넘는 문서가 있습니다.',
  failed: '저장하지 못했습니다.',
}

export function e2eeConvertProgressText(direction: E2eeConvertDirection, done: number, total: number): string {
  return `${direction === 'to-e2ee' ? '금고로 옮기는 중…' : '금고에서 빼는 중…'} ${formatCount(done)}/${formatCount(total)}`
}

// 끝·멈춤 알림 — 문장을 한 칸에 이어 붙인다(알림 띠가 한 칸이라서, F-407 7.5)
export function e2eeConvertResultNotice(outcome: E2eeConvertOutcome, direction: E2eeConvertDirection, targetKind: 'doc' | 'folder', name: string): Notice {
  const toE2ee = direction === 'to-e2ee'
  const parts: string[] = []
  let warn = false
  if (outcome.kind === 'done') {
    const count = formatCount(outcome.done)
    if (toE2ee) parts.push(targetKind === 'doc' ? `"${name}"을(를) 금고로 옮겼습니다.` : `"${name}" 폴더를 금고로 옮겼습니다(문서 ${count}개).`)
    else parts.push(targetKind === 'doc' ? `"${name}"을(를) 금고에서 뺐습니다.` : `"${name}" 폴더를 금고에서 뺐습니다(문서 ${count}개).`)
    if (outcome.keptAttachments > 0) {
      const k = formatCount(outcome.keptAttachments)
      parts.push(toE2ee ? `다른 문서가 쓰는 이미지 ${k}개는 암호화하지 않은 원본도 서버에 남아 있습니다.` : `다른 금고 문서가 쓰는 이미지 ${k}개는 암호화한 원본도 남겨 두었습니다.`)
      warn = true
    }
  } else {
    const n = formatCount(outcome.done)
    const total = formatCount(outcome.total)
    parts.push(toE2ee ? `${n}/${total}개를 옮기고 멈췄습니다. 다시 누르면 남은 것부터 이어 옮깁니다.` : `${n}/${total}개를 빼고 멈췄습니다. 다시 누르면 남은 것부터 이어 뺍니다.`)
    if (outcome.reason === 'day-limit') parts.push(`오늘 저장 한도에 닿았습니다. ${formatResetTime(outcome.resetAt ?? Date.now())}부터 다시 누를 수 있습니다.`)
    else if (outcome.reason === 'account-blocked') parts.push(ACCOUNT_BLOCKED_MESSAGE)
    else if (outcome.reason !== 'cancelled') parts.push(E2EE_CONVERT_STOP_REASON[outcome.reason])
    warn = outcome.reason !== 'cancelled'
  }
  if (outcome.purgeFailed > 0) {
    const k = formatCount(outcome.purgeFailed)
    parts.push(toE2ee ? `서버의 실시간 편집 기록 ${k}건을 지우지 못해, 옮기기 전 내용이 그 기록에 남아 있을 수 있습니다.` : `서버의 옛 실시간 편집 기록 ${k}건을 지우지 못했습니다.`)
    warn = true
  }
  return { type: warn ? 'warn' : 'info', message: parts.join(' ') }
}

// 새 금고 문서를 만들다 난 오류 → 알림 문구, 금고 오류가 아니면 null (F-405 7.6)
export function e2eeCreateErrorMessage(err: unknown): string | null {
  if (isE2eeStoreError(err, 'locked')) return E2EE_NOTICE.locked
  if (isE2eeStoreError(err, 'too-large')) return E2EE_NOTICE.createTooLarge
  if (isE2eeStoreError(err, 'too-many-refs')) return E2EE_NOTICE.tooManyRefs
  return null
}
