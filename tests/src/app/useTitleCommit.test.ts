import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ cleanups: [] as (() => void)[], refs: null as { current: unknown }[] | null, refIndex: 0 }))

// refs 를 주면 다시 그려도 같은 ref 를 돌려준다(호출 순서로 짝짓는다)
vi.mock('react', () => ({
  useEffect: (fn: () => (() => void) | void) => { const c = fn(); if (c) hoisted.cleanups.push(c) },
  useRef: <T,>(v: T) => (hoisted.refs ? (hoisted.refs[hoisted.refIndex++] ??= { current: v }) : { current: v }),
  useCallback: <T,>(fn: T) => fn,
}))

import { useTitleCommit as attachTitleCommit, type UseTitleCommitOptions } from '../../../src/app/useTitleCommit'

const ref = <T,>(current: T) => ({ current })

// 공백 제목 되돌림은 제목칸 blur 에서만 돌았다 — 커서를 둔 채 탭을 닫거나 앱을 배경으로 보내면 '' 가 그대로 저장돼 있었다
describe('useTitleCommit 탭이 숨겨지거나 닫힐 때 공백 제목 되돌림', () => {
  let docListeners: Record<string, () => void>
  let winListeners: Record<string, () => void>
  let removed: string[]
  let visibilityState: string

  beforeEach(() => {
    docListeners = {}
    winListeners = {}
    removed = []
    visibilityState = 'visible'
    hoisted.cleanups = []
    vi.stubGlobal('document', {
      get visibilityState() { return visibilityState },
      addEventListener: (type: string, fn: () => void) => { docListeners[type] = fn },
      removeEventListener: (type: string) => { removed.push(`document:${type}`) },
    })
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: () => void) => { winListeners[type] = fn },
      removeEventListener: (type: string) => { removed.push(`window:${type}`) },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  function setup(title: string) {
    const update = vi.fn(async () => ({ id: 'A', updatedAt: 2 }))
    attachTitleCommit({
      store: { update },
      currentDocId: 'A',
      isRealtime: false,
      setDocs: vi.fn(),
      showNotice: vi.fn(),
      editorRef: ref(null),
      titleSavingRef: ref(null),
      docsRef: ref([{ id: 'A', title }]),
      currentDocIdRef: ref('A'),
    } as unknown as UseTitleCommitOptions)
    return update
  }

  it('탭이 숨겨지면 공백 제목을 되돌린다', () => {
    const update = setup('')
    visibilityState = 'hidden'
    docListeners['visibilitychange']()
    expect(update).toHaveBeenCalledWith('A', { title: '제목 없는 문서' })
  })

  it('탭이 다시 보일 때는 건드리지 않는다', () => {
    const update = setup('')
    docListeners['visibilitychange']()
    expect(update).not.toHaveBeenCalled()
  })

  it('창이 닫힐 때(pagehide)도 되돌린다 — 공백뿐인 제목까지', () => {
    const update = setup('   ')
    winListeners['pagehide']()
    expect(update).toHaveBeenCalledWith('A', { title: '제목 없는 문서' })
  })

  it('제목이 있으면 숨겨져도 그대로 둔다', () => {
    const update = setup('메모')
    visibilityState = 'hidden'
    docListeners['visibilitychange']()
    expect(update).not.toHaveBeenCalled()
  })

  it('정리 단계가 리스너 둘을 뗀다', () => {
    setup('')
    hoisted.cleanups.forEach((c) => c())
    expect(removed).toContain('document:visibilitychange')
    expect(removed).toContain('window:pagehide')
  })

  // 위키링크 함께 고치기(small 2026-10-24)는 제목 칸에서 나갈 때만 묻는다 — 탭 숨김·창 닫기에 대화상자를 띄우지 않는다
  it('onTitleLeave 는 blur·Enter(handleTitleCommit)에서만 부른다', () => {
    const onTitleLeave = vi.fn()
    const { handleTitleCommit } = attachTitleCommit({
      store: { update: vi.fn(async () => ({ id: 'A', updatedAt: 2 })) },
      currentDocId: 'A',
      isRealtime: false,
      setDocs: vi.fn(),
      showNotice: vi.fn(),
      editorRef: ref(null),
      titleSavingRef: ref(null),
      docsRef: ref([{ id: 'A', title: '메모' }]),
      currentDocIdRef: ref('A'),
      onTitleLeave,
    } as unknown as UseTitleCommitOptions)
    visibilityState = 'hidden'
    docListeners['visibilitychange']()
    winListeners['pagehide']()
    expect(onTitleLeave).not.toHaveBeenCalled()
    handleTitleCommit()
    expect(onTitleLeave).toHaveBeenCalledTimes(1)
  })
})

// 요청 번호가 문서 사이에 하나였다 — A 저장 중 B 를 저장하면 A 의 updatedAt 이 버려졌다
describe('useTitleCommit 요청 번호는 문서마다 따로 센다', () => {
  beforeEach(() => {
    hoisted.refs = []
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
  })
  afterEach(() => {
    hoisted.refs = null
    vi.unstubAllGlobals()
  })

  it('A 저장 뒤 B 를 저장해도 A 의 응답을 반영한다', async () => {
    const a = Promise.withResolvers<{ id: string; updatedAt: number }>()
    const update = vi.fn((id: string) => (id === 'A' ? a.promise : Promise.resolve({ id: 'B', updatedAt: 5 })))
    const setDocs = vi.fn()
    const render = (currentDocId: string) => {
      hoisted.refIndex = 0
      return attachTitleCommit({
        store: { update },
        currentDocId,
        isRealtime: false,
        setDocs,
        showNotice: vi.fn(),
        editorRef: ref(null),
        titleSavingRef: ref(null),
        docsRef: ref([]),
        currentDocIdRef: ref(currentDocId),
      } as unknown as UseTitleCommitOptions)
    }
    render('A').handleTitleChange('가')
    render('B').handleTitleChange('나')
    a.resolve({ id: 'A', updatedAt: 9 })
    await a.promise
    const docs = [{ id: 'A', title: '', updatedAt: 1 }, { id: 'B', title: '', updatedAt: 1 }]
    const applied = setDocs.mock.calls.map(([fn]) => fn(docs) as { id: string; updatedAt: number }[])
    expect(applied.some((list) => list.find((d) => d.id === 'A')?.updatedAt === 9)).toBe(true)
  })
})
