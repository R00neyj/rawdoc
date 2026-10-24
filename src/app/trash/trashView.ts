// 휴지통 화면 S-10 의 순수 문구 — 행 설명·알림·확인 대화상자 (specs/features/F-2145.md 2장)
import { TRASH_RETENTION_DAYS, type TrashItem } from '../../lib/trash/trash'
import { displayDocTitle } from '../sidebar/docMeta'

const DAY_MS = 24 * 60 * 60 * 1000

export const TRASH_HEAD_NOTE = `${TRASH_RETENTION_DAYS}일이 지나면 영구히 지워집니다.`
export const TRASH_HEAD_NOTE_LOCAL = `이 브라우저에 저장된 문서 · ${TRASH_HEAD_NOTE}`

export const TRASH_STATE_TEXT = {
  loading: '불러오는 중…',
  offline: '인터넷에 연결되어 있지 않아 휴지통을 볼 수 없습니다.',
  failed: '휴지통을 불러오지 못했습니다.',
  empty: '휴지통이 비어 있습니다.',
} as const

export const TRASH_NOTICE = {
  restoreGone: '이미 휴지통에 없는 문서입니다.',
  restoreFailed: '복원하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  purgeFailed: '영구 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  emptyFailed: '휴지통을 비우지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
} as const

export function trashItemTitle(item: TrashItem): string {
  return item.e2ee ? '금고 문서' : displayDocTitle(item.title)
}

function localDayNumber(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS
}

function deletedWhen(deletedAt: number, now: number): string {
  const days = localDayNumber(now) - localDayNumber(deletedAt)
  if (days <= 0) return '오늘'
  if (days === 1) return '어제'
  return `${days}일 전`
}

function remaining(purgeAt: number, now: number): string {
  const n = Math.ceil((purgeAt - now) / DAY_MS)
  return n >= 1 ? `${n}일 남음` : '곧 지워짐'
}

function actorText(deletedBy: string | undefined): string | null {
  if (deletedBy === undefined) return null
  if (deletedBy === 'app') return '앱에서 지움'
  if (deletedBy === 'cli') return 'CLI에서 지움'
  if (deletedBy.startsWith('mcp:')) {
    const name = deletedBy.slice(4)
    return name === '' ? '연결된 앱에서 지움' : `${name}에서 지움`
  }
  return null
}

export function trashRowMeta(item: TrashItem, now: number): string {
  const parts = [item.path ?? '(최상위)', deletedWhen(item.deletedAt, now), remaining(item.purgeAt, now)]
  const actor = actorText(item.deletedBy)
  if (actor) parts.push(actor)
  return parts.join(' · ')
}

export function restoreNotice(title: string, rootFallback: boolean): string {
  return rootFallback ? `"${title}" 을(를) 최상위로 복원했습니다. 원래 폴더가 없습니다.` : `"${title}" 을(를) 복원했습니다.`
}

export const purgeOneNotice = (title: string) => `"${title}" 을(를) 영구히 지웠습니다.`
export const emptiedNotice = (docs: number) => `문서 ${docs}개를 영구히 지웠습니다.`

export const purgeOneConfirm = (title: string) => ({
  title: '영구 삭제',
  message: `"${title}" 을(를) 영구히 지울까요? 되돌릴 수 없습니다.`,
  confirmLabel: '영구 삭제',
})
export const emptyConfirm = (count: number) => ({
  title: '휴지통 비우기',
  message: `휴지통의 문서 ${count}개를 모두 영구히 지울까요? 되돌릴 수 없습니다.`,
  confirmLabel: '비우기',
})

export const GONE_DOC_TEXT = {
  trashed: '휴지통에 있는 문서입니다. 복원하면 열 수 있습니다.',
  deleted: '삭제된 문서입니다.',
} as const

export const DELETE_TRASH_TEXT = {
  doc: (name: string) => `"${name}" 을(를) 휴지통으로 옮길까요? ${TRASH_RETENTION_DAYS}일 뒤 영구히 지워집니다.`,
  folderNote: '전부 삭제하면 안의 문서는 휴지통으로 옮겨집니다. 폴더와 폴더 공유는 되살릴 수 없습니다.',
  bulk: (n: number) => `선택한 ${n}개 항목을 삭제할까요? 문서는 휴지통으로 옮겨지고 ${TRASH_RETENTION_DAYS}일 뒤 영구히 지워집니다.`,
  vaultNotEmpty: '금고 문서나 금고 폴더가 남아 있어 초기화하지 못했습니다. 휴지통에 든 금고 문서가 있으면 먼저 영구 삭제하세요.',
} as const
