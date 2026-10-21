// 상단바 ⋯ 의 화면 판정·항목·점 규칙 — 휴대폰 아래 판과 넓은 창 드롭다운 공용, DOM·React 없는 순수 함수 (F-2083 3.2)
export type TopBarScreen = 'doc' | 'home' | 'file' | 'other'

export function topBarScreen(input: {
  bootPhase: 'booting' | 'ready'
  currentDocId: string | null
  sharedDoc: boolean
  sharesOpen: boolean
  helpOpen: boolean
  trashOpen: boolean
  mapRoute: boolean
  localFile: boolean
}): TopBarScreen {
  if (input.bootPhase !== 'ready') return 'other'
  if (input.localFile) return 'file' // F-2155 2장
  if (input.sharedDoc || input.sharesOpen || input.helpOpen || input.trashOpen || input.mapRoute) return 'other'
  return input.currentDocId === null ? 'home' : 'doc'
}

export type MoreItemKey = 'outline' | 'comments' | 'share' | 'export' | 'github' | 'notifications'

// 넓은 창은 공유가 ⋯ 밖에, 목차가 본문 옆 버튼에 있어 둘 다 뺀다 (small 2026-10-21)
export function moreSheetItems(input: {
  wide?: boolean
  screen: TopBarScreen
  hasOutline: boolean
  comments: boolean
  notifications: boolean
  github?: boolean
}): MoreItemKey[] {
  const { screen, wide } = input
  const items: MoreItemKey[] = []
  if (screen === 'doc' && !wide && input.hasOutline) items.push('outline')
  if (screen === 'doc' && input.comments) items.push('comments')
  if (screen === 'doc' && !wide) items.push('share')
  if (screen === 'doc') items.push('export')
  if (screen === 'doc' && input.github) items.push('github')
  if (input.notifications) items.push('notifications')
  return items
}

// 행이 없으면 빈 판을 여는 버튼을 두지 않는다 (F-2090 4.7)
export function moreButtonVisible(input: { screen: TopBarScreen; notifications: boolean }): boolean {
  return input.screen === 'doc' || input.notifications
}

export function moreDotVisible(input: {
  screen: TopBarScreen
  unread: number | null
  commentsOpenCount: number | null
}): boolean {
  if ((input.unread ?? 0) > 0) return true
  return input.screen === 'doc' && (input.commentsOpenCount ?? 0) > 0
}
