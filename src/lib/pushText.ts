// 푸시 알림 문구와 알림 제목·발췌 자르기 — Worker·앱 공용 (specs/features/F-3002.md 5장)
import { PUSH_EXCERPT_CHARS, type PushPayload } from './pushPayload'
import { formatCount, formatMegabytes } from './usageLimits'
import type { NotificationKind } from './docComments'

export const NOTIFICATION_TITLE_MAX = 40 // 문구 안 문서 제목 (코드 포인트)

function clip(text: string, max: number): string {
  const chars = [...text]
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : text
}

export function formatNotificationTitle(docTitle: string): string {
  const trimmed = docTitle.trim()
  if (trimmed === '') return '제목 없는 문서'
  const chars = [...trimmed]
  if (chars.length > NOTIFICATION_TITLE_MAX) return chars.slice(0, NOTIFICATION_TITLE_MAX - 1).join('') + '…'
  return trimmed
}

function formatFolderName(name: string): string {
  const trimmed = name.trim()
  if (trimmed === '') return '이름 없는 폴더'
  return clip(trimmed, NOTIFICATION_TITLE_MAX)
}

export function notificationExcerptLine(excerpt: string): string {
  return excerpt.replace(/\r\n|\r|\n/g, ' ').trim()
}

export function formatPushExcerpt(excerpt: string): string {
  return clip(notificationExcerptLine(excerpt), PUSH_EXCERPT_CHARS)
}

export type PushCommentKind = NotificationKind
export type PushCommentRow = { kind: PushCommentKind; actorEmail: string; docTitle: string; excerpt: string; threadId: string; createdAt: number }
export type PushShare = { actorEmail: string; target: 'doc' | 'folder'; targetId: string; name: string; role: 'view' | 'edit' }
export type PushQuota = { images?: { used: number; limit: number }; docBytes?: { used: number; limit: number }; docCount?: { used: number; limit: number } }

const COMMENT_TITLE: Record<PushCommentKind, string> = {
  mention: '님이 멘션했습니다',
  reply: '님이 답글을 달았습니다',
  comment: '님이 댓글을 달았습니다',
}

const ROLE_LABEL = { view: '보기', edit: '편집' } as const // InviteDialog.tsx ROLE_LABEL 과 같은 값

export function commentPushPayload(docId: string, rows: readonly PushCommentRow[]): PushPayload {
  if (rows.length === 0) throw new Error('commentPushPayload: rows 가 비었다')
  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt)
  const last = sorted[sorted.length - 1]
  const title = formatNotificationTitle(last.docTitle)
  const excerpt = formatPushExcerpt(last.excerpt)
  const url = (threadId: string) => `/#/d/${docId}/c/${threadId}`
  if (sorted.length === 1) {
    return {
      v: 1,
      title: `${last.actorEmail}${COMMENT_TITLE[last.kind]}`,
      body: excerpt === '' ? `"${title}"` : `"${title}" · ${excerpt}`,
      tag: `doc:${docId}`,
      url: url(last.threadId),
    }
  }
  const firstMention = sorted.find((r) => r.kind === 'mention')
  const tail = excerpt === '' ? last.actorEmail : `${last.actorEmail}: ${excerpt}`
  return {
    v: 1,
    title: `"${title}"에 새 댓글 ${sorted.length}개`,
    body: firstMention ? `멘션 포함 · ${tail}` : tail,
    tag: `doc:${docId}`,
    url: url((firstMention ?? sorted[0]).threadId),
  }
}

export function sharePushPayload(share: PushShare): PushPayload {
  const role = `${ROLE_LABEL[share.role]} 권한`
  if (share.target === 'doc') {
    return {
      v: 1,
      title: `${share.actorEmail}님이 문서를 공유했습니다`,
      body: `"${formatNotificationTitle(share.name)}" · ${role}`,
      tag: `share:${share.targetId}`,
      url: `/#/d/${share.targetId}`,
    }
  }
  return {
    v: 1,
    title: `${share.actorEmail}님이 폴더를 공유했습니다`,
    body: `"${formatFolderName(share.name)}" · ${role}`,
    tag: `share:${share.targetId}`,
    url: '/#/',
  }
}

export function quotaPushPayload(quota: PushQuota): PushPayload {
  const parts: string[] = []
  if (quota.images) parts.push(`이미지 ${formatMegabytes(quota.images.used)} / ${formatMegabytes(quota.images.limit)}`)
  if (quota.docBytes) parts.push(`문서 ${formatMegabytes(quota.docBytes.used)} / ${formatMegabytes(quota.docBytes.limit)}`)
  if (quota.docCount) parts.push(`문서 ${formatCount(quota.docCount.used)}개 / ${formatCount(quota.docCount.limit)}개`)
  if (parts.length === 0) throw new Error('quotaPushPayload: 항목이 없다')
  return { v: 1, title: '저장 공간이 거의 찼습니다', body: parts.join(' · '), tag: 'quota', url: '/#/' }
}

export function testPushPayload(): PushPayload {
  return { v: 1, title: '테스트 알림', body: '이 기기에서 푸시 알림을 받을 수 있습니다.', tag: 'test', url: '/#/' }
}
