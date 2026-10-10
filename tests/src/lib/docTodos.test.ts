import { describe, expect, it } from 'vitest'
import {
  findOpenTodos,
  scanTodoSources,
  groupTasks,
  parseTaskFilters,
  happensDate,
  taskUrgency,
  TODO_MAX_ITEMS,
  type TaskFilter,
  type TodoItem,
} from '../../../src/lib/docTodos'

const ALL: TaskFilter = { filters: [], hide: false }
const TAG: TaskFilter = { filters: ['#task', '#할일'], hide: false }

describe('parseTaskFilters — 쉼표로 여러 개', () => {
  it('앞뒤 공백을 떼고 빈 값은 버린다', () => {
    expect(parseTaskFilters(' #task, #할일 ,, ')).toEqual(['#task', '#할일'])
    expect(parseTaskFilters('')).toEqual([])
  })
})

describe('findOpenTodos — 목록·상태·위치 (Tasks taskRegex)', () => {
  it('-·*·+·번호 목록, 줄 번호는 1부터, 들여쓴 하위 항목은 깊이와 함께', () => {
    const text = ['- [ ] 우유', '* [ ] 달걀', '  + [ ] 아래', '1. [ ] 첫째', '2) [ ] 둘째', '- 그냥 목록'].join('\n')
    expect(findOpenTodos(text, ALL).map((t) => [t.line, t.text, t.level])).toEqual([
      [1, '우유', 0],
      [2, '달걀', 0],
      [3, '아래', 1],
      [4, '첫째', 0],
      [5, '둘째', 0],
    ])
  })

  it('상태: [ ] 할 일·[/] 진행 중은 담고 [x]·[X] 완료·[-] 취소는 뺀다. 모르는 문자는 할 일(Tasks Unknown)', () => {
    const text = ['- [ ] 가', '- [/] 나', '- [x] 다', '- [X] 라', '- [-] 마', '- [?] 바'].join('\n')
    expect(findOpenTodos(text, ALL).map((t) => [t.text, t.status])).toEqual([
      ['가', 'todo'],
      ['나', 'inProgress'],
      ['바', 'todo'],
    ])
  })

  it('펜스 코드·프론트매터 안은 빼고, 프론트매터 뒤 줄 번호는 원문 기준', () => {
    const text = ['---', 'tags: [a]', '---', '```', '- [ ] 코드 속', '```', '- [ ] 진짜'].join('\r\n')
    expect(findOpenTodos(text, ALL).map((t) => [t.line, t.text])).toEqual([[7, '진짜']])
  })

  it('괄호 안이 한 글자가 아니거나 표시와 괄호 사이 공백이 없거나 내용이 없으면 할 일이 아니다', () => {
    expect(findOpenTodos('- [ ]\n- [  ] 둘\n- [] 셋\n-[ ] 넷', ALL)).toEqual([])
  })
})

describe('findOpenTodos — 전역 필터(할 일 표시)', () => {
  it('태그 모양 표시는 태그 경계로만 — #tasks·#task/하위·a#task 는 안 맞고 #task, 는 맞는다', () => {
    const text = ['- [ ] #task 가', '- [ ] #tasks 나', '- [ ] #task/하위 다', '- [ ] a#task 라', '- [ ] 마 #task, 끝', '- [ ] #할일 바', '- [ ] 표시 없음'].join('\n')
    expect(findOpenTodos(text, TAG).map((t) => t.text)).toEqual(['#task 가', '마 #task, 끝', '#할일 바'])
  })

  it('태그가 아닌 표시는 글자 그대로 부분 일치, 비우면 모든 체크박스', () => {
    const text = '- [ ] TODOs 정리\n- [ ] 그냥'
    expect(findOpenTodos(text, { filters: ['TODO'], hide: false }).map((t) => t.text)).toEqual(['TODOs 정리'])
    expect(findOpenTodos(text, ALL)).toHaveLength(2)
  })

  it('숨기기를 켜면 글자에서 표시를 떼고(단어로 있을 때만) 공백을 정리한다', () => {
    const text = '- [ ] 보고서 #task 쓰기\n- [ ] #할일 장보기'
    expect(findOpenTodos(text, { ...TAG, hide: true }).map((t) => t.text)).toEqual(['보고서 쓰기', '장보기'])
  })
})

describe('findOpenTodos — 이모지 필드 (Tasks Emoji Format, 끝에서부터 읽는다)', () => {
  it('날짜·우선순위·반복·완료 후·id·의존을 읽고 글자에서 뗀다', () => {
    const line = '- [ ] #task 보고서 📅 2026-10-12 ⏳ 2026-10-11 🛫 2026-10-10 ➕ 2026-10-01 ⏫ 🔁 every week 🏁 delete 🆔 abc1 ⛔ x1,y2'
    const [item] = findOpenTodos(line, TAG)
    expect(item).toMatchObject({ text: '#task 보고서', due: '2026-10-12', scheduled: '2026-10-11', start: '2026-10-10', priority: 'high' })
  })

  it('변이 선택자(U+FE0F)가 붙은 이모지·다른 마감 기호(📆·🗓)·⌛ 도 읽는다', () => {
    const items = findOpenTodos('- [ ] 가 🗓\uFE0F 2026-10-12 ⏬\uFE0F\n- [ ] 나 📆 2026-10-13 ⌛ 2026-10-01', ALL)
    expect(items.map((t) => [t.text, t.due, t.scheduled, t.priority])).toEqual([
      ['가', '2026-10-12', null, 'lowest'],
      ['나', '2026-10-13', '2026-10-01', 'none'],
    ])
  })

  it('필드 사이 태그는 남겨 뒤에 붙이고, 가운데에 있는 이모지는 필드가 아니다', () => {
    expect(findOpenTodos('- [ ] 할 일 #a 📅 2026-10-12 #b', ALL)[0]).toMatchObject({ text: '할 일 #a #b', due: '2026-10-12' })
    expect(findOpenTodos('- [ ] 📅 2026-10-12 보고서', ALL)[0]).toMatchObject({ text: '📅 2026-10-12 보고서', due: null })
  })

  it('없는 날짜는 글자에서만 떼고 날짜로 쓰지 않는다. 끝의 블록 링크(^id)도 뗀다', () => {
    expect(findOpenTodos('- [ ] 가 📅 2026-02-30 ^blk-1', ALL)[0]).toMatchObject({ text: '가', due: null })
  })

  it('우선순위 다섯 단계', () => {
    const text = ['🔺', '⏫', '🔼', '🔽', '⏬'].map((p, i) => `- [ ] t${i} ${p}`).join('\n')
    expect(findOpenTodos(text, ALL).map((t) => t.priority)).toEqual(['highest', 'high', 'medium', 'low', 'lowest'])
  })
})

const item = (over: Partial<TodoItem>): TodoItem => ({ line: 1, text: 't', level: 0, status: 'todo', due: null, scheduled: null, start: null, priority: 'none', ...over })

describe('happensDate·taskUrgency — Tasks Dates·Urgency 문서', () => {
  it('happens 는 시작·예정·마감 중 가장 이른 날, 하나도 없으면 null', () => {
    expect(happensDate(item({ start: '2026-10-15', scheduled: '2026-10-12', due: '2026-10-20' }))).toBe('2026-10-12')
    expect(happensDate(item({}))).toBeNull()
  })

  it('긴급도 = 마감 + 우선순위 + 예정 + 시작 점수 (문서 예시 세 개)', () => {
    const today = '2026-10-11'
    expect(taskUrgency(item({ due: today, priority: 'medium' }), today)).toBeCloseTo(12.7, 5)
    expect(taskUrgency(item({ priority: 'high', scheduled: '2026-10-10', start: '2026-10-10' }), today)).toBeCloseTo(11, 5)
    expect(taskUrgency(item({ priority: 'high', scheduled: '2026-10-12', start: '2026-10-12' }), today)).toBeCloseTo(3, 5)
  })

  it('마감 점수는 7일 지남 12, 14일 남음 이후 2.4 로 끝이 막힌다', () => {
    expect(taskUrgency(item({ due: '2026-09-01' }), '2026-10-11')).toBeCloseTo(12 + 1.95, 5)
    expect(taskUrgency(item({ due: '2026-12-31' }), '2026-10-11')).toBeCloseTo(2.4 + 1.95, 5)
  })
})

describe('scanTodoSources·groupTasks — 날짜 묶음과 정렬', () => {
  const docs = [
    { id: 'a', title: '가 문서', content: ['- [ ] #task 지난 마감 📅 2026-10-10', '- [ ] #task 오늘 예정 ⏳ 2026-10-11', '- [ ] #task 나중 🛫 2026-10-15 📅 2026-10-20', '- [ ] #task 날짜 없음'].join('\n'), updatedAt: 1 },
    { id: 'b', title: '나 문서', content: ['- [/] #task 진행 중', '- [ ] #task 높음 ⏫', '- [ ] 표시 없음'].join('\n'), updatedAt: 2 },
    { id: 'lock', title: '', content: '', updatedAt: 3, e2ee: 'locked' as const },
  ]

  it('묶음은 기한 지남·오늘·예정·날짜 없음 순, 빈 묶음은 없다. 잠긴 금고는 센다', () => {
    const scanned = scanTodoSources(docs, null, TAG)
    expect(scanned.lockedCount).toBe(1)
    const { groups } = groupTasks(scanned.docs, '2026-10-11')
    expect(groups.map((g) => [g.bucket, g.items.map((i) => i.text)])).toEqual([
      ['overdue', ['#task 지난 마감']],
      ['today', ['#task 오늘 예정']],
      ['upcoming', ['#task 나중']],
      ['none', ['#task 진행 중', '#task 높음', '#task 날짜 없음']],
    ])
    expect(groups[3].items[0]).toMatchObject({ docId: 'b', docTitle: '나 문서' })
  })

  it('자정이 지나면 오늘 마감이 기한 지남으로 옮겨 간다(기기 날짜 기준)', () => {
    const scanned = scanTodoSources([{ id: 'a', title: 'A', content: '- [ ] 마감 📅 2026-10-11' }], null, ALL)
    expect(groupTasks(scanned.docs, '2026-10-11').groups.map((g) => g.bucket)).toEqual(['today'])
    expect(groupTasks(scanned.docs, '2026-10-12').groups.map((g) => g.bucket)).toEqual(['overdue'])
  })

  it('묶음 안은 Tasks 기본 정렬 — 진행 중 먼저, 긴급도 높은 순, 마감 이른 순, 우선순위, 문서 제목', () => {
    const scanned = scanTodoSources([
      { id: 'z', title: '하 문서', content: '- [ ] 늦은 마감 📅 2026-10-25\n- [ ] 이른 마감 📅 2026-10-20' },
      { id: 'y', title: '가 문서', content: '- [ ] 이른 마감 같은 날 📅 2026-10-20' },
    ], null, ALL)
    const [group] = groupTasks(scanned.docs, '2026-10-11').groups
    expect(group.items.map((i) => [i.docTitle, i.text])).toEqual([
      ['가 문서', '이른 마감 같은 날'],
      ['하 문서', '이른 마감'],
      ['하 문서', '늦은 마감'],
    ])
  })

  it(`항목이 ${TODO_MAX_ITEMS}개를 넘으면 정렬한 뒤 앞에서 자른다`, () => {
    const many = Array.from({ length: TODO_MAX_ITEMS + 5 }, (_, i) => `- [ ] 일 ${i}`).join('\n')
    const scanned = scanTodoSources([{ id: 'big', title: '큰 문서', content: many }], null, ALL)
    const result = groupTasks(scanned.docs, '2026-10-11')
    expect(result.truncated).toBe(true)
    expect(result.groups.reduce((n, g) => n + g.items.length, 0)).toBe(TODO_MAX_ITEMS)
  })
})
