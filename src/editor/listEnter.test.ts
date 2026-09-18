// 조합 중 Enter 목록 이어쓰기 (specs/features/F-245.md) — DOM 없는 환경(vitest node)이라 실제 EditorView 대신 { composing, state, dispatch } fake target 으로 handleComposingEnter() 를 확인한다
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Transaction } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'

import { handleComposingEnter } from './composition'
import { insertNewlineContinueList } from './listEnter'

function fakeEvent(overrides: Partial<{ key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) {
  let prevented = false
  return {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
    preventDefault() {
      prevented = true
    },
    get defaultPrevented() {
      return prevented
    },
  }
}

// 조합 중을 흉내낸 Enter — doc 끝에 커서를 두고 실행해 결과 문서를 돌려준다
function runComposingEnter(doc: string) {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [markdown()] })
  let result = state
  const event = fakeEvent()
  const handled = handleComposingEnter(
    {
      composing: true,
      state,
      dispatch(tr: Transaction) {
        result = state.update(tr).state
      },
    },
    event,
  )
  return { handled, prevented: event.defaultPrevented, doc: result.doc.toString() }
}

describe('F-245 A1~A5 조합 중 Enter — 단위', () => {
  it('A1 글머리 — 목록 이어쓰기', () => {
    const { handled, prevented, doc } = runComposingEnter('- 테스트')
    expect(handled).toBe(true)
    expect(prevented).toBe(true)
    expect(doc).toBe('- 테스트\n- ')
  })

  it('A2 순서 목록 — 번호 증가', () => {
    const { doc } = runComposingEnter('1. 테스트')
    expect(doc).toBe('1. 테스트\n2. ')
  })

  it('A3 체크박스 — 기호 유지', () => {
    const { doc } = runComposingEnter('- [ ] 테스트')
    expect(doc).toBe('- [ ] 테스트\n- [ ] ')
  })

  it('A4 중첩 목록 — 들여쓰기 유지', () => {
    const { doc } = runComposingEnter('  - 테스트')
    expect(doc).toBe('  - 테스트\n  - ')
  })

  // 항목 2개짜리 tight list 는 빈 마지막 항목 엔터가 non-tight 로 바꿀 뿐 안 끝낸다(CM6 규칙, F-245 무관) — 항목 3개로 피한다
  it('A5 빈 목록 항목 — 목록을 끝낸다(기호 지우고 빈 줄)', () => {
    const { doc } = runComposingEnter('- 항목\n- 둘째\n- ')
    expect(doc).toBe('- 항목\n- 둘째\n')
  })
})

// 진짜 원인(F-245.md 6.2) — 조합과 무관하게 일반 Enter 로도 100% 재현된다
function runEnter(doc: string) {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [markdown()] })
  let result = state
  insertNewlineContinueList({
    state,
    dispatch(tr: Transaction) {
      result = state.update(tr).state
    },
  })
  return result.doc.toString()
}

describe('F-245 A11~A16 빈 목록 항목 Enter — 단위', () => {
  it('A11 항목 2개 — 빈 항목 Enter 는 빈 줄도 기호도 없이 목록을 끝낸다', () => {
    expect(runEnter('- 하나\n- ')).toBe('- 하나\n')
  })

  it('A12 항목 2개 — 체크박스도 같다', () => {
    expect(runEnter('- [x] test\n- [ ] ')).toBe('- [x] test\n')
  })

  it('A14 항목 1개·3개 — 지금처럼 목록이 끝난다(회귀)', () => {
    expect(runEnter('- ')).toBe('')
    expect(runEnter('- 하나\n- 둘\n- ')).toBe('- 하나\n- 둘\n')
  })

  it('A16 순서 목록·중첩 — 각각 목록이 끝난다', () => {
    expect(runEnter('1. 하나\n2. ')).toBe('1. 하나\n')
    expect(runEnter('  - 하나\n  - ')).toBe('  - 하나\n')
  })
})

// F-245 6.5 A15 를 뒤집는다 — loose 목록 이어쓰기가 빈 줄을 새로 만들지 않는다 (specs/features/F-253.md)
describe('F-253 B2~B9 빈 줄로 끊긴(loose) 목록 Enter — 단위', () => {
  it('B2 loose 글머리 — 새 빈 줄 없이 바로 다음 줄, 원래 빈 줄은 그대로', () => {
    expect(runEnter('- 하나\n\n- 둘')).toBe('- 하나\n\n- 둘\n- ')
  })

  it('B3 loose 체크박스', () => {
    expect(runEnter('- [x] 완료\n\n- 테스트')).toBe('- [x] 완료\n\n- 테스트\n- ')
  })

  it('B4 loose 순서 목록 — 번호 증가 유지', () => {
    expect(runEnter('1. 하나\n\n2. 둘')).toBe('1. 하나\n\n2. 둘\n3. ')
  })

  it('B5 loose 중첩 — 들여쓰기 유지한 채 바로 다음 줄', () => {
    expect(runEnter('- 하나\n\n  - 둘')).toBe('- 하나\n\n  - 둘\n  - ')
  })

  it('B8 loose 목록 빈 항목 Enter — 목록이 끝난다, 앞의 빈 줄은 그대로', () => {
    expect(runEnter('- 하나\n\n- ')).toBe('- 하나\n\n')
  })

  it('B9 인용문 안 목록 — 바로 다음 줄에 인용 기호와 목록 기호', () => {
    expect(runEnter('> - 하나\n>\n> - 둘')).toBe('> - 하나\n>\n> - 둘\n> - ')
  })
})

function fakeState(doc: string) {
  return EditorState.create({ doc, selection: EditorSelection.cursor(doc.length), extensions: [markdown()] })
}

describe('handleComposingEnter 가드 조건', () => {
  it('composing 이 아니면 건드리지 않는다', () => {
    const state = fakeState('- 테스트')
    let dispatched = false
    const event = fakeEvent()
    const handled = handleComposingEnter(
      { composing: false, state, dispatch: () => { dispatched = true } },
      event,
    )
    expect(handled).toBe(false)
    expect(dispatched).toBe(false)
    expect(event.defaultPrevented).toBe(false)
  })

  it('Enter 가 아니면 건드리지 않는다', () => {
    const state = fakeState('- 테스트')
    const event = fakeEvent({ key: 'a' })
    const handled = handleComposingEnter({ composing: true, state, dispatch: () => {} }, event)
    expect(handled).toBe(false)
  })

  it('Shift-Enter 는 건드리지 않는다(줄바꿈은 markdownKeymap 바인딩 밖)', () => {
    const state = fakeState('- 테스트')
    const event = fakeEvent({ shiftKey: true })
    const handled = handleComposingEnter({ composing: true, state, dispatch: () => {} }, event)
    expect(handled).toBe(false)
  })
})
