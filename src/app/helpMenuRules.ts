// 사이드바 하단 `도움말 메뉴` 항목 — DOM·React 없는 순수 함수 (F-2090 3.1, 파일명은 HelpMenu.tsx 와 대소문자만 달라 Rules 를 붙인다)
import { CHANGELOG_PATH, GUIDES_PATH } from '../lib/siteChrome'

export type HelpMenuKey = 'help' | 'guides' | 'changelog'
export type HelpMenuEntry = { key: HelpMenuKey; label: string; href: string | null }

export function helpMenuItems(): HelpMenuEntry[] {
  return [
    { key: 'help', label: '도움말', href: null },
    { key: 'guides', label: '사용법', href: GUIDES_PATH },
    { key: 'changelog', label: '새 소식', href: CHANGELOG_PATH },
  ]
}
