import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ refs: [] as { current: unknown }[], refIndex: 0, fetch: vi.fn() }))

// 다시 그려도 같은 ref 를 돌려준다(호출 순서로 짝짓는다)
vi.mock('react', () => ({
  useEffect: (fn: () => (() => void) | void) => { fn() },
  useRef: <T,>(v: T) => (hoisted.refs[hoisted.refIndex++] ??= { current: v }),
  useCallback: <T,>(fn: T) => fn,
  useState: <T,>(v: T) => [v, () => {}],
}))
vi.mock('../../../src/app/githubApi', () => ({ fetchGithubStatus: hoisted.fetch }))

import { useGithubStatus as attachGithubStatus } from '../../../src/app/useGithubStatus'
import type { AccountState } from '../../../src/app/account'

// 진행 중 요청을 계정 구분 없이 돌려썼다 — 계정이 바뀌면 이전 계정의 응답을 받고 새 계정 조회는 건너뛰었다
describe('useGithubStatus 진행 중 요청은 계정마다 따로 둔다', () => {
  beforeEach(() => {
    hoisted.refs = []
    hoisted.fetch.mockReset()
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
  })
  afterEach(() => vi.unstubAllGlobals())

  function render(id: string) {
    hoisted.refIndex = 0
    return attachGithubStatus({ account: { state: 'in', id } as AccountState, bootPhase: 'booting', storeKind: 'server' })
  }

  it('u1 조회 중 u2 로 바뀌면 u2 를 새로 조회한다', () => {
    hoisted.fetch.mockReturnValue(Promise.withResolvers().promise)
    const first = render('u1').refresh()
    const second = render('u2').refresh()
    expect(hoisted.fetch).toHaveBeenCalledTimes(2)
    expect(second).not.toBe(first)
  })

  it('같은 계정은 진행 중 요청을 돌려쓴다', () => {
    hoisted.fetch.mockReturnValue(Promise.withResolvers().promise)
    const { refresh } = render('u1')
    expect(refresh()).toBe(refresh())
    expect(hoisted.fetch).toHaveBeenCalledTimes(1)
  })
})
