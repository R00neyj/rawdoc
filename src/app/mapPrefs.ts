// 지도 설정 저장 — md.mapView·md.mapGroups 읽기·쓰기·검증 (specs/features/F-2005.md 3장). DOM 을 쓰지 않는다
import { getPref, setPref } from './prefs'
import { resolveForceNorms, MAP_FORCE_DEFAULT_NORMS, type MapForceNorms } from '../lib/mapLayout3d'

// 표시 묶음 3축 (F-292 6.6, F-2005 3.3)
export type MapDisplayAxis = 'nodeScale' | 'labelDistance' | 'edgeStrength'

export type MapDisplayAxisSpec = {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly start: number
}

export const MAP_DISPLAY_AXES: Readonly<Record<MapDisplayAxis, MapDisplayAxisSpec>> = Object.freeze({
  nodeScale: Object.freeze({ min: 0.5, max: 3, step: 0.05, start: 1 }),
  labelDistance: Object.freeze({ min: 0, max: 1, step: 0.01, start: 0 }),
  edgeStrength: Object.freeze({ min: 0, max: 1, step: 0.01, start: 0.5 }),
})

const MAP_DISPLAY_AXIS_LIST: readonly MapDisplayAxis[] = ['nodeScale', 'labelDistance', 'edgeStrength']

export type MapDisplay = Record<MapDisplayAxis, number>
export type MapView = { display: MapDisplay; force: MapForceNorms }
export type MapGroup = { q: string; c: number }

export const MAP_GROUP_MAX = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeDisplay(raw: unknown): MapDisplay {
  const source = isPlainObject(raw) ? raw : null
  const result = {} as MapDisplay
  for (const axis of MAP_DISPLAY_AXIS_LIST) {
    const spec = MAP_DISPLAY_AXES[axis]
    const value = source ? source[axis] : undefined
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[axis] = clamp(value, spec.min, spec.max)
    } else {
      result[axis] = spec.start
    }
  }
  return result
}

export function defaultMapView(): MapView {
  return { display: normalizeDisplay(null), force: MAP_FORCE_DEFAULT_NORMS }
}

export function normalizeMapView(raw: unknown): MapView {
  const source = isPlainObject(raw) ? raw : {}
  return {
    display: normalizeDisplay(source.display),
    force: resolveForceNorms(source.force as Partial<Record<string, unknown>> | null | undefined),
  }
}

export function loadMapView(): MapView {
  const raw = getPref('md.mapView', '')
  if (!raw) return defaultMapView()
  try {
    return normalizeMapView(JSON.parse(raw))
  } catch {
    return defaultMapView()
  }
}

export function saveMapView(view: MapView): void {
  setPref('md.mapView', JSON.stringify(view))
}

export function normalizeMapGroups(raw: unknown): MapGroup[] {
  if (!Array.isArray(raw)) return []
  const result: MapGroup[] = []
  for (const item of raw) {
    if (result.length >= MAP_GROUP_MAX) break
    if (!isPlainObject(item)) continue
    const q = item.q
    if (typeof q !== 'string') continue
    const c = item.c
    const validC = Number.isInteger(c) && (c as number) >= 1 && (c as number) <= 8 ? (c as number) : 1
    result.push({ q, c: validC })
  }
  return result
}

export function loadMapGroups(): MapGroup[] {
  const raw = getPref('md.mapGroups', '')
  if (!raw) return []
  try {
    return normalizeMapGroups(JSON.parse(raw))
  } catch {
    return []
  }
}

export function saveMapGroups(groups: MapGroup[]): void {
  setPref('md.mapGroups', JSON.stringify(groups))
}
