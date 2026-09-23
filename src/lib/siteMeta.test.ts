import { describe, it, expect } from 'vitest'
import { SITE_DESCRIPTION, SITE_URL } from './siteMeta'

describe('siteMeta', () => {
  it('SITE_DESCRIPTION 을 문자열로 export 한다', () => {
    expect(typeof SITE_DESCRIPTION).toBe('string')
    expect(SITE_DESCRIPTION.length).toBeGreaterThan(0)
  })

  it('SITE_URL 은 https://rawdoc.app/ 이다', () => {
    expect(SITE_URL).toBe('https://rawdoc.app/')
  })
})
