// 설정 `오른쪽 패널` 탭 — 표시할 항목(기기별)과 달력 설정 (small 2026-10-10, 2026-10-11)
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
    </>
  )
}
