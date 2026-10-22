// 설정 대화상자 왼쪽 목록 — 순수 함수만 (specs/features/F-290.md 3.2, A안 small 2026-10-22). DOM 을 쓰지 않는다
export const SETTINGS_TAB_IDS = ['screen', 'css', 'writing', 'start', 'rightPanel', 'kanban', 'data', 'e2ee', 'account'] as const
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number]

// 각 묶음에 그릴 항목이 하나라도 있는지 — 없으면 거짓
export type SettingsTabAvailability = Partial<Record<SettingsTabId, boolean>>

// 왼쪽 목록의 상위 이름 — 각 탭이 어느 아래에 서는지
const TAB_GROUP: Record<SettingsTabId, string> = {
  screen: '모양',
  css: '모양',
  writing: '문서',
  start: '문서',
  rightPanel: '도구',
  kanban: '도구',
  data: '데이터',
  e2ee: '데이터',
  account: '계정',
}

export type SettingsTabGroup = { label: string; tabs: SettingsTabId[] }

export function visibleSettingsTabs(has: SettingsTabAvailability): SettingsTabId[] {
  return SETTINGS_TAB_IDS.filter((id) => has[id])
}

export function settingsTabGroupLabel(id: SettingsTabId): string {
  return TAB_GROUP[id]
}

// 보이는 탭을 순서대로 상위 이름 아래 묶는다 — 빈 상위 묶음은 없다
export function groupSettingsTabs(tabs: readonly SettingsTabId[]): SettingsTabGroup[] {
  const groups: SettingsTabGroup[] = []
  for (const id of tabs) {
    const label = TAB_GROUP[id]
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.tabs.push(id)
    else groups.push({ label, tabs: [id] })
  }
  return groups
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
