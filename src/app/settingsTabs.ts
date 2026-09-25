// 설정 대화상자 왼쪽 탭 — 순수 함수만 (specs/features/F-290.md 3.2). DOM 을 쓰지 않는다
export type SettingsTabId = 'screen' | 'editor' | 'data' | 'e2ee'

// 각 탭에 그릴 항목이 하나라도 있는지. e2ee 는 선택 — 없으면 거짓(F-404.md 7.5)
export type SettingsTabAvailability = { screen: boolean; editor: boolean; data: boolean; e2ee?: boolean }

const TAB_ORDER: SettingsTabId[] = ['screen', 'editor', 'data', 'e2ee']

// 보일 탭을 화면 → 편집기 → 데이터 순서로 돌려준다
export function visibleSettingsTabs(has: SettingsTabAvailability): SettingsTabId[] {
  return TAB_ORDER.filter((id) => has[id])
}

// 방향키·Home·End 로 갈 다음 탭 자리. 범위를 벗어나면 순환한다. 그 밖의 키는 current 를 그대로 돌려준다(호출한 쪽이 preventDefault 를 하지 않는다)
export function nextTabIndex(current: number, count: number, key: string): number {
  if (count === 0) return 0
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowUp':
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return current
  }
}
