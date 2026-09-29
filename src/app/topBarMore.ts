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

export type MoreItemKey = 'outline' | 'comments' | 'share' | 'export' | 'notifications' | 'account' | 'settings' | 'help' | 'guides'

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
  items.push('account')
  items.push('settings', 'help', 'guides') // 휴대폰 사이드바 아래 줄에서 옮겨 옴 (tweak 2026-09-29)
  return items
}

export function moreDotVisible(input: {
  screen: TopBarScreen
  unread: number | null
  commentsOpenCount: number | null
}): boolean {
  if ((input.unread ?? 0) > 0) return true
  return input.screen === 'doc' && (input.commentsOpenCount ?? 0) > 0
}
