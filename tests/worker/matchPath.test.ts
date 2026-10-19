import { describe, expect, it, vi } from 'vitest'
import { matchPath } from '../../worker/index'

// index → docRoom → partyserver → cloudflare:workers 는 node 에서 풀리지 않는다 (F-304)
vi.mock('../../worker/docRoom', () => ({ DocRoom: class {} }))

describe('matchPath', () => {
  it('퍼센트 인코딩된 세그먼트를 디코드한다', () => {
    expect(matchPath('/api/docs/:id', '/api/docs/a%20b')).toEqual({ id: 'a b' })
  })

  it('잘못된 퍼센트 인코딩은 던지지 않고 매치하지 않는다', () => {
    expect(matchPath('/api/docs/:id', '/api/docs/%E0%A4%A')).toBeNull()
    expect(matchPath('/api/docs/:id', '/api/docs/%')).toBeNull()
  })
})
