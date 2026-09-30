import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }))

vi.mock('react', () => ({
  useEffect: (fn: () => (() => void) | void) => { const c = fn(); if (c) hoisted.cleanups.push(c) },
  useRef: <T,>(v: T) => ({ current: v }),
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
})
