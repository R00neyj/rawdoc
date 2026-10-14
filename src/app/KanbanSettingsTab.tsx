// 설정 `칸반` 탭 — 지금 연 보드의 완료 칸. 바꾸면 원문 프런트매터 `kanban-done` 에 바로 쓴다 (small 2026-10-14)
import type { KanbanSettings } from './useKanbanSettings'

export default function KanbanSettingsTab({ settings }: { settings: KanbanSettings }) {
  const { choices } = settings
  if (!settings.isKanban) return <p className="dialog-note">칸반 보드를 열면 설정할 수 있습니다</p>
  if (!choices) return <p className="dialog-note">칸이 없습니다. ## 로 시작하는 줄 하나가 칸 하나가 됩니다.</p>
  return (
    <>
      <div className="dialog-field">
        <span id="kanban-done-label">완료 칸</span>
        <select
          className="settings-select"
          aria-labelledby="kanban-done-label"
          value={choices.value ?? ''}
          disabled={settings.readOnly}
          onChange={(e) => settings.onChangeDone(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">마지막 칸 ({choices.last || '이름 없는 칸'})</option>
          {choices.names.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-hint">이 칸의 카드와 완료로 체크한 카드는 할 일 패널에 나오지 않습니다. 카드를 이 칸으로 옮기면 체크 칸이 완료로, 이 칸에서 빼면 미완료로 바뀝니다.</p>
    </>
  )
}
