import { newDocTemplateOptions, type TemplateEntry } from '../lib/templates'

// 템플릿 선택칸 — 새 문서·달력 문서가 같이 쓴다. 세그먼트가 아니라 네이티브 <select> 다(F-2037.md 3.2)
export default function TemplateSelectField({
  idBase,
  label,
  value,
  entries,
  onChange,
}: {
  idBase: string
  label: string
  value: string
  entries: readonly TemplateEntry[]
  onChange: (value: string) => void
}) {
  const options = newDocTemplateOptions(value, entries)
  const noneOpt = options.find((o) => o.group === 'none')
  const builtinOpts = options.filter((o) => o.group === 'builtin')
  const userOpts = options.filter((o) => o.group === 'user')
  const missingOpt = options.find((o) => o.group === 'missing')

  return (
    <div className="dialog-field">
      <span id={`${idBase}-label`}>{label}</span>
      <select
        id={`${idBase}-select`}
        className="settings-select"
        aria-labelledby={`${idBase}-label`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {noneOpt && <option value={noneOpt.value}>{noneOpt.label}</option>}
        <optgroup label="내장">
          {builtinOpts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </optgroup>
        {userOpts.length > 0 && (
          <optgroup label="내 템플릿">
            {userOpts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        )}
        {missingOpt && (
          <option value={missingOpt.value} disabled>
            {missingOpt.label}
          </option>
        )}
      </select>
    </div>
  )
}
