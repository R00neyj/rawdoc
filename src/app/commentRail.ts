// 댓글 레일·판 순수 함수 — 권한·정렬·판정·시각. DOM·React 없음 (specs/features/F-505.md 3.1)
import type { CommentActor, CommentAuthor } from '../lib/docComments'
import type { DocPathKind } from './docPath'

export const COMMENT_RAIL_WIDTH = 280 // px (F-500 4.3)
export const COMMENT_RAIL_MIN_MAIN = 968 // px, 메인 열 폭이 이 값 이상이면 레일 (640 + 280 + 48)
export const COMMENT_CONTENT_SIDE_GAP = 48 // px, 레일이 있을 때 본문 좌우 여백 합
export const COMMENT_CARD_GAP = 8 // px, 카드 사이
export const COMMENT_SHEET_HEIGHT = 0.6 // 창 높이 비율
export const COMMENT_BODY_COUNTER_FROM = 900 // 글자 수 표시가 보이기 시작하는 길이

export type CommentAccess =
  | { kind: 'none' } // 댓글 UI 가 아예 없다 — 금고 문서, 공유 링크 화면
  | { kind: 'loading' } // 경로 판정 전 — 레일에 `불러오는 중…`
  | { kind: 'unavailable' } // 이 경로에서는 못 본다 — 레일에 C8
  | { kind: 'read' } // 보기만 — 달기·답글·해결·삭제 없음
  | { kind: 'write'; via: 'direct'; actor: CommentActor; author: CommentAuthor }
// F-506 이 { kind: 'write'; via: 'command'; … } 갈래를 더한다

export type CommentAccessInput = {
  storeKind: 'idb' | 'memory' | 'server'
  docPath: DocPathKind | null // App 의 docPath (세션 판정 전이면 null)
  e2ee: boolean // currentDoc?.e2ee !== undefined || docPath === 'e2ee'
  sharedScreen: boolean // 공유 링크 화면 S-4
  role: 'owner' | 'edit' | 'view' | undefined
  account: { id: string; email: string; blocked: boolean } | null
  readOnly: boolean // App 의 isReadOnlyDoc
}

// 4장 표와 같은 내용 — 위에서부터 처음 맞는 줄
export function commentAccess(input: CommentAccessInput): CommentAccess {
  if (input.sharedScreen || input.e2ee) return { kind: 'none' }
  if (input.docPath === null) return { kind: 'loading' }
  if (input.docPath === 'local') {
    if (input.readOnly) return { kind: 'read' }
    return { kind: 'write', via: 'direct', actor: { kind: 'local', canEdit: true }, author: { id: null, email: null } }
  }
  if (input.docPath === 'realtime' && input.role !== 'view' && input.account && !input.account.blocked) {
    if (input.readOnly) return { kind: 'read' }
    return {
      kind: 'write',
      via: 'direct',
      actor: { kind: 'server', userId: input.account.id, role: input.role ?? 'owner', blocked: false },
      author: { id: input.account.id, email: input.account.email },
    }
  }
  return { kind: 'unavailable' }
}

export type RailCardInput = { id: string; anchorTop: number; height: number }

// 활성 없음 식 — 위에서부터 top[i] = max(base[i], minTop, 앞 카드 아랫변 + gap)
function stackForward(base: readonly number[], heights: readonly number[], gap: number, minTop: number): number[] {
  const n = base.length
  const tops = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const prevBottom = i > 0 ? tops[i - 1] + heights[i - 1] + gap : -Infinity
    tops[i] = Math.max(base[i], minTop, prevBottom)
  }
  return tops
}

export function layoutRailCards(
  cards: readonly RailCardInput[], // 문서 위치순 (CommentLayout.anchored 순서, 입력 카드는 3.1 끝 규칙대로 끼운다)
  activeId: string | null,
  gap: number,
  minTop: number,
): number[] {
  const n = cards.length
  if (n === 0) return []
  const anchors = cards.map((c) => c.anchorTop)
  const heights = cards.map((c) => c.height)
  const activeIndex = activeId === null ? -1 : cards.findIndex((c) => c.id === activeId)

  if (activeIndex === -1) return stackForward(anchors, heights, gap, minTop)

  const tops = new Array<number>(n)
  tops[activeIndex] = Math.max(anchors[activeIndex], minTop)
  for (let i = activeIndex + 1; i < n; i++) {
    tops[i] = Math.max(anchors[i], tops[i - 1] + heights[i - 1] + gap)
  }
  for (let i = activeIndex - 1; i >= 0; i--) {
    tops[i] = Math.min(anchors[i], tops[i + 1] - gap - heights[i])
  }
  // 맨 앞 카드가 minTop 보다 위로 나가면 맨 앞부터 활성 없음 식을 한 번 더 — 활성 카드도 밀린다
  if (tops[0] < minTop) return stackForward(tops, heights, gap, minTop)
  return tops
}

export function commentRailMode(mainWidth: number): 'rail' | 'sheet' {
  return mainWidth >= COMMENT_RAIL_MIN_MAIN ? 'rail' : 'sheet'
}

export function initialCommentRailOpen(pref: 'open' | 'closed' | null, openThreadCount: number): boolean {
  if (pref === 'open') return true
  if (pref === 'closed') return false
  return openThreadCount >= 1
}

export function formatCommentTime(at: number, now: number): string {
  const diffSeconds = Math.floor((now - at) / 1000)
  if (diffSeconds < 60) return '방금 전'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}분 전`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}시간 전`
  const atDate = new Date(at)
  const nowDate = new Date(now)
  const month = atDate.getMonth() + 1
  const day = atDate.getDate()
  if (atDate.getFullYear() === nowDate.getFullYear()) return `${month}월 ${day}일`
  return `${atDate.getFullYear()}. ${month}. ${day}.`
}

export function commentBadgeText(openThreadCount: number): string | null {
  if (openThreadCount <= 0) return null
  if (openThreadCount <= 99) return String(openThreadCount)
  return '99+'
}

// 5.6 레일 여분 — 카드 아랫변 + 간격이 지금 여분을 뺀 스크롤 높이를 넘는 만큼(px, 올림). 카드가 없으면 0
export function commentRailExtra(
  cardsBottom: number,
  scrollHeight: number,
  appliedExtra: number,
  gap: number = COMMENT_CARD_GAP,
): number {
  if (cardsBottom <= 0) return 0
  return Math.max(0, Math.ceil(cardsBottom + gap - (scrollHeight - appliedExtra)))
}
