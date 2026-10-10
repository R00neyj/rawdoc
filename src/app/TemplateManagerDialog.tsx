import { useRef } from 'react'
import Dialog from './Dialog'
import type { TemplateEntry } from '../lib/templates'

// 템플릿 관리 대화상자 — 사용자 템플릿은 편집·삭제, 내장은 목록만 (small 2026-10-10)
type TemplateManagerDialogProps = {
  open: boolean
  entries: readonly TemplateEntry[]
  onClose: () => void
  onCreate: () => void
  onEdit: (docId: string) => void
  onDelete: (docId: string, title: string) => void
}

export default function TemplateManagerDialog({ open, entries, onClose, onCreate, onEdit, onDelete }: TemplateManagerDialogProps) {
  const titleId = 'template-manager-title'
  const createRef = useRef<HTMLButtonElement | null>(null)
  const userEntries = entries.filter((e) => e.source.kind === 'doc')
  const builtinEntries = entries.filter((e) => e.source.kind === 'builtin')

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId} initialFocusRef={createRef}>
      <h2 id={titleId}>템플릿 관리</h2>
      <h3 className="template-manager-heading">내 템플릿</h3>
      {userEntries.length === 0 ? (
        <p className="template-manager-empty">아직 만든 템플릿이 없습니다.</p>
      ) : (
        <ul className="template-manager-list" aria-label="내 템플릿">
          {userEntries.map((entry) => {
            const docId = entry.source.kind === 'doc' ? entry.source.docId : ''
            return (
              <li key={entry.id} className="template-manager-row">
                <span className="template-manager-name">{entry.title}</span>
                <button type="button" className="dialog-btn" aria-label={`${entry.title} 편집`} onClick={() => onEdit(docId)}>
                  편집
                </button>
                <button type="button" className="dialog-btn danger" aria-label={`${entry.title} 삭제`} onClick={() => onDelete(docId, entry.title)}>
                  삭제
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <h3 className="template-manager-heading">내장</h3>
      <ul className="template-manager-list" aria-label="내장 템플릿">
        {builtinEntries.map((entry) => (
          <li key={entry.id} className="template-manager-row">
            <span className="template-manager-name">{entry.title}</span>
          </li>
        ))}
      </ul>
      <p className="template-manager-help">
        {'{{date}}·{{time}}·{{title}}은 넣을 때 날짜·시각·문서 제목으로 바뀝니다. 템플릿은 사이드바에 보이지 않는 \'템플릿\' 폴더에 문서로 저장됩니다.'}
      </p>
      <div className="dialog-actions">
        <button type="button" ref={createRef} onClick={onCreate}>
          새 템플릿
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
