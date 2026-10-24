import { describe, expect, it } from 'vitest'
import { MAX_RECENT_FILES, planRecentAdd, sortRecentFiles, type RecentFileRow } from '../../../../src/lib/file/recentFiles'

const handle = {} as FileSystemFileHandle
const row = (id: string, openedAt: number, name = `${id}.md`): RecentFileRow => ({ id, handle, name, openedAt })

describe('F-2158 U1 sortRecentFiles·planRecentAdd', () => {
  it('openedAt 내림차순, 같으면 id 순', () => {
    expect(sortRecentFiles([row('b', 1), row('a', 1), row('c', 5)]).map((r) => r.id)).toEqual(['c', 'a', 'b'])
  })

  it('새 파일은 새 id 로 들어가고 지울 것이 없다', () => {
    const plan = planRecentAdd([row('a', 1)], { handle, name: '새.md', openedAt: 9 }, null, 'n1')
    expect(plan.put).toEqual({ id: 'n1', handle, name: '새.md', openedAt: 9 })
    expect(plan.remove).toEqual([])
  })

  it('같은 파일은 id 를 살리고 이름·시각을 새 값으로 갱신', () => {
    const plan = planRecentAdd([row('a', 1, '옛.md'), row('b', 2)], { handle, name: '새.md', openedAt: 9 }, 'a', 'n1')
    expect(plan.put).toEqual({ id: 'a', handle, name: '새.md', openedAt: 9 })
    expect(plan.remove).toEqual([])
  })

  it('11번째로 밀린 가장 오래된 행을 remove 에 담는다', () => {
    const rows = Array.from({ length: MAX_RECENT_FILES }, (_, i) => row(`r${i}`, i + 1))
    const plan = planRecentAdd(rows, { handle, name: 'x.md', openedAt: 100 }, null, 'n1')
    expect(plan.remove).toEqual(['r0'])
  })
})
