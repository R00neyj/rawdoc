// 리뷰 A3 — 다른 탭 신호로 목록을 다시 읽을 때의 병합
import { describe, expect, it } from 'vitest'
import { mergeResyncList } from './resyncList'

type Meta = { id: string; updatedAt: number; role?: 'owner' | 'edit' | 'view' }

const own = (id: string, updatedAt: number): Meta => ({ id, updatedAt, role: 'owner' })
const shared = (id: string, updatedAt: number): Meta => ({ id, updatedAt, role: 'edit' })

describe('mergeResyncList', () => {
  it('요청 전에 있었고 결과에 없는 내 문서는 지운 것으로 본다', () => {
    const snapshot = [own('a', 2), own('b', 1)]
    const { docs, removedIds } = mergeResyncList({ snapshot, current: snapshot, result: [own('a', 2)] })
    expect(docs.map((d) => d.id)).toEqual(['a'])
    expect(removedIds).toEqual(['b'])
  })

  it('요청 뒤 새로 만든 문서는 결과에 없어도 남긴다', () => {
    const snapshot = [own('a', 2)]
    const current = [own('new', 5), own('a', 2)]
    const { docs, removedIds } = mergeResyncList({ snapshot, current, result: [own('a', 2)] })
    expect(docs.map((d) => d.id)).toEqual(['new', 'a'])
    expect(removedIds).toEqual([])
  })

  it('결과에 공유받은 문서가 하나도 없으면(공유 목록 읽기 실패와 구별할 수 없음) 공유 문서를 지우지 않는다', () => {
    const snapshot = [own('a', 2), shared('s', 3)]
    const { docs, removedIds } = mergeResyncList({ snapshot, current: snapshot, result: [own('a', 2)] })
    expect(docs.map((d) => d.id)).toEqual(['s', 'a'])
    expect(removedIds).toEqual([])
  })

  it('결과에 공유받은 문서가 있으면 공유 목록은 읽힌 것 — 빠진 공유 문서는 지운 것으로 본다', () => {
    const snapshot = [own('a', 2), shared('s', 3), shared('t', 1)]
    const { docs, removedIds } = mergeResyncList({ snapshot, current: snapshot, result: [own('a', 2), shared('t', 1)] })
    expect(docs.map((d) => d.id)).toEqual(['a', 't'])
    expect(removedIds).toEqual(['s'])
  })

  it('결과의 새 값으로 바꾸고 updatedAt 내림차순으로 정렬한다', () => {
    const snapshot = [own('a', 2), own('b', 1)]
    const { docs } = mergeResyncList({ snapshot, current: snapshot, result: [own('a', 2), own('b', 9), own('c', 4)] })
    expect(docs.map((d) => [d.id, d.updatedAt])).toEqual([
      ['b', 9],
      ['c', 4],
      ['a', 2],
    ])
  })
})
