// 오른쪽 패널 `할 일` 보기 — 문서별 미완료 체크박스. 읽기 전용, 누르면 그 문서의 그 줄로 (small 2026-10-11)
import { TODO_MAX_ITEMS } from '../lib/docTodos'
import type { DocTodosView } from './usePanelDocs'

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
      {todos.groups.length === 0 && <p className="doc-links-empty">남은 할 일이 없습니다.</p>}
      {todos.groups.map((group) => (
        <section key={group.id} className="doc-links-group">
          <h3 className="doc-links-title">
            <span className="todo-group-title">{group.title || '제목 없는 문서'}</span>
            <span className="doc-links-count">{group.total}</span>
          </h3>
          <ul className="doc-links-list">
            {group.items.map((item) => (
              <li key={item.line}>
                <button
                  type="button"
                  className="doc-link-item todo-item"
                  style={{ paddingLeft: 8 + Math.min(item.level, 3) * 14 }}
                  onClick={() => view.onOpenItem(group.id, item.line)}
                >
                  <span className="todo-box" aria-hidden="true" />
                  <span className="doc-link-title">{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {todos.truncated && <p className="doc-links-note">할 일이 많아 앞의 {TODO_MAX_ITEMS}개만 보여 줍니다.</p>}
      {todos.lockedCount > 0 && (
        <p className="doc-links-note">금고가 잠겨 있어 금고 문서 {todos.lockedCount.toLocaleString('ko-KR')}개는 읽지 않았습니다.</p>
      )}
    </div>
  )
}
