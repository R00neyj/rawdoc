import TemplateSelectField from './TemplateSelectField'
import { calendarDocTitle, CALENDAR_DEFAULT_FORMAT } from '../lib/calendar'
import type { TemplateEntry } from '../lib/templates'

// 설정 `오른쪽 패널` 탭의 달력 묶음 — 날짜 문서 위치·제목 형식·템플릿, 기기별 (small 2026-10-10)
export type CalendarSettings = {
  folder: string
  folderOptions: readonly { id: string; label: string }[]
  folderMissing: boolean
  format: string
  template: string
  onChangeFolder: (value: string) => void
  onChangeFormat: (value: string) => void
  onChangeTemplate: (value: string) => void
}

export default function CalendarSettingsTab({ settings, entries }: { settings: CalendarSettings; entries: readonly TemplateEntry[] }) {
  const now = new Date()
  const preview = calendarDocTitle({ year: now.getFullYear(), month: now.getMonth(), day: now.getDate() }, settings.format)
  return (
    <>
      <div className="dialog-field">
        <span id="calendar-folder-label">문서 위치</span>
        <select
          className="settings-select"
          aria-labelledby="calendar-folder-label"
          value={settings.folder}
          onChange={(e) => settings.onChangeFolder(e.target.value)}
        >
          <option value="">최상위</option>
          {settings.folderOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          {settings.folderMissing && (
            <option value={settings.folder} disabled>
              찾을 수 없는 폴더 (최상위에 만듭니다)
            </option>
          )}
        </select>
      </div>
      <div className="dialog-field">
        <span id="calendar-format-label">제목 형식</span>
        <input
          type="text"
          className="settings-text"
          aria-labelledby="calendar-format-label"
          placeholder={CALENDAR_DEFAULT_FORMAT}
          spellCheck={false}
          value={settings.format}
          onChange={(e) => settings.onChangeFormat(e.target.value)}
        />
      </div>
      <p className="settings-hint">
        오늘 문서 제목: {preview}. YYYY·MM·DD·dddd(요일)를 씁니다. 형식을 바꾸면 옛 형식 문서는 달력에 표시되지 않습니다.
      </p>
      <TemplateSelectField idBase="calendar-template" label="달력 문서 템플릿" value={settings.template} entries={entries} onChange={settings.onChangeTemplate} />
    </>
  )
}
