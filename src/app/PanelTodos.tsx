// 오른쪽 패널 `할 일` 보기 — Tasks 방식 날짜 묶음(기한 지남·오늘·예정·날짜 없음). 읽기 전용, 누르면 그 문서의 그 줄로 (small 2026-10-11)
import { TODO_MAX_ITEMS, tasksByDoc, type TaskBucket, type TaskPriority, type TaskRow } from '../lib/docTodos'
import type { DocTodosView } from './usePanelDocs'

const BUCKET_LABELS: Record<TaskBucket, string> = { overdue: '기한 지남', today: '오늘', upcoming: '예정', none: '날짜 없음' }
const PRIORITY_LABELS: Record<TaskPriority, string | null> = { highest: '가장 높음', high: '높음', medium: '보통', none: null, low: '낮음', lowest: '가장 낮음' }

function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${m}월 ${d}일`
}

function metaOf(row: TaskRow): string {
  return [
    row.status === 'inProgress' ? '진행 중' : null,
    row.due ? `마감 ${shortDate(row.due)}` : null,
    row.scheduled ? `예정 ${shortDate(row.scheduled)}` : null,
    row.start ? `시작 ${shortDate(row.start)}` : null,
    PRIORITY_LABELS[row.priority],
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

export default function PanelTodos({ view }: { view: DocTodosView }) {
  const { todos } = view
  if (!todos) {
    return (
      <div className="doc-links">
        <p className="doc-links-empty">불러오는 중…</p>
      </div>
    )
  }
  return (
    <div className="doc-links">
      {todos.groups.length === 0 && (
        <p className="doc-links-empty">{view.filters.length > 0 ? `${view.filters.join(' · ')} 표시가 붙은 할 일이 없습니다.` : '남은 할 일이 없습니다.'}</p>
      )}
      {todos.groups.map((group) => (
        <section key={group.bucket} className="doc-links-group">
          <h3 className="doc-links-title">
            {BUCKET_LABELS[group.bucket]}
            <span className="doc-links-count">{group.items.length}</span>
          </h3>
          {tasksByDoc(group.items).map((doc) => (
            <div key={doc.docId} className="todo-doc">
              <h4 className="todo-doc-title">{doc.docTitle || '제목 없는 문서'}</h4>
              <ul className="doc-links-list">
                {doc.items.map((row) => {
                  const meta = metaOf(row)
                  return (
                    <li key={`${row.docId}:${row.line}`}>
                      <button type="button" className="doc-link-item todo-item" onClick={() => view.onOpenItem(row.docId, row.line)}>
                        <span className="todo-box" data-status={row.status} aria-hidden="true" />
                        <span className="todo-body">
                          <span className="doc-link-title">{row.text}</span>
                          {meta && <span className="todo-meta">{meta}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {todos.truncated && <p className="doc-links-note">할 일이 많아 앞의 {TODO_MAX_ITEMS}개만 보여 줍니다.</p>}
      {todos.lockedCount > 0 && (
        <p className="doc-links-note">금고가 잠겨 있어 금고 문서 {todos.lockedCount.toLocaleString('ko-KR')}개는 읽지 않았습니다.</p>
      )}
    </div>
  )
}
