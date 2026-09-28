import { describe, expect, it } from 'vitest'
import { parseCommandIds, pushRecentCommand, togglePinnedCommand, PALETTE_RECENT_STORE_LIMIT } from '../../../src/app/paletteMemory'

// U8 (specs/features/F-2053.md 11.1)
describe('parseCommandIds — U8', () => {
  const known = new Set(['a', 'b'])

  it.each([
    ['', []],
    ['x', []],
    ['{}', []],
    ['[1,"a","","b","a","gone"]', ['a', 'b']],
  ] as const)('%p → %p', (raw, expected) => {
    expect(parseCommandIds(raw, known)).toEqual(expected)
  })
})

describe('pushRecentCommand — U8', () => {
  it('10개 찬 목록에 새 id — 맨 앞에 들어가고 마지막이 빠진다', () => {
    const full = Array.from({ length: PALETTE_RECENT_STORE_LIMIT }, (_, i) => `c${i}`)
    const result = pushRecentCommand(full, 'new')
    expect(result[0]).toBe('new')
    expect(result).toHaveLength(PALETTE_RECENT_STORE_LIMIT)
    expect(result).not.toContain(full[full.length - 1])
  })

  it('가운데 있는 id 를 다시 고르면 맨 앞으로, 길이는 그대로', () => {
    const ids = ['a', 'b', 'c']
    const result = pushRecentCommand(ids, 'b')
    expect(result).toEqual(['b', 'a', 'c'])
  })
})

describe('togglePinnedCommand — U8', () => {
  it('없는 id 는 맨 뒤에 더한다', () => {
    expect(togglePinnedCommand(['a'], 'b')).toEqual(['a', 'b'])
  })

  it('있는 id 는 뺀다', () => {
    expect(togglePinnedCommand(['a', 'b'], 'a')).toEqual(['b'])
  })
})
