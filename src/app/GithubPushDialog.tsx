// D-21 GitHub 푸시 — 커밋 메시지, 확인 줄, 진행·오류 (specs/features/F-2130.md 5장)
import { useEffect, useRef } from 'react'
import Dialog from './Dialog'
import { planSummary } from './githubPush'
import type { GithubPushDialogProps } from './useGithubPush'

const CONFLICT_TEXT = {
  live: 'GitHub 파일이 바뀌었습니다. 당겨서 합친 뒤 푸시하세요',
  gone: 'GitHub에서 파일이 사라졌습니다. 연결을 해제한 뒤 다시 연결하면 첫 푸시가 새로 만듭니다',
} as const

export default function GithubPushDialog({ state, onMessage, onPush, onPull, onCancel }: GithubPushDialogProps) {
  const messageRef = useRef<HTMLTextAreaElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const busyRef = useRef(false)
  useEffect(() => {
    busyRef.current = state?.busy === true
  })

  // 진행 중에는 바깥 클릭으로도 닫히지 않게 대화상자 click 을 먼저 가로챈다
  useEffect(() => {
    const dialog = titleRef.current?.closest('dialog')
    if (!dialog) return
    const block = (e: MouseEvent) => {
      if (busyRef.current && e.target === dialog) e.stopImmediatePropagation()
    }
    dialog.addEventListener('click', block, true)
    return () => dialog.removeEventListener('click', block, true)
  }, [])

  const summary = state?.plan ? planSummary(state.plan) : null
  const busy = state?.busy === true
  const blocked = !state || busy || state.conflict !== null || state.message.trim() === ''
  return (
    <Dialog open={state !== null} onClose={onCancel} titleId="github-push-title" initialFocusRef={messageRef} onCancel={(e) => { if (busyRef.current) e.preventDefault() }}>
      <h2 id="github-push-title" ref={titleRef}>GitHub에 푸시</h2>
      {state && (
        <>
          <p className="dialog-note github-push-note github-push-target">{state.target}</p>
          <label className="github-push-label">
            <span>커밋 메시지</span>
            <textarea
              ref={messageRef}
              className="github-push-message"
              rows={3}
              maxLength={1000}
              placeholder="무엇을 바꿨는지 적어 주세요"
              value={state.message}
              onChange={(e) => onMessage(e.target.value)}
            />
          </label>
          {state.checking && <p className="dialog-note github-push-note">GitHub 확인 중…</p>}
          {summary && <p className="dialog-note github-push-note">{summary.newLine}</p>}
          {summary?.skippedLine && <p className="dialog-note github-push-note">{summary.skippedLine}</p>}
          {state.progress && <p className="dialog-note github-push-note" role="status">{state.progress}</p>}
          {state.error && <p className="dialog-note github-push-note github-error" role="alert">{state.error}</p>}
          {state.conflict && <p className="dialog-note github-push-note github-error" role="alert">{state.conflict.gone ? CONFLICT_TEXT.gone : CONFLICT_TEXT.live}</p>}
        </>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onCancel}>취소</button>
        {state?.conflict?.gone === false && <button type="button" disabled={busy} onClick={onPull}>당기기…</button>}
        <button type="button" className="primary" disabled={blocked} onClick={onPush}>{busy ? '푸시하는 중…' : '푸시'}</button>
      </div>
    </Dialog>
  )
}
