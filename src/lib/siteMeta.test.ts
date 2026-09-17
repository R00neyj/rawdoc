import { describe, it, expect } from 'vitest'
import { SITE_DESCRIPTION } from './siteMeta'

describe('siteMeta', () => {
  it('SITE_DESCRIPTION 을 문자열로 export 한다', () => {
    expect(typeof SITE_DESCRIPTION).toBe('string')
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(0)
  })
})
