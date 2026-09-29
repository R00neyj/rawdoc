import { describe, expect, it } from 'vitest'
import { coverOverlap, parsePx } from '../../../src/lib/floatCover'

describe('F-2085 A1 parsePx', () => {
  it('길이 문자열을 px 숫자로 읽는다', () => {
    expect(parsePx('60px')).toBe(60)
    expect(parsePx(' 60.5px ')).toBe(60.5)
  })
  it('읽을 수 없거나 음수·0 이면 0', () => {
    for (const raw of ['', '0px', 'abc', '-5px', 'calc(0px + 60px)']) expect(parsePx(raw)).toBe(0)
  })
})

describe('F-2085 A1 coverOverlap', () => {
  it('앱 틀 맨 위에 붙은 대상은 cover 전부', () => {
    expect(coverOverlap({ cover: 60, shellTop: 0, targetTop: 0 })).toBe(60)
  })
  it('띠에 걸친 만큼만', () => {
    expect(coverOverlap({ cover: 60, shellTop: 0, targetTop: 52 })).toBe(8)
  })
  it('띠 아래서 시작하면 0', () => {
    expect(coverOverlap({ cover: 60, shellTop: 0, targetTop: 100 })).toBe(0)
  })
  it('앱 틀이 내려가 있어도 shellTop 을 뺀다', () => {
    expect(coverOverlap({ cover: 60, shellTop: 120, targetTop: 120 })).toBe(60)
  })
  it('cover 0 → 0', () => {
    expect(coverOverlap({ cover: 0, shellTop: 0, targetTop: 0 })).toBe(0)
  })
})
