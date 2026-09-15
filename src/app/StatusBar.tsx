// 상태바 E (specs/ia.md 2장 E·4.1, specs/features/F-113.md, F-110.md 3.5)
// 보기 모드에서 줄·열을 숨기는 것은 F-123.md 3.3
type SaveStatus = 'saved' | 'dirty' | 'error' | 'memory'

const SAVE_STATUS_TEXT: Record<SaveStatus, string> = {
  saved: '저장됨',
  dirty: '입력 중…',
  error: '저장 실패',
  memory: '메모리 모드 — 새로고침하면 사라집니다',
}

type StatusBarProps = {
  line: number
  col: number
  charCount: number
  wordCount: number
  saveStatus: SaveStatus
  viewMode: string
}

export default function StatusBar({ line, col, charCount, wordCount, saveStatus, viewMode }: StatusBarProps) {
  const text = SAVE_STATUS_TEXT[saveStatus] ?? ''
  return (
    <div className="statusbar">
      <span className="statusbar-info">
        {viewMode !== 'view' && <>줄 {line}, 열 {col} · </>}
        {charCount.toLocaleString('ko-KR')}자 · {wordCount.toLocaleString('ko-KR')}단어
      </span>
      <span className={`statusbar-save${saveStatus === 'error' ? ' statusbar-save--danger' : ''}`}>
        {text}
      </span>
    </div>
  )
}
