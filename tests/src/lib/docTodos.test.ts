import { describe, expect, it } from 'vitest'
import { findOpenTodos, scanTodoSources, groupTodos, TODO_MAX_ITEMS } from '../../../src/lib/docTodos'

describe('findOpenTodos — 한 문서의 미완료 체크박스', () => {
  it('-·*·+·번호 목록의 [ ] 항목을 줄 번호(1부터)와 함께. [x]·[X] 는 뺀다', () => {
    const text = ['- [ ] 우유', '- [x] 빵', '* [ ] 달걀', '+ [X] 끝남', '1. [ ] 첫째', '2) [ ] 둘째', '- 그냥 목록'].join('\n')
    expect(findOpenTodos(text).map((t) => [t.line, t.text])).toEqual([
      [1, '우유'],
      [3, '달걀'],
      [5, '첫째'],
      [6, '둘째'],
    ])
  })

  it('들여쓴 하위 항목도 담고 깊이를 남긴다', () => {
    const text = '- [ ] 위\n  - [ ] 아래\n    - [ ] 더 아래\n- [ ] 다시 위'
    expect(findOpenTodos(text).map((t) => [t.text, t.level])).toEqual([
      ['위', 0],
      ['아래', 1],
      ['더 아래', 2],
      ['다시 위', 0],
    ])
  })

  it('펜스 코드·프론트매터 안은 뺀다. 프론트매터 뒤 줄 번호는 원문 기준', () => {
    const text = ['---', 'tags: [a]', '---', '```', '- [ ] 코드 속', '```', '- [ ] 진짜'].join('\r\n')
    expect(findOpenTodos(text)).toEqual([{ line: 7, text: '진짜', level: 0 }])
  })

  it('[ ] 뒤 내용이 없거나 괄호 안이 공백 하나가 아니면 할 일이 아니다', () => {
    expect(findOpenTodos('- [ ]\n- [  ] 둘\n- [] 셋\n-[ ] 넷')).toEqual([])
  })
})

describe('scanTodoSources·groupTodos — 문서별 묶음', () => {
  const docs = [
    { id: 'old', title: '옛 문서', content: '- [ ] 오래됨', updatedAt: 1 },
    { id: 'cur', title: '지금', content: '- [ ] 저장본', updatedAt: 9 },
    { id: 'new', title: '새 문서', content: '- [ ] 최근', updatedAt: 5 },
    { id: 'none', title: '없음', content: '- [x] 끝', updatedAt: 7 },
    { id: 'lock', title: '', content: '', updatedAt: 8, e2ee: 'locked' as const },
    { id: 'shared', title: '공유받음', content: '', updatedAt: 6 },
  ]

  it('지금 문서 묶음이 맨 위(편집기 본문 기준), 나머지는 최근 수정순. 할 일 없는 문서·본문을 못 읽은 문서는 묶음이 없다', () => {
    const scanned = scanTodoSources(docs, 'cur')
    expect(scanned.lockedCount).toBe(1)
    const current = { id: 'cur', title: '지금', items: findOpenTodos('- [ ] 편집 중') }
    const result = groupTodos(current, scanned.docs)
    expect(result.groups.map((g) => [g.id, g.items.map((i) => i.text)])).toEqual([
      ['cur', ['편집 중']],
      ['new', ['최근']],
      ['old', ['오래됨']],
    ])
    expect(result.truncated).toBe(false)
  })

  it('지금 문서가 없으면 저장본으로 모든 문서를 최근 수정순', () => {
    expect(groupTodos(null, scanTodoSources(docs, null).docs).groups.map((g) => g.id)).toEqual(['cur', 'new', 'old'])
  })

  it('지금 문서에 할 일이 없으면 그 묶음은 없다', () => {
    const result = groupTodos({ id: 'cur', title: '지금', items: [] }, scanTodoSources(docs, 'cur').docs)
    expect(result.groups.map((g) => g.id)).toEqual(['new', 'old'])
  })

  it(`항목이 ${TODO_MAX_ITEMS}개를 넘으면 앞에서 자르고 묶음 개수는 그 문서 전체 수`, () => {
    const many = Array.from({ length: TODO_MAX_ITEMS + 5 }, (_, i) => `- [ ] 일 ${i}`).join('\n')
    const scanned = scanTodoSources([{ id: 'big', title: '큰 문서', content: many, updatedAt: 2 }, docs[0]], null)
    const result = groupTodos(null, scanned.docs)
    expect(result.truncated).toBe(true)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].items).toHaveLength(TODO_MAX_ITEMS)
    expect(result.groups[0].total).toBe(TODO_MAX_ITEMS + 5)
  })
})
