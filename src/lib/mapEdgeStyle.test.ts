import { describe, it, expect } from 'vitest'
import { edgeColorAt, type EdgeColorStops } from './mapEdgeStyle'

const stops: EdgeColorStops = {
  panel: [1, 1, 1, 1],
  rule: [0.5, 0.5, 0.5, 1],
  ink: [0, 0, 0, 1],
}

describe('edgeColorAt (12.1 U14~U18)', () => {
  it('U14 strength 0 — panel 과 같다', () => {
    expect(edgeColorAt(0, stops)).toEqual(stops.panel)
  })

  it('U15 strength 0.5 — rule 과 같다', () => {
    expect(edgeColorAt(0.5, stops)).toEqual(stops.rule)
  })

  it('U16 strength 1 — ink 와 같다', () => {
    expect(edgeColorAt(1, stops)).toEqual(stops.ink)
  })

  it('U17 0.25 는 panel~rule 정확한 중간, 0.75 는 rule~ink 정확한 중간', () => {
    const quarter = edgeColorAt(0.25, stops)
    expect(quarter[0]).toBeCloseTo(0.75, 10)
    expect(quarter[1]).toBeCloseTo(0.75, 10)
    expect(quarter[2]).toBeCloseTo(0.75, 10)

    const threeQuarter = edgeColorAt(0.75, stops)
    expect(threeQuarter[0]).toBeCloseTo(0.25, 10)
    expect(threeQuarter[1]).toBeCloseTo(0.25, 10)
    expect(threeQuarter[2]).toBeCloseTo(0.25, 10)
  })

  it('U18 범위 밖·유한수 아님', () => {
    expect(edgeColorAt(-1, stops)).toEqual(edgeColorAt(0, stops))
    expect(edgeColorAt(2, stops)).toEqual(edgeColorAt(1, stops))
    expect(edgeColorAt(NaN, stops)).toEqual(edgeColorAt(0.5, stops))
    expect(edgeColorAt(Infinity, stops)).toEqual(edgeColorAt(0.5, stops))
  })
})
