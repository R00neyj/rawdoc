// localStorage 설정 (specs/architecture.md 4장)
// 키 접두사 md. 로 고정, 제품명을 쓰지 않는다. 접근은 전부 이 파일을 거친다

type PrefMap = {
  'md.viewMode': 'live' | 'raw' | 'view'
  'md.openFolders': string
  'md.headingFont': 'serif' | 'sans'
  'md.bodyFont': 'sans' | 'serif'
  'md.theme': 'system' | 'white' | 'sepia' | 'dark'
  'md.sidebar': 'expanded' | 'collapsed'
  'md.sidebarWidth': string
  'md.lineNumbers': 'on' | 'off'
  'md.fontSize': 'small' | 'medium' | 'large'
  'md.indent': '2' | '4'
  'md.lastDocId': string
  'md.firstRunDone': '1'
  'md.persistNoticeShown': '1'
  'md.account': string
  'md.localMigrated': string
  'md.startScreen': 'home' | 'last'
  'md.toolbar': 'on' | 'off'
  'md.landingDone': '1'
  'md.mapView': string
  'md.mapGroups': string
  'md.newDocTemplate': string
  'md.e2eeLockMinutes': '5' | '15' | '30' | '60' | '240'
  'md.e2eeBackupNotice': '1'
  'md.contentWidth': string
}

type PrefKey = keyof PrefMap

const ALLOWED_KEYS = new Set<PrefKey>([
  'md.viewMode',
  'md.headingFont',
  'md.bodyFont',
  'md.theme',
  'md.lastDocId',
  'md.firstRunDone',
  'md.persistNoticeShown',
  'md.openFolders',
  'md.sidebar',
  'md.sidebarWidth',
  'md.lineNumbers',
  'md.fontSize',
  'md.indent',
  'md.account',
  'md.localMigrated',
  'md.startScreen',
  'md.toolbar',
  'md.landingDone',
  'md.mapView',
  'md.mapGroups',
  'md.newDocTemplate',
  'md.e2eeLockMinutes',
  'md.e2eeBackupNotice',
  'md.contentWidth',
])

function assertAllowed(key: string) {
  if (!ALLOWED_KEYS.has(key as PrefKey)) {
    throw new Error(`허용되지 않은 설정 키: ${key}`)
  }
}

export function getPref<K extends PrefKey>(key: K, fallback: PrefMap[K]): PrefMap[K]
export function getPref(key: string, fallback: string): string
export function getPref(key: string, fallback: string): string {
  assertAllowed(key)
  try {
    const value = globalThis.localStorage?.getItem(key)
    return value === null || value === undefined ? fallback : value
  } catch {
    // 시크릿 창·차단 등은 삼키고 기본값
    return fallback
  }
}

export function setPref<K extends PrefKey>(key: K, value: PrefMap[K]): void
export function setPref(key: string, value: string): void
export function setPref(key: string, value: string): void {
  assertAllowed(key)
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // 시크릿 창·차단 등은 삼킨다
  }
}
