// 상태바 E (specs/ia.md 2장 E·4.1, specs/features/F-113.md, F-110.md 3.5)
// 보기 모드에서 줄·열을 숨기는 것은 F-123.md 3.3
// 서버 저장소 동기화 표시는 F-207.md 2.5
// 실시간 단계·폴백 표시는 F-305.md 11.1
import type { SyncState } from '../types'

type SaveStatus = 'saved' | 'dirty' | 'error' | 'memory'

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  saved: '저장됨',
  dirty: '입력 중…',
  error: '저장 실패',
  memory: '메모리 모드 — 새로고침하면 사라집니다',
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'signed-out' | 'revoked' | 'gone'

type DotStatus = 'saved' | 'dirty' | 'error'

// 실시간 경로는 저장 상태 글자 대신 이 표로 .statusbar-save 를 채운다 (F-305.md 11.1)
const LIVE_STATUS: Record<LiveStatus, { text: string; dot: DotStatus }> = {
  connecting: { text: '불러오는 중…', dot: 'dirty' },
  live: { text: '저장됨', dot: 'saved' },
  reconnecting: { text: '연결 끊김 · 다시 연결 중', dot: 'error' },
  'signed-out': { text: '다시 로그인 필요', dot: 'error' },
  revoked: { text: '편집 권한이 없습니다', dot: 'error' },
  gone: { text: '저장되지 않음', dot: 'error' },
}

const LIVE_FALLBACK_TEXT = '실시간 연결 실패 · 한 명씩 편집'

// pending·오프라인·signedOut 순서로 이어 붙인다 (F-207.md 2.5)
function syncSuffix(sync?: SyncState): string {
  if (!sync) return ''
  const parts: string[] = []
  if (sync.pending > 0) parts.push(`동기화 대기 ${sync.pending}`)
  if (!sync.online) parts.push('오프라인')
  if (sync.signedOut) parts.push('다시 로그인 필요')
  return parts.map((p) => ` · ${p}`).join('')
}

type StatusBarProps = {
  line: number
  col: number
  charCount: number
  wordCount: number
  saveStatus: SaveStatus
  viewMode: string
  syncState?: SyncState
  // 실시간 경로일 때만. 그 밖이면 null (F-305.md 11.1)
  live?: LiveStatus | null
  // 폴백 경로일 때 true — .statusbar-save 는 그대로 두고 옆에 형제 요소를 더한다
  fallback?: boolean
  // 금고가 이 탭에서 열려 있을 때만 `금고 열림` 버튼을 보인다 (F-404.md 7.7)
  e2eeOpen?: boolean
  onLockE2ee?: () => void
}

export default function StatusBar({
  line,
  col,
  charCount,
  wordCount,
  saveStatus,
  viewMode,
  syncState,
  live = null,
  fallback = false,
  e2eeOpen = false,
  onLockE2ee,
}: StatusBarProps) {
  const text = SAVE_STATUS_TEXT[saveStatus] ?? ''
  const liveEntry = live ? LIVE_STATUS[live] : null
  return (
    <div className="statusbar">
      <span className="statusbar-info">
        {viewMode !== 'view' && <>줄 {line}, 열 {col} · </>}
        {charCount.toLocaleString('ko-KR')}자 · {wordCount.toLocaleString('ko-KR')}단어
      </span>
      {liveEntry ? (
        <span className="statusbar-save">
          <span className={`statusbar-save-dot statusbar-save-dot--${liveEntry.dot}`} aria-hidden="true" />
          {liveEntry.text}
        </span>
      ) : (
        <span className={`statusbar-save${saveStatus === 'error' ? ' statusbar-save--danger' : ''}`}>
          <span className={`statusbar-save-dot statusbar-save-dot--${saveStatus}`} aria-hidden="true" />
          {text}
          {syncSuffix(syncState)}
        </span>
      )}
      {!liveEntry && fallback && <span className="statusbar-live">{LIVE_FALLBACK_TEXT}</span>}
      {e2eeOpen && (
        <button type="button" className="statusbar-e2ee" title="눌러서 금고를 잠급니다" onClick={onLockE2ee}>
          금고 열림
        </button>
      )}
    </div>
  )
}
