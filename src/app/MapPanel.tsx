// 지도 설정 패널 내용 — 묶음 등록과 표시 묶음 본문 (specs/features/F-2005.md 4장). 바깥 위치·전환·inert 는 MapPage.tsx 가 맡는다 (6·9장)
import { useId, useState } from 'react'
import { IconChevron } from './icons'
import { MAP_DISPLAY_AXES, defaultMapView, type MapDisplayAxis, type MapView } from './mapPrefs'
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
const SECTION_READY: readonly SectionId[] = ['display', 'force']

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

const visibleSections = SECTION_ORDER.filter((id) => SECTION_READY.includes(id))

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
}

// F-2006 이 `장력` 4축에 그대로 재사용한다. 곡선 매핑은 format prop 으로 들어온다 (4.3)
function MapSlider({ id, label, min, max, step, value, axis, format, onChange }: MapSliderProps) {
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
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  )
}

export type MapPanelProps = {
  view: MapView
  // 값이 바뀔 때마다 부른다. MapPage 가 상태를 바꾸고 그 자리에서 저장한다 (6.3)
  onChange: (next: MapView) => void
  // 패널 안에서 닫을 길이 필요할 때 쓴다. 지금은 Esc 만 (6.2)
  onClose: () => void
}

export default function MapPanel({ view, onChange }: MapPanelProps) {
  const idBase = useId()
  // 그리는 묶음 중 맨 위 하나만 펼쳐져 있다. 아코디언이 아니라 여러 묶음을 동시에 펼칠 수 있다 (4.2)
  const [openSections, setOpenSections] = useState<ReadonlySet<SectionId>>(
    () => new Set(visibleSections.slice(0, 1)),
  )

  function toggleSection(id: SectionId) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function updateDisplay(axis: MapDisplayAxis, value: number) {
    onChange({ ...view, display: { ...view.display, [axis]: value } })
  }

  function updateForce(axis: MapForceAxis, value: number) {
    onChange({ ...view, force: { ...view.force, [axis]: value } })
  }

  function renderSection(id: SectionId) {
    switch (id) {
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
        }}
      >
        기본값으로
      </button>
    </>
  )
}
