// localStorage 설정 — 키 접두사 md. 로 고정하고 제품명을 쓰지 않는다, 접근은 전부 이 파일을 거친다 (architecture.md 4장)

type PrefMap = {
  'md.viewMode': 'live' | 'raw' | 'view'
  'md.defaultView': 'remember' | 'live' | 'raw' | 'view'
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
  'md.wikiPreview': 'on' | 'off'
  // 없으면 문서를 열 때 열린 스레드가 있으면 연다 — '' 은 "저장한 적 없음"(F-505 3.7)
  'md.commentRail': string
  // 사용한 단축키 id 배열(JSON, 카탈로그 순서), 브라우저별 (F-2052 4.7)
  'md.shortcutsUsed': string
  // 팔레트 최근 쓴 명령 id 배열(JSON, 최근 순), 기기별 (F-2053 7.3)
  'md.paletteRecent': string
  // 팔레트 고정한 명령 id 배열(JSON, 고정한 순서), 기기별 (F-2053 7.3)
  'md.palettePinned': string
  // 이 기기에서 푸시를 켠 계정 사용자 id, 꺼짐은 '' (F-2110 7.1)
  'md.push': string
  // 마지막으로 서버에 구독을 알린 때(ms 문자열), 없음은 '' (F-2110 7.1)
  'md.pushSyncedAt': string
  // 사용자 CSS 로컬 슬롯·계정 슬롯 캐시·부팅용 컴파일 결과, 모두 JSON (F-2092 4.2)
  'md.userCss': string
  'md.userCssAccount': string
  'md.userCssBoot': string
  // 오른쪽 패널(달력) 넓은 창 열림, 기기별 (small 2026-10-10)
  'md.rightPanel': 'open' | 'closed'
  // 달력 날짜 문서 — 폴더 id(''=최상위)·제목 형식·템플릿 id(none=없음), 기기별 (small 2026-10-10)
  'md.calendarFolder': string
  'md.calendarFormat': string
  'md.calendarTemplate': string
}

type PrefKey = keyof PrefMap

const ALLOWED_KEYS = new Set<PrefKey>([
  'md.viewMode',
  'md.defaultView',
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
  'md.wikiPreview',
  'md.commentRail',
  'md.shortcutsUsed',
  'md.paletteRecent',
  'md.palettePinned',
  'md.push',
  'md.pushSyncedAt',
  'md.userCss',
  'md.userCssAccount',
  'md.userCssBoot',
  'md.rightPanel',
  'md.calendarFolder',
  'md.calendarFormat',
  'md.calendarTemplate',
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

// setPref 와 같되 성공 여부를 돌려준다 — 한도 초과를 알아야 하는 쓰기용 (F-2095 6장)
export function trySetPref<K extends PrefKey>(key: K, value: PrefMap[K]): boolean
export function trySetPref(key: string, value: string): boolean
export function trySetPref(key: string, value: string): boolean {
  assertAllowed(key)
  try {
    if (!globalThis.localStorage) return false
    globalThis.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}
