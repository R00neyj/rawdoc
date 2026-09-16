// 상태바 E (specs/ia.md 2장 E·4.1, specs/features/F-113.md, F-110.md 3.5)
// 보기 모드에서 줄·열을 숨기는 것은 F-123.md 3.3
// 서버 저장소 동기화 표시는 F-207.md 2.5
import type { SyncState } from '../types'

type SaveStatus = 'saved' | 'dirty' | 'error' | 'memory'

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  saved: '저장됨',
  dirty: '입력 중…',
  error: '저장 실패',
  memory: '메모리 모드 — 새로고침하면 사라집니다',
}

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
}

export default function StatusBar({ line, col, charCount, wordCount, saveStatus, viewMode, syncState }: StatusBarProps) {
  const text = SAVE_STATUS_TEXT[saveStatus] ?? ''
  return (
    <div className="statusbar">
      <span className="statusbar-info">
        {viewMode !== 'view' && <>줄 {line}, 열 {col} · </>}
        {charCount.toLocaleString('ko-KR')}자 · {wordCount.toLocaleString('ko-KR')}단어
      </span>
      <span className={`statusbar-save${saveStatus === 'error' ? ' statusbar-save--danger' : ''}`}>
        <span className={`statusbar-save-dot statusbar-save-dot--${saveStatus}`} aria-hidden="true" />
        {text}
        {syncSuffix(syncState)}
      </span>
    </div>
  )
}
