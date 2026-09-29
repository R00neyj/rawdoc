// 휴대폰 폭 상단바 ⋯ 판의 화면 판정·항목·점 규칙 — DOM·React 없는 순수 함수 (F-2083 3.2)
export type TopBarScreen = 'doc' | 'home' | 'other'

export function topBarScreen(input: {
  bootPhase: 'booting' | 'ready'
  currentDocId: string | null
  sharedDoc: boolean
  sharesOpen: boolean
  helpOpen: boolean
  mapRoute: boolean
}): TopBarScreen {
  if (input.bootPhase !== 'ready') return 'other'
  if (input.sharedDoc || input.sharesOpen || input.helpOpen || input.mapRoute) return 'other'
  return input.currentDocId === null ? 'home' : 'doc'
}

export type MoreItemKey = 'outline' | 'comments' | 'share' | 'export' | 'notifications'

export function moreSheetItems(input: {
  screen: TopBarScreen
  hasOutline: boolean
  comments: boolean
  notifications: boolean
}): MoreItemKey[] {
  const { screen } = input
  const items: MoreItemKey[] = []
  if (screen === 'doc' && input.hasOutline) items.push('outline')
  if (screen === 'doc' && input.comments) items.push('comments')
  if (screen === 'doc') items.push('share', 'export')
  if (input.notifications) items.push('notifications')
  return items
}

// home·other 에서 알림이 꺼지면 판에 행이 없다 — 빈 판을 여는 버튼을 두지 않는다 (F-2090 4.7)
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
