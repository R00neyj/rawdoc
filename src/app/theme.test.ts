import { describe, expect, it } from 'vitest'
import { THEME_OPTIONS } from './theme'

describe('THEME_OPTIONS — U9 (F-2054 3.5)', () => {
  it('값·라벨이 시스템·화이트·세피아·다크 순서', () => {
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(['system', 'white', 'sepia', 'dark'])
    expect(THEME_OPTIONS.map((o) => o.label)).toEqual(['시스템', '화이트', '세피아', '다크'])
  })
})
