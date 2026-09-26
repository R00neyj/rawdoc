// 댓글 편집기 표시 — 매핑·장식·거터 세기·다시 풀기·IME·후보 (specs/features/F-504.md 9.1~9.3)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { ChangeSpec, Transaction, TransactionSpec } from '@codemirror/state'
import { copyLineDown, indentMore, moveLineDown, moveLineUp } from '@codemirror/commands'

import { createCommentAnchor, resolveCommentAnchor } from '../lib/commentAnchor'
import { commentQuote } from '../lib/docComments'
import type { AnchorRange, CommentAnchor } from '../lib/docComments'
import { Y_COMMENTS_NAME } from '../lib/docRoomProtocol'
import { forceRecalc } from './composition'
import { REMOTE_HOLD_CHECK_MS } from './remoteGate'
import {
  COMMENT_RERESOLVE_MS,
  commentField,
  commentGutterCount,
  commentGutterPick,
  commentMarks,
  createCommentSync,
  observeCommentKeys,
} from './commentMarks'

vi.mock('../lib/commentAnchor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/commentAnchor')>()
  return { ...actual, resolveCommentAnchor: vi.fn(actual.resolveCommentAnchor) }
})

const resolveSpy = vi.mocked(resolveCommentAnchor)

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const LOCAL = { local: true }
const T = 'hello world foo\nline two here\nline three\n'
const NOBODY = { id: null, email: null }

let createdAt = 1

function rootEntry(anchor: CommentAnchor | null, quote: string, resolved = false) {
  return {
    v: 1,
    parent: null,
    anchor,
    quote: quote.length > 0 ? commentQuote(quote) : 'q',
    body: '의견',
    mentions: [],
    author: NOBODY,
    createdAt: createdAt++,
    resolved: resolved ? { by: NOBODY, at: 5 } : null,
  }
}

function replyEntry(parent: string) {
  return {
    v: 1,
    parent,
    anchor: null,
    quote: '',
    body: '답글',
    mentions: [],
    author: NOBODY,
    createdAt: createdAt++,
    resolved: null,
  }
}

// y-sync.js 와 같은 번역 — 로컬은 지우고 같은 자리에 넣기, 원격·되돌리기는 delta → changes (9장 머리말)
function setup(text: string) {
  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  ytext.insert(0, text)
  const map = doc.getMap<unknown>(Y_COMMENTS_NAME)
  const um = new Y.UndoManager(ytext, { trackedOrigins: new Set([LOCAL]), captureTimeout: 0 })
  let state = EditorState.create({ doc: text, extensions: [commentMarks()] })
  const flags = { composing: false, alive: true }
  let dispatches = 0

  const sync = createCommentSync({
    getState: () => state,
    dispatch: (spec: TransactionSpec) => {
      dispatches++
      apply(state.update(spec))
    },
    ytext,
    map,
    isComposing: () => flags.composing,
    isAlive: () => flags.alive,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })

  function apply(tr: Transaction) {
    state = tr.state
    sync.afterUpdate({ transactions: [tr] })
  }

  ytext.observe((event, tr) => {
    if (tr.origin === LOCAL) return
    const changes: ChangeSpec[] = []
    let pos = 0
    for (const d of event.delta) {
      if (d.insert != null) changes.push({ from: pos, to: pos, insert: d.insert as string })
      else if (d.delete != null) {
        changes.push({ from: pos, to: pos + d.delete, insert: '' })
        pos += d.delete
      } else pos += d.retain!
    }
    apply(state.update({ changes }))
  })

  const unobserve = observeCommentKeys(map, (keys) => sync.mapChanged(keys))

  function local(tr: Transaction) {
    apply(tr)
    doc.transact(() => {
      let adj = 0
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const s = inserted.sliceString(0, inserted.length, '\n')
        if (fromA !== toA) ytext.delete(fromA + adj, toA - fromA)
        if (s.length > 0) ytext.insert(fromA + adj, s)
        adj += s.length - (toA - fromA)
      })
    }, LOCAL)
  }

  function edit(changes: ChangeSpec) {
    local(state.update({ changes }))
  }

  function cmd(fn: (t: { state: EditorState; dispatch: (tr: Transaction) => void }) => boolean, cursor: number) {
    apply(state.update({ selection: EditorSelection.single(cursor) }))
    fn({ state, dispatch: (tr) => local(tr) })
  }

  function addThread(id: string, from: number, to: number, resolved = false) {
    const anchor = createCommentAnchor(ytext, from, to)
    map.set(id, rootEntry(anchor, ytext.toString().slice(from, to), resolved))
    return anchor
  }

  function remoteDoc() {
    const r = new Y.Doc()
    Y.applyUpdate(r, Y.encodeStateAsUpdate(doc))
    return r
  }

  return {
    doc,
    ytext,
    map,
    um,
    sync,
    flags,
    unobserve,
    get state() {
      return state
    },
    get dispatches() {
      return dispatches
    },
    resetDispatches() {
      dispatches = 0
    },
    field: () => state.field(commentField),
    range: (id: string) => state.field(commentField).ranges.get(id),
    apply,
    edit,
    cmd,
    local,
    addThread,
    remoteDoc,
    forced() {
      apply(state.update({ effects: forceRecalc.of(null) }))
    },
    select(from: number, to: number) {
      apply(state.update({ selection: EditorSelection.single(from, to) }))
    },
  }
}

type Marks = { cls: string; id: string | undefined; from: number; to: number; point: boolean }

function marksOf(h: ReturnType<typeof setup>): Marks[] {
  const out: Marks[] = []
  h.field().decorations.between(0, h.state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; attributes?: Record<string, string> }
    out.push({ cls: spec.class ?? '', id: spec.attributes?.['data-thread-id'], from, to, point: deco.point })
  })
  return out
}

async function microtasks() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('F-504 9.1 필드 — 매핑·장식·거터 세기', () => {
  it.each([
    ['가운데 입력', { from: 8, insert: 'X' }, { from: 6, to: 12 }],
    ['시작 바로 앞', { from: 6, insert: 'X' }, { from: 7, to: 12 }],
    ['끝 바로 뒤', { from: 11, insert: 'X' }, { from: 6, to: 11 }],
    ['굵게로 감쌈', [{ from: 6, insert: '**' }, { from: 11, insert: '**' }], { from: 8, to: 13 }],
  ] as [string, ChangeSpec, AnchorRange][])('A1 %s', (_name, changes, expected) => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit(changes)
    expect(h.range('a')).toEqual(expected)
    expect(h.field().pending.size).toBe(0)
  })

  it('A2 장식 — 열림 둘(하나 활성)·해결·고아·후보 → mark 셋, 위젯·치환 없음', () => {
    const h = setup(T)
    h.addThread('open1', 0, 5)
    h.addThread('open2', 16, 20)
    h.addThread('done', 6, 11, true)
    h.addThread('orphan', 21, 24)
    h.edit({ from: 21, to: 24 })
    h.sync.start()
    expect(h.range('orphan')).toBeNull()
    h.sync.setActive('open2')
    h.select(12, 15)
    expect(h.sync.beginDraft()).toEqual({ from: 12, to: 15 })

    const marks = marksOf(h)
    expect(marks).toHaveLength(3)
    expect(marks.every((m) => !m.point)).toBe(true)
    const anchors = marks.filter((m) => m.cls.split(' ').includes('cm-comment-anchor'))
    expect(anchors.map((m) => m.id).sort()).toEqual(['open1', 'open2'])
    expect(anchors.filter((m) => m.cls.split(' ').includes('cm-comment-anchor-active')).map((m) => m.id)).toEqual(['open2'])
    const drafts = marks.filter((m) => m.cls === 'cm-comment-anchor-draft')
    expect(drafts).toEqual([{ cls: 'cm-comment-anchor-draft', id: undefined, from: 12, to: 15, point: false }])
  })

  it('A2b 거터 세기 — 한 줄 열림 둘·해결 하나 / 여러 줄 블록 / 점 블록', () => {
    const h = setup(T)
    h.addThread('a', 0, 5)
    h.addThread('b', 6, 11)
    h.addThread('c', 12, 15, true)
    h.addThread('d', 21, 24)
    h.sync.start()
    const line1 = h.state.doc.line(1)
    expect(commentGutterCount(h.field(), line1.from, line1.to, false)).toBe(2)
    const line2 = h.state.doc.line(2)
    const line3 = h.state.doc.line(3)
    expect(commentGutterCount(h.field(), line2.from, line3.to, true)).toBe(1)
    expect(commentGutterCount(h.field(), 0, 0, true)).toBe(0)
  })

  it('A2c 거터 누르기 — sortThreadsByPosition 순서 첫 것', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123456789\nnext line\n'
    const h = setup(text)
    h.addThread('late', 12, 30)
    h.addThread('short', 5, 9)
    h.addThread('long', 5, 20)
    h.sync.start()
    const line = h.state.doc.line(1)
    expect(commentGutterPick(h.field(), line.from, line.to)).toBe('short')
  })
})

describe('F-504 9.2 다시 풀기·IME — createCommentSync', () => {
  it('A3 범위 지움 → 고아 → 되돌리기 → 299ms 고아 → 300ms 제자리', () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit({ from: 6, to: 11 })
    expect(h.range('a')).toBeNull()
    expect([...h.field().pending]).toEqual(['a'])
    h.um.undo()
    expect(h.state.doc.toString()).toBe(T)
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS - 1)
    expect(h.range('a')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(h.range('a')).toEqual({ from: 6, to: 11 })
    expect(h.field().pending.size).toBe(0)
  })

  it('④ 300ms 뒤 고아 확정 → 늦은 되돌리기 → 299ms 고아 → 300ms 제자리', () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit({ from: 6, to: 11 })
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
    expect(h.range('a')).toBeNull()
    expect(h.field().pending.size).toBe(0)
    vi.advanceTimersByTime(5000)
    h.um.undo()
    expect(h.state.doc.toString()).toBe(T)
    expect(h.field().pending.has('a')).toBe(true)
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS - 1)
    expect(h.range('a')).toBeNull()
    vi.advanceTimersByTime(1)
    expect(h.range('a')).toEqual({ from: 6, to: 11 })
  })

  it('④ 글자를 넣지 않는 편집은 고아를 다시 풀지 않는다', () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit({ from: 6, to: 11 })
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
    resolveSpy.mockClear()
    h.edit({ from: 0, to: 1 })
    expect(h.field().pending.size).toBe(0)
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
    expect(resolveSpy).not.toHaveBeenCalled()
  })

  it('④ 조합 중 늦은 되돌리기 → 300ms 에 안 보냄 → forceRecalc 에서 / 2초 점검에서 푼다', async () => {
    for (const via of ['forced', 'hold'] as const) {
      const h = setup(T)
      h.addThread('a', 6, 11)
      h.sync.start()
      h.edit({ from: 6, to: 11 })
      vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
      h.flags.composing = true
      h.um.undo()
      h.resetDispatches()
      vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
      expect(h.dispatches).toBe(0)
      expect(h.range('a')).toBeNull()
      if (via === 'forced') {
        h.flags.composing = false
        h.forced()
        await microtasks()
      } else {
        h.flags.alive = false
        vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS)
      }
      expect(h.range('a')).toEqual({ from: 6, to: 11 })
    }
  })

  it('A4 경계 삭제 둘이 200ms 간격 → 마지막 뒤 300ms 에 한 번만 푼다', () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.addThread('b', 21, 24)
    h.sync.start()
    resolveSpy.mockClear()
    h.edit({ from: 6, to: 7, insert: 'W' })
    vi.advanceTimersByTime(200)
    h.edit({ from: 21, to: 22, insert: 'T' })
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS - 1)
    expect(resolveSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(resolveSpy).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5000)
    expect(resolveSpy).toHaveBeenCalledTimes(2)
  })

  it('A5 조합 중 300ms → 보내지 않음, forceRecalc 업데이트 → 곧바로 풀어 보냄', async () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit({ from: 6, to: 11 })
    h.um.undo()
    h.flags.composing = true
    h.resetDispatches()
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
    expect(h.dispatches).toBe(0)
    expect(h.range('a')).toBeNull()
    h.flags.composing = false
    h.forced()
    await microtasks()
    expect(h.range('a')).toEqual({ from: 6, to: 11 })
  })

  it('A6 조합 중 300ms 뒤 isAlive 거짓 → 2,000ms 점검에서 푼다', () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit({ from: 6, to: 11 })
    h.um.undo()
    h.flags.composing = true
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
    expect(h.range('a')).toBeNull()
    h.flags.alive = false
    vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS)
    expect(h.range('a')).toEqual({ from: 6, to: 11 })
  })

  type Case = {
    name: string
    text?: string
    range?: [number, number]
    boundary: boolean
    run: (h: ReturnType<typeof setup>) => void
  }
  const TT = '| 가 | 나 |\n| --- | --- |\n| abc | def |\n'
  const cellFrom = TT.indexOf('abc')
  const cellTo = cellFrom + 3
  const defFrom = TT.indexOf('def')
  const cases: Case[] = [
    { name: '가운데 입력', boundary: false, run: (h) => h.edit({ from: 8, insert: 'X' }) },
    { name: '시작 앞 입력', boundary: false, run: (h) => h.edit({ from: 6, insert: 'X' }) },
    { name: '끝 뒤 입력', boundary: false, run: (h) => h.edit({ from: 11, insert: 'X' }) },
    { name: '범위 전체를 한 글자로', boundary: true, run: (h) => h.edit({ from: 6, to: 11, insert: 'W' }) },
    { name: '첫 글자 바꿈', boundary: true, run: (h) => h.edit({ from: 6, to: 7, insert: 'W' }) },
    { name: '마지막 글자 바꿈', boundary: true, run: (h) => h.edit({ from: 10, to: 11, insert: 'D' }) },
    { name: '시작 경계 덮어 바꿈', boundary: true, run: (h) => h.edit({ from: 4, to: 8, insert: 'ab' }) },
    { name: '끝 경계 덮어 바꿈', boundary: true, run: (h) => h.edit({ from: 9, to: 13, insert: 'ab' }) },
    { name: '굵게로 감쌈', boundary: false, run: (h) => h.edit([{ from: 6, insert: '**' }, { from: 11, insert: '**' }]) },
    { name: '범위 지움', boundary: true, run: (h) => h.edit({ from: 6, to: 11 }) },
    {
      name: '지움→되돌리기',
      boundary: true,
      run: (h) => {
        h.edit({ from: 6, to: 11 })
        h.um.undo()
      },
    },
    { name: '전체를 같은 글로', boundary: true, run: (h) => h.edit({ from: 0, to: T.length, insert: T }) },
    { name: '앵커 줄 moveLineDown', boundary: false, run: (h) => h.cmd(moveLineDown, 1) },
    { name: '아래 줄 moveLineUp', boundary: true, run: (h) => h.cmd(moveLineUp, 18) },
    { name: '앵커 줄 copyLineDown', boundary: false, run: (h) => h.cmd(copyLineDown, 1) },
    { name: '앵커 줄 indentMore', boundary: false, run: (h) => h.cmd(indentMore, 1) },
    { name: '앵커 줄 통째 지움', boundary: true, run: (h) => h.edit({ from: 0, to: 16 }) },
    {
      name: '원격 시작 앞·끝 뒤 입력 + 로컬 가운데 입력',
      boundary: false,
      run: (h) => {
        const r = h.remoteDoc()
        const rt = r.getText('content')
        rt.insert(6, 'R')
        rt.insert(12, 'S')
        h.edit({ from: 8, insert: 'L' })
        Y.applyUpdate(h.doc, Y.encodeStateAsUpdate(r))
      },
    },
    {
      name: '원격이 범위를 지우고 새로 씀',
      boundary: true,
      run: (h) => {
        const r = h.remoteDoc()
        const rt = r.getText('content')
        rt.delete(6, 5)
        rt.insert(6, 'WORLD')
        Y.applyUpdate(h.doc, Y.encodeStateAsUpdate(r))
      },
    },
    {
      name: '원격이 범위를 포함해 지우는 동안 로컬 가운데 입력',
      boundary: true,
      run: (h) => {
        const r = h.remoteDoc()
        r.getText('content').delete(0, 20)
        h.edit({ from: 8, insert: 'L' })
        Y.applyUpdate(h.doc, Y.encodeStateAsUpdate(r))
      },
    },
    {
      name: '표 칸 전체 바꿈 — 칸 안 앵커',
      text: TT,
      range: [cellFrom + 1, cellFrom + 2],
      boundary: true,
      run: (h) => h.edit({ from: cellFrom, to: cellTo, insert: 'abcd' }),
    },
    {
      name: '표 칸 전체 바꿈 — 칸에서 다음 칸까지',
      text: TT,
      range: [cellFrom, defFrom + 3],
      boundary: true,
      run: (h) => h.edit({ from: cellFrom, to: cellTo, insert: 'abcd' }),
    },
    {
      name: '표 칸 전체 바꿈 — 다른 칸',
      text: TT,
      range: [defFrom, defFrom + 3],
      boundary: false,
      run: (h) => h.edit({ from: cellFrom, to: cellTo, insert: 'abcd' }),
    },
  ]

  it('A7 목록이 23가지, 경계 14 / 아님 9', () => {
    expect(cases).toHaveLength(23)
    expect(cases.filter((c) => c.boundary)).toHaveLength(14)
  })

  it.each(cases.map((c) => [c.name, c] as const))('A7 %s → 300ms 뒤 필드 = resolveCommentAnchor', (_name, c) => {
    const h = setup(c.text ?? T)
    const [from, to] = c.range ?? [6, 11]
    const anchor = h.addThread('a', from, to)
    h.sync.start()
    c.run(h)
    expect(h.field().pending.has('a')).toBe(c.boundary)
    vi.advanceTimersByTime(COMMENT_RERESOLVE_MS)
    expect(h.range('a')).toEqual(resolveCommentAnchor(h.ytext, anchor))
    expect(h.state.doc.toString()).toBe(h.ytext.toString())
  })

  it.each(['본문 먼저', '댓글 먼저'])('A8 한 Yjs 트랜잭션에 본문 삽입 + 새 첫 댓글(%s) → afterTransaction 한 번, 같은 글자', (order) => {
    const h = setup(T)
    h.addThread('old', 6, 11)
    h.sync.start()
    const mapChanged = vi.spyOn(h.sync, 'mapChanged')

    const r = h.remoteDoc()
    const rt = r.getText('content')
    const rm = r.getMap<unknown>(Y_COMMENTS_NAME)
    r.transact(() => {
      if (order === '본문 먼저') {
        rt.insert(0, 'AAA\n')
        rm.set('fresh', rootEntry(createCommentAnchor(rt, 4 + 12, 4 + 15), 'foo'))
      } else {
        rm.set('fresh', rootEntry(createCommentAnchor(rt, 12, 15), 'foo'))
        rt.insert(0, 'AAA\n')
      }
    })
    Y.applyUpdate(h.doc, Y.encodeStateAsUpdate(r, Y.encodeStateVector(h.doc)))

    expect(mapChanged).toHaveBeenCalledTimes(1)
    const fresh = h.range('fresh')!
    expect(h.state.doc.sliceString(fresh.from, fresh.to)).toBe('foo')
    expect(h.range('old')).toEqual({ from: 10, to: 15 })
  })

  it('A9 스레드 500개 중 하나의 resolved 만 바꿈 → 풀기 1번, 장식에서 빠짐', () => {
    const text = 'abcdefghij'.repeat(120)
    const h = setup(text)
    h.doc.transact(() => {
      for (let i = 0; i < 500; i++) h.addThread(`t${i}`, i * 2, i * 2 + 1)
    })
    h.sync.start()
    expect(marksOf(h)).toHaveLength(500)
    resolveSpy.mockClear()
    const entry = h.map.get('t7') as ReturnType<typeof rootEntry>
    h.map.set('t7', { ...entry, resolved: { by: NOBODY, at: 9 } })
    expect(resolveSpy).toHaveBeenCalledTimes(1)
    const marks = marksOf(h)
    expect(marks).toHaveLength(499)
    expect(marks.some((m) => m.id === 't7')).toBe(false)
  })

  it('A10 조합 중 로컬 comments 쓰기 → 효과 없음 → forceRecalc 뒤 새 스레드', async () => {
    const h = setup(T)
    h.sync.start()
    h.flags.composing = true
    h.resetDispatches()
    h.addThread('a', 6, 11)
    expect(h.dispatches).toBe(0)
    expect(h.field().threads).toHaveLength(0)
    h.flags.composing = false
    h.forced()
    await microtasks()
    expect(h.range('a')).toEqual({ from: 6, to: 11 })
  })

  it('A11 start — 첫 댓글 3(하나 고아)·답글 2·invalid 1·strays 1', () => {
    const h = setup(T)
    h.addThread('r1', 0, 5)
    h.addThread('r2', 6, 11)
    h.addThread('r3', 16, 20)
    h.edit({ from: 16, to: 20 })
    h.map.set('p1', replyEntry('r1'))
    h.map.set('p2', replyEntry('r2'))
    h.map.set('bad', { v: 2 })
    h.map.set('stray', replyEntry('nobody'))
    h.sync.start()
    const field = h.field()
    expect(field.threads.map((t) => t.id).sort()).toEqual(['r1', 'r2', 'r3'])
    expect(h.range('r3')).toBeNull()
    expect([...field.ranges.keys()].sort()).toEqual(['r1', 'r2', 'r3'])
    const ranges = h.sync.ranges()
    expect(ranges.size).toBe(3)
    expect(ranges.get('r3')).toBeNull()
  })

  it('A12 ranges() 가 기다리는 스레드를 풀어 준다 — 효과를 보내지 않는다', () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    h.sync.start()
    h.edit({ from: 6, to: 11 })
    h.um.undo()
    h.resetDispatches()
    expect(h.sync.ranges().get('a')).toEqual({ from: 6, to: 11 })
    expect(h.range('a')).toBeNull()
    expect(h.dispatches).toBe(0)
  })
})

describe('F-504 9.3 후보·불변조건', () => {
  it('A13 붙이기 → 후보 → 활성 → 다시 풀기 → 떼기, 내용·Y.Doc 그대로', async () => {
    const h = setup(T)
    h.addThread('a', 6, 11)
    const before = h.state.doc.toString()
    let updates = 0
    h.doc.on('update', () => updates++)
    h.sync.start()
    h.select(12, 15)
    h.sync.beginDraft()
    h.sync.setActive('a')
    h.forced()
    await microtasks()
    h.sync.ranges()
    h.sync.clearDraft()
    h.sync.dispose()
    expect(h.state.doc.toString()).toBe(before)
    expect(h.ytext.toString()).toBe(before)
    expect(updates).toBe(0)
    expect(h.field().threads).toHaveLength(0)
    expect(marksOf(h)).toHaveLength(0)
  })

  it('A14 beginDraft — 빈 선택 / 조합 중 / 떼어진 상태 → null', () => {
    const h = setup(T)
    h.sync.start()
    h.select(3, 3)
    expect(h.sync.beginDraft()).toBeNull()
    h.select(6, 11)
    h.flags.composing = true
    expect(h.sync.beginDraft()).toBeNull()
    h.flags.composing = false
    h.sync.dispose()
    expect(h.sync.beginDraft()).toBeNull()
  })

  it('A15 후보 {6,11} → 앞에 한 글자·가운데 한 글자 → takeDraft {7,13}', () => {
    const h = setup(T)
    h.sync.start()
    h.select(6, 11)
    expect(h.sync.beginDraft()).toEqual({ from: 6, to: 11 })
    h.edit({ from: 6, insert: 'X' })
    h.edit({ from: 9, insert: 'Y' })
    const draft = h.sync.takeDraft()
    expect(draft).not.toBeNull()
    expect(draft!.range).toEqual({ from: 7, to: 13 })
    expect(resolveCommentAnchor(h.ytext, draft!.anchor)).toEqual({ from: 7, to: 13 })
    expect(draft!.quote).toBe(commentQuote(h.state.doc.sliceString(7, 13)))
    expect(marksOf(h).filter((m) => m.cls === 'cm-comment-anchor-draft')).toHaveLength(0)
  })

  it('A16 후보 범위를 통째로 지움 → takeDraft null', () => {
    const h = setup(T)
    h.sync.start()
    h.select(6, 11)
    h.sync.beginDraft()
    h.edit({ from: 6, to: 11 })
    expect(h.sync.takeDraft()).toBeNull()
  })

  it('A17 300자 후보 → quote 200자, 끝 …', () => {
    const text = 'x'.repeat(400)
    const h = setup(text)
    h.sync.start()
    h.select(10, 310)
    h.sync.beginDraft()
    const draft = h.sync.takeDraft()!
    expect(draft.quote).toHaveLength(200)
    expect(draft.quote.endsWith('…')).toBe(true)
  })
})
