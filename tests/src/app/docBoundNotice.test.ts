// 리뷰 A5 — `새 문서로 저장` 알림을 만든 문서에 묶는다
import { describe, expect, it, vi } from 'vitest'
import { guardForDoc, staleDocBoundNotices } from '../../../src/app/docBoundNotice'

describe('guardForDoc', () => {
  it('지금 문서가 알림을 만든 문서면 실행한다', () => {
    const run = vi.fn()
    guardForDoc('a', () => 'a', run)()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('다른 문서로 옮긴 뒤 누르면 실행하지 않는다', () => {
    const run = vi.fn()
    guardForDoc('a', () => 'b', run)()
    guardForDoc('a', () => null, run)()
    expect(run).not.toHaveBeenCalled()
  })
})

describe('staleDocBoundNotices', () => {
  it('지금 문서가 아닌 문서에 묶인 알림 id 만 돌려준다', () => {
    const bound = new Map([
      [1, 'a'],
      [2, 'b'],
      [3, 'a'],
    ])
    expect(staleDocBoundNotices(bound, 'a')).toEqual([2])
    expect(staleDocBoundNotices(bound, null)).toEqual([1, 2, 3])
  })
})
