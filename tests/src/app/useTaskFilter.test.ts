import { describe, expect, it } from 'vitest'
import { DEFAULT_TASK_FILTER } from '../../../src/app/useTaskFilter'
import { findOpenTodos, parseTaskFilters } from '../../../src/lib/docTodos'

describe('기본 할 일 표시', () => {
  it('설정을 바꾸지 않으면 #task·#할일·#todo 가 붙은 체크박스만 할 일이다', () => {
    const text = ['- [ ] #task 가', '- [ ] #할일 나', '- [ ] #todo 다', '- [ ] #todos 라', '- [ ] 표시 없음'].join('\n')
    const filter = { filters: parseTaskFilters(DEFAULT_TASK_FILTER), hide: false }
    expect(findOpenTodos(text, filter).map((t) => t.text)).toEqual(['#task 가', '#할일 나', '#todo 다'])
  })
})
