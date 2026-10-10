// 설정 `오른쪽 패널` 탭 — 표시할 항목·달력·할 일 표시(전역 필터), 모두 기기별 (small 2026-10-10, 2026-10-11)
import CalendarSettingsTab, { type CalendarSettings } from './CalendarSettingsTab'
import type { PanelItemId } from '../lib/panelSlots'
import type { RightPanelItemsSettings } from './useRightPanel'
import type { TemplateEntry } from '../lib/templates'

export type RightPanelSettings = RightPanelItemsSettings & { calendar: CalendarSettings }

const ITEM_LABELS: [PanelItemId, string][] = [
  ['calendar', '달력'],
  ['dayDocs', '그날 문서'],
  ['graph', '그래프'],
  ['links', '링크'],
  ['todos', '할 일'],
]

export default function RightPanelSettingsTab({ settings, entries }: { settings: RightPanelSettings; entries: readonly TemplateEntry[] }) {
  const { items, onToggleItem } = settings
  return (
    <>
      <fieldset className="panel-items">
        <legend className="panel-settings-title">표시할 항목</legend>
        {ITEM_LABELS.map(([id, label]) => (
          <label key={id} className="panel-item-check">
            {/* 그날 문서는 달력 안 목록이라 달력을 끄면 값은 두고 고를 수만 없게 한다 */}
            <input type="checkbox" checked={items[id]} disabled={id === 'dayDocs' && !items.calendar} onChange={(e) => onToggleItem(id, e.target.checked)} />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <h3 className="panel-settings-title">달력</h3>
      <CalendarSettingsTab settings={settings.calendar} entries={entries} />
      <h3 className="panel-settings-title">할 일</h3>
      <div className="dialog-field">
        <span id="task-filter-label">할 일 표시</span>
        <input
          type="text"
          className="settings-text"
          aria-labelledby="task-filter-label"
          placeholder="비우면 모든 체크박스"
          spellCheck={false}
          value={settings.taskFilterText}
          onChange={(e) => settings.onChangeTaskFilter(e.target.value)}
        />
      </div>
      <p className="settings-hint">이 표시가 붙은 체크박스만 할 일로 모읍니다. 쉼표로 여러 개를 적고, 비우면 모든 체크박스입니다. #으로 시작하면 그 태그만 찾습니다(#task/하위·#tasks 는 다른 태그).</p>
      <label className="panel-item-check">
        <input type="checkbox" checked={settings.taskFilterHide} onChange={(e) => settings.onChangeTaskFilterHide(e.target.checked)} />
        <span>글자에서 할 일 표시 숨기기</span>
      </label>
    </>
  )
}
