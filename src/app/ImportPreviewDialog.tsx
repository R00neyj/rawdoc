import { useRef } from 'react'
import Dialog from './Dialog'
import type { ImportPlan } from './importWorkspace'

// D-? 가져오기 미리보기·진행·결과 대화상자 (specs/features/F-282.md 3.8)
export type ImportDialogState =
  | { stage: 'preview'; fileName: string; plan: ImportPlan }
  | { stage: 'progress'; fileName: string; done: number; total: number }
  | { stage: 'result'; fileName: string; createdCount: number; updatedCount: number; failures: string[] }

type ImportPreviewDialogProps = {
  state: ImportDialogState | null
  onCancel: () => void
  onConfirm: () => void
  onClose: () => void
}

export default function ImportPreviewDialog({ state, onCancel, onConfirm, onClose }: ImportPreviewDialogProps) {
  const titleId = 'import-preview-title'
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  function handleClose() {
    if (!state) return
    if (state.stage === 'preview') onCancel()
    // 진행 단계는 Dialog 자체에 닫힘을 막는 기능이 없다 — 닫혀도 가져오기는 이어진다 (3.8, 4장 Q6)
  }

  return (
    <Dialog open={Boolean(state)} onClose={handleClose} titleId={titleId} initialFocusRef={cancelRef}>
      <h2 id={titleId}>가져오기</h2>
      {state?.stage === 'preview' && (
        <>
          <p className="dialog-field">{state.fileName}</p>
          <p className="dialog-field">
            새로 {state.plan.counts.created}개 · 갱신 {state.plan.counts.updated}개 · 건너뜀 {state.plan.counts.skipped}개 · 이미지{' '}
            {state.plan.counts.images}개
          </p>
          {state.plan.warnings.length > 0 && (
            <ul className="import-list">
              {state.plan.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {state.plan.counts.updated > 0 && <p className="dialog-note">덮이는 문서는 이전 내용을 &quot;(가져오기 전)&quot; 문서로 남깁니다.</p>}
          {state.plan.counts.created + state.plan.counts.updated === 0 && <p className="dialog-note">가져올 문서가 없습니다.</p>}
          <div className="dialog-actions">
            <button type="button" ref={cancelRef} onClick={onCancel}>
              취소
            </button>
            <button type="button" onClick={onConfirm} disabled={state.plan.counts.created + state.plan.counts.updated === 0}>
              가져오기
            </button>
          </div>
        </>
      )}
      {state?.stage === 'progress' && (
        <>
          <p className="dialog-field">
            가져오는 중… {state.done}/{state.total}
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={onCancel}>
              취소
            </button>
          </div>
        </>
      )}
      {state?.stage === 'result' && (
        <>
          <p className="dialog-field">
            {state.updatedCount > 0
              ? `문서 ${state.createdCount}개를 가져오고 ${state.updatedCount}개를 갱신했습니다.`
              : `문서 ${state.createdCount}개를 가져왔습니다.`}
          </p>
          {state.failures.length > 0 && (
            <ul className="import-list">
              {state.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button type="button" onClick={onClose}>
              닫기
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
