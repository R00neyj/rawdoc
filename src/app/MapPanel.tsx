// 지도 설정 패널 내용 — 묶음 등록과 표시 묶음 본문 (specs/features/F-2005.md 4장, F-2007.md 7장). 바깥 위치·전환·inert 는 MapPage.tsx 가 맡는다 (6·9장)
import { useId, useRef, useState } from 'react'
import { IconChevron } from './icons'
import { MAP_DISPLAY_AXES, defaultMapView, type MapDisplayAxis, type MapView } from './mapPrefs'
import { MAP_FILTER_ROOT, MAP_HOPS_MAX, type MapFilter } from '../lib/mapFilter'
import type { MapForceAxis } from '../lib/mapLayout3d'

type SectionId = 'filter' | 'group' | 'display' | 'force'

// 화면에 쌓이는 순서. F-292 6.3 의 네 묶음을 그대로 적어 둔다
const SECTION_ORDER: readonly SectionId[] = ['filter', 'group', 'display', 'force']

const SECTION_TITLE: Record<SectionId, string> = {
  filter: '필터',
  group: '그룹',
  display: '표시',
  force: '장력',
}

// 지금 내용이 있는 묶음. 빈 껍데기를 미리 그리지 않는다 (ia.md 8장, F-2002 15장 Q3)
const SECTION_READY: readonly SectionId[] = ['filter', 'display', 'force']
// 목록 보기에는 3D 장면에만 듣는 두 묶음을 그리지 않는다 (F-2007 11.3)
const SECTION_IN_LIST: readonly SectionId[] = ['filter']

function sectionsFor(mode: 'graph' | 'list'): SectionId[] {
  const ready = mode === 'list' ? SECTION_IN_LIST : SECTION_READY
  return SECTION_ORDER.filter((id) => ready.includes(id))
}

const DISPLAY_AXIS_ORDER: readonly MapDisplayAxis[] = ['nodeScale', 'labelDistance', 'edgeStrength']

const DISPLAY_FIELDS: Record<MapDisplayAxis, { label: string; format: (v: number) => string }> = {
  nodeScale: { label: '노드 크기', format: (v) => `${v.toFixed(2)}배` },
  labelDistance: { label: '이름표 표시 거리', format: (v) => (v === 0 ? '호버할 때만' : `${Math.round(v * 100)}%`) },
  edgeStrength: { label: '선 두께', format: (v) => `${Math.round(v * 100)}%` },
}

const FORCE_AXIS_ORDER: readonly MapForceAxis[] = ['center', 'repel', 'linkStrength', 'linkDistance']

// 옵시디언 패널의 말과 순서를 그대로 쓴다 (F-292 6.7)
const FORCE_LABEL: Record<MapForceAxis, string> = {
  center: '중심 장력',
  repel: '반발력',
  linkStrength: '링크 장력',
  linkDistance: '링크 거리',
}

// 네 축 다 0~1 정규값이다 — 800·0.02 같은 d3 내부 단위는 사람에게 뜻이 없고 범위를 바꾸면 표시 숫자만 튄다 (F-2006 7.3)
const forcePercent = (v: number) => `${Math.round(v * 100)}%`

// `현재 문서에서 몇 다리` 값 문자열. 라벨만 `몇 다리`, 값은 `단계` 다 — ia.md 6장 문구표와 어긋나는 것을 알고 그대로 간다 (F-2007 7.5)
const HOPS_FORMAT: Record<number, string> = {
  0: '없음 — 전부 보임',
  1: '1단계 — 이 문서와 바로 이어진 문서까지',
  2: '2단계 — 그 이웃이 이어진 문서까지',
  3: '3단계 — 거기서 한 칸 더',
}

type MapSliderProps = {
  id: string
  label: string
  min: number
  max: number
  // 'any' 는 무리수 기본값이 눈금에 스냅되는 것을 막는다. 방향키 이동폭은 0.01 로 같다 (F-2006 7.3)
  step: number | 'any'
  value: number
  // 측정·선택자용 고정 고리 (F-2006 7.4)
  axis?: string
  // 화면에 보이는 값 문자열. 0~1 정규값 → 실제 범위 매핑이 들어올 자리다 (F-2006)
  format: (value: number) => string
  onChange: (value: number) => void
  // 중심 문서가 없을 때 `몇 다리` 를 잠근다 (F-2007 7.5)
  disabled?: boolean
}

// F-2006 이 `장력` 4축에 그대로 재사용한다. 곡선 매핑은 format prop 으로 들어온다 (4.3)
function MapSlider({ id, label, min, max, step, value, axis, format, onChange, disabled }: MapSliderProps) {
  const text = format(value)
  return (
    <div className="map-slider">
      <label htmlFor={id}>{label}</label>
      <span className="map-slider-value" aria-hidden="true">
        {text}
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-axis={axis}
        aria-valuetext={text}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  )
}

export type MapFolderRow = { id: string; label: string }

export type MapPanelProps = {
  view: MapView
  // 목록 보기에서는 `필터` 만 그린다 (F-2007 11.3)
  mode: 'graph' | 'list'
  // 저장하지 않는 값이라 따로 온다 (F-2007 6.2)
  query: string
  folderRows: readonly MapFolderRow[]
  // 중심 문서가 없다 (F-2007 7.5)
  hopsDisabled: boolean
  // 값이 바뀔 때마다 부른다. MapPage 가 상태를 바꾸고 그 자리에서 저장한다 (6.3)
  onChange: (next: MapView) => void
  onQueryChange: (next: string) => void
  // 한글 입력기 조립이 끝났을 때만 거르기를 따라잡는다 (F-2007 8.2)
  onCommit: () => void
  // 패널 안에서 닫을 길이 필요할 때 쓴다. 지금은 Esc 만 (6.2)
  onClose: () => void
}

// 고른 폴더 중 경로상 자식을 가진 것이 있는지 — folderRows 는 부모가 자식 바로 위에 오는 경로 문자열이라 접두사만으로 판정한다 (F-2007 7.2)
function hasChildSelected(folderRows: readonly MapFolderRow[], selected: readonly string[]): boolean {
  const selectedSet = new Set(selected)
  for (const row of folderRows) {
    if (!selectedSet.has(row.id)) continue
    if (folderRows.some((other) => other.label.startsWith(`${row.label} / `))) return true
  }
  return false
}

export default function MapPanel({ view, mode, query, folderRows, hopsDisabled, onChange, onQueryChange, onCommit }: MapPanelProps) {
  const idBase = useId()
  const visibleSections = sectionsFor(mode)
  // 그리는 묶음 중 맨 위 하나만 펼쳐져 있다. 아코디언이 아니라 여러 묶음을 동시에 펼칠 수 있다 (4.2)
  // 두 모드 다 맨 위가 `필터` 라 펼침 초기값이 같다 — 모드가 바뀌어도 다시 잡을 일이 없다 (F-2007 11.3)
  const [openSections, setOpenSections] = useState<ReadonlySet<SectionId>>(
    () => new Set(sectionsFor(mode).slice(0, 1)),
  )
  const composingRef = useRef(false)

  function toggleSection(id: SectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateFilter(patch: Partial<MapFilter>) {
    onChange({ ...view, filter: { ...view.filter, ...patch } })
  }

  function toggleFolder(id: string) {
    const folders = view.filter.folders
    const next = folders.includes(id) ? folders.filter((f) => f !== id) : [...folders, id]
    updateFilter({ folders: next })
  }

  function updateDisplay(axis: MapDisplayAxis, value: number) {
    onChange({ ...view, display: { ...view.display, [axis]: value } })
  }

  function updateForce(axis: MapForceAxis, value: number) {
    onChange({ ...view, force: { ...view.force, [axis]: value } })
  }

  function renderSection(id: SectionId) {
    switch (id) {
      case 'filter':
        return (
          <>
            <div className="map-filter-field">
              <label htmlFor={`${idBase}-q`}>파일 검색</label>
              <input
                id={`${idBase}-q`}
                className="map-filter-search"
                type="search"
                value={query}
                placeholder="tag:일기 회고"
                onChange={(e) => {
                  const next = e.currentTarget.value
                  onQueryChange(next)
                  if (!composingRef.current) onCommit()
                }}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={(e) => {
                  composingRef.current = false
                  onQueryChange(e.currentTarget.value)
                  onCommit()
                }}
              />
            </div>
            {folderRows.length > 0 && (
              <div className="map-filter-field" role="group" aria-labelledby={`${idBase}-folders-label`}>
                <span id={`${idBase}-folders-label`} className="map-filter-label">
                  폴더
                </span>
                <ul className="map-filter-folder-list">
                  {folderRows.map((row) => (
                    <li key={row.id}>
                      <label className="map-check" title={row.label}>
                        <input type="checkbox" checked={view.filter.folders.includes(row.id)} onChange={() => toggleFolder(row.id)} />
                        <span>{row.label === '' ? '폴더 없음' : row.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {hasChildSelected(folderRows, view.filter.folders) && <p className="map-filter-hint">하위 폴더도 함께 보입니다.</p>}
              </div>
            )}
            <label className="map-check">
              <input type="checkbox" checked={view.filter.isolated} onChange={(e) => updateFilter({ isolated: e.currentTarget.checked })} />
              <span>고립 문서</span>
            </label>
            <label className="map-check">
              <input type="checkbox" checked={view.filter.broken} onChange={(e) => updateFilter({ broken: e.currentTarget.checked })} />
              <span>끊긴 링크</span>
            </label>
            <MapSlider
              id={`${idBase}-hops`}
              label="현재 문서에서 몇 다리"
              min={0}
              max={MAP_HOPS_MAX}
              step={1}
              value={view.filter.hops}
              axis="hops"
              disabled={hopsDisabled}
              format={(v) => (hopsDisabled ? '현재 문서가 없습니다' : (HOPS_FORMAT[v] ?? ''))}
              onChange={(v) => updateFilter({ hops: v })}
            />
          </>
        )
      case 'display':
        return (
          <>
            {DISPLAY_AXIS_ORDER.map((axis) => {
              const spec = MAP_DISPLAY_AXES[axis]
              const field = DISPLAY_FIELDS[axis]
              return (
                <MapSlider
                  key={axis}
                  id={`${idBase}-${axis}`}
                  label={field.label}
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={view.display[axis]}
                  axis={axis}
                  format={field.format}
                  onChange={(v) => updateDisplay(axis, v)}
                />
              )
            })}
          </>
        )
      case 'force':
        return (
          <>
            {FORCE_AXIS_ORDER.map((axis) => (
              <MapSlider
                key={axis}
                id={`${idBase}-${axis}`}
                label={FORCE_LABEL[axis]}
                min={0}
                max={1}
                step="any"
                value={view.force[axis]}
                axis={axis}
                format={forcePercent}
                onChange={(v) => updateForce(axis, v)}
              />
            ))}
          </>
        )
      default:
        return null
    }
  }

  return (
    <>
      {visibleSections.map((id) => {
        const open = openSections.has(id)
        const bodyId = `${idBase}-section-${id}`
        return (
          <section className="map-panel-section" key={id}>
            <h2>
              <button
                type="button"
                className="map-panel-section-head"
                aria-expanded={open}
                aria-controls={bodyId}
                onClick={() => toggleSection(id)}
              >
                <IconChevron size={16} />
                {SECTION_TITLE[id]}
              </button>
            </h2>
            <div className="map-panel-section-body" id={bodyId} hidden={!open}>
              {renderSection(id)}
            </div>
          </section>
        )
      })}
      <button
        type="button"
        className="map-panel-reset"
        onClick={() => {
          onChange(defaultMapView())
          // onQueryChange 만으로는 거르기에 쓰는 값(appliedQuery)이 그대로다 — 커밋까지 함께 부른다 (F-2007 6.2)
          onQueryChange('')
          onCommit()
        }}
      >
        기본값으로
      </button>
    </>
  )
}
