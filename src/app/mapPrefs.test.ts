import { describe, it, expect, beforeEach } from 'vitest'
import {
  defaultMapView,
  loadMapView,
  saveMapView,
  normalizeMapView,
  loadMapGroups,
  saveMapGroups,
  normalizeMapGroups,
} from './mapPrefs'
import { MAP_FORCE_DEFAULT_NORMS } from '../lib/mapLayout3d'
import { MAP_FILTER_DEFAULT } from '../lib/mapFilter'

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? (store.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  }
}

beforeEach(() => {
  globalThis.localStorage = createMemoryLocalStorage()
})

describe('mapPrefs — md.mapView (12.1 U1~U9)', () => {
  it('U1 저장값 없음 — 기본값', () => {
    const view = loadMapView()
    expect(view.display).toEqual({ nodeScale: 1, labelDistance: 0, edgeStrength: 0.5 })
    expect(view.force).toEqual(MAP_FORCE_DEFAULT_NORMS)
  })

  it('U2 깨진 JSON — 기본값', () => {
    globalThis.localStorage.setItem('md.mapView', '{{{')
    expect(loadMapView()).toEqual(defaultMapView())
  })

  it('U3 최상위가 배열·문자열·null — 기본값', () => {
    expect(normalizeMapView([1, 2, 3])).toEqual(defaultMapView())
    expect(normalizeMapView('nope')).toEqual(defaultMapView())
    expect(normalizeMapView(null)).toEqual(defaultMapView())
  })

  it('U4 모르는 키 — 버린다', () => {
    const view = normalizeMapView({ display: { nodeScale: 2, zzz: 1 }, wat: 3 })
    expect(view.display.nodeScale).toBe(2)
    expect(view).not.toHaveProperty('wat')
    expect(view.display).not.toHaveProperty('zzz')
  })

  it('U5 범위 밖 — 자른다', () => {
    const view = normalizeMapView({ display: { nodeScale: 99, labelDistance: -1, edgeStrength: 2 } })
    expect(view.display.nodeScale).toBe(3)
    expect(view.display.labelDistance).toBe(0)
    expect(view.display.edgeStrength).toBe(1)

    const view2 = normalizeMapView({ display: { nodeScale: -5 } })
    expect(view2.display.nodeScale).toBe(0.5)
  })

  it('U6 타입 틀림 — 그 축만 기본값, 다른 축은 살아남는다', () => {
    const view = normalizeMapView({ display: { nodeScale: '2', labelDistance: NaN, edgeStrength: 0.8 } })
    expect(view.display.nodeScale).toBe(1)
    expect(view.display.labelDistance).toBe(0)
    expect(view.display.edgeStrength).toBe(0.8)

    const view2 = normalizeMapView({ display: { nodeScale: null, edgeStrength: 0.3 } })
    expect(view2.display.nodeScale).toBe(1)
    expect(view2.display.edgeStrength).toBe(0.3)
  })

  it('U7 display 자체가 객체가 아니다 — 묶음 전체 기본값, force 는 영향 없음', () => {
    const view = normalizeMapView({ display: 'nope', force: { repel: 0.9 } })
    expect(view.display).toEqual({ nodeScale: 1, labelDistance: 0, edgeStrength: 0.5 })
    expect(view.force.repel).toBe(0.9)
  })

  it('U8 force 묶음 — resolveForceNorms 와 같은 결과', () => {
    const view = normalizeMapView({ force: { repel: 2, center: -1, zzz: 1 } })
    expect(view.force.repel).toBe(1)
    expect(view.force.center).toBe(0)
    expect(view.force).not.toHaveProperty('zzz')
  })

  it('U9 왕복 — saveMapView 뒤 loadMapView 가 깊게 같다', () => {
    const view = {
      display: { nodeScale: 2.5, labelDistance: 0.4, edgeStrength: 0.9 },
      force: { ...MAP_FORCE_DEFAULT_NORMS, repel: 0.7 },
      filter: MAP_FILTER_DEFAULT,
    }
    saveMapView(view)
    expect(loadMapView()).toEqual(view)
  })
})

describe('mapPrefs — md.mapView.filter (F-2007 16.1 U15~U17)', () => {
  it('U15 defaultMapView().filter 가 MAP_FILTER_DEFAULT 와 같다', () => {
    expect(defaultMapView().filter).toEqual(MAP_FILTER_DEFAULT)
  })

  it('U16 묶음 독립 — filter 가 깨져도 display·force 는 기본값 그대로다', () => {
    const view = normalizeMapView({ filter: { hops: 'x' } })
    expect(view.display).toEqual({ nodeScale: 1, labelDistance: 0, edgeStrength: 0.5 })
    expect(view.force).toEqual(MAP_FORCE_DEFAULT_NORMS)
    expect(view.filter.hops).toBe(0)
  })

  it('U17 왕복 — filter 를 바꿔 저장·적재하면 같다', () => {
    const view = { ...defaultMapView(), filter: { folders: ['a'], isolated: false, broken: true, hops: 2 } }
    saveMapView(view)
    expect(loadMapView()).toEqual(view)
  })
})

describe('mapPrefs — md.mapGroups (12.1 U10~U13)', () => {
  it('U10 배열 아님·깨진 JSON — []', () => {
    expect(normalizeMapGroups('nope')).toEqual([])
    expect(normalizeMapGroups({ a: 1 })).toEqual([])
    globalThis.localStorage.setItem('md.mapGroups', '{{{')
    expect(loadMapGroups()).toEqual([])
  })

  it('U11 그룹 항목 검증', () => {
    const groups = normalizeMapGroups([
      { q: 'abc', c: 3 },
      { q: 123, c: 1 },
      { q: 'zero', c: 0 },
      { q: 'nine', c: 9 },
      { q: 'float', c: 2.5 },
      { q: 'str', c: '3' },
      { q: 'unknown', c: 4, extra: 'x' },
    ])
    expect(groups).toEqual([
      { q: 'abc', c: 3 },
      { q: 'zero', c: 1 },
      { q: 'nine', c: 1 },
      { q: 'float', c: 1 },
      { q: 'str', c: 1 },
      { q: 'unknown', c: 4 },
    ])
  })

  it('U12 그룹 9개 — 앞 8개만 남는다', () => {
    const raw = Array.from({ length: 9 }, (_, i) => ({ q: `q${i}`, c: 1 }))
    const groups = normalizeMapGroups(raw)
    expect(groups).toHaveLength(8)
    expect(groups.map((g) => g.q)).toEqual(['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'])
  })

  it('U13 그룹 왕복', () => {
    const groups = [
      { q: 'a', c: 2 },
      { q: 'b', c: 5 },
    ]
    saveMapGroups(groups)
    expect(loadMapGroups()).toEqual(groups)
  })
})
