// 창 안 원본 모음 — 같은 문서 두 칸의 원본 만들기·버리기, 원본에서 저장 (specs/features/F-2161.md 3장·5장 U4~U8)
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { EditorState } from '@codemirror/state'
import { YSyncConfig } from 'y-codemirror.next'

import { createPaneSources, sourceText } from '../../../src/editor/paneSource'
import type { SourcePane } from '../../../src/editor/paneSource'
import { createRemoteGate } from '../../../src/editor/remoteGate'
import type { RemoteGate } from '../../../src/editor/remoteGate'
import { createYBinding, createYBindingFromState } from '../../../src/editor/yBinding'
import type { YBinding } from '../../../src/editor/yBinding'
import { Y_COMMENTS_NAME } from '../../../src/lib/live/docRoomProtocol'

const DOC = 'doc-1'

type TestPane = SourcePane & {
  binding: YBinding
  flags: { composing: boolean }
  follows: Y.Doc[]
  gate(): RemoteGate | null
  type(pos: number, text: string): void
  text(): string
}

const cleanup: (() => void)[] = []

afterEach(() => {
  for (const run of cleanup.splice(0)) run()
})

// createEditor 의 followSource 처럼 게이트가 없을 때만 원본에 게이트를 단다 (4장)
function makePane(binding: YBinding): TestPane {
  const conf = new YSyncConfig(binding.ytext, null)
  binding.undoManager.addTrackedOrigin(conf)
  const flags = { composing: false }
  const follows: Y.Doc[] = []
  let gate: RemoteGate | null = null
  cleanup.push(() => {
    gate?.destroy()
    binding.destroy()
  })
  return {
    binding,
    flags,
    follows,
    editorDoc: binding.ydoc,
    followSource(source) {
      follows.push(source)
      gate ??= createRemoteGate(binding.ydoc, { docId: DOC, sharedDoc: source, isComposing: () => flags.composing })
    },
    gate: () => gate,
    type(pos, text) {
      binding.undoManager.stopCapturing()
      binding.ydoc.transact(() => binding.ytext.insert(pos, text), conf)
    },
    text: () => binding.ytext.toString(),
  }
}

// paneSource 옵션으로 만든 칸 — 원본 상태를 복제하고 곧바로 게이트를 단다 (4장)
function paneFrom(source: Y.Doc): TestPane {
  const pane = makePane(createYBindingFromState(Y.encodeStateAsUpdate(source)))
  pane.followSource(source)
  return pane
}

// 첫 칸(본문 hello, 편집 1) → 원본 → 둘째 칸 (3장 실측 순서)
function splitSetup() {
  const sources = createPaneSources()
  const a = makePane(createYBinding('hello'))
  a.binding.ydoc.getMap(Y_COMMENTS_NAME).set('c1', { body: '메모' })
  a.type(5, '1')
  sources.add(DOC, a)
  const source = sources.prepare(DOC)!
  const b = paneFrom(source)
  sources.add(DOC, b)
  return { sources, source, a, b }
}

describe('F-2161 U4 prepare', () => {
  it('칸 0 이면 null, 칸 1 이면 첫 칸 상태로 원본을 만들고 첫 칸이 원본을 1번 따른다', () => {
    const sources = createPaneSources()
    expect(sources.prepare(DOC)).toBeNull()
    expect(sources.source(DOC)).toBeNull()

    const a = makePane(createYBinding('hello'))
    a.binding.ydoc.getMap(Y_COMMENTS_NAME).set('c1', { body: '메모' })
    a.type(5, '1')
    sources.add(DOC, a)
    const source = sources.prepare(DOC)
    expect(source).not.toBeNull()
    expect(source!.getText('content').toString()).toBe('hello1')
    expect(source!.getMap(Y_COMMENTS_NAME).toJSON()).toEqual({ c1: { body: '메모' } })
    expect(a.follows).toEqual([source])
    expect(sources.source(DOC)).toBe(source)

    expect(sources.prepare(DOC)).toBe(source)
    expect(a.follows).toHaveLength(1)
    expect(sources.prepare('doc-2')).toBeNull()
  })
})

describe('F-2161 U5 두 칸이 원본으로 맞춰진다', () => {
  it('서로 친 글이 양쪽 칸과 원본에 같게 들어간다', () => {
    const { source, a, b } = splitSetup()
    expect(b.text()).toBe('hello1')
    expect(b.binding.ydoc.getMap(Y_COMMENTS_NAME).size).toBe(1)
    b.type(0, 'B')
    expect(a.text()).toBe('Bhello1')
    a.type(7, 'A')
    expect(b.text()).toBe('Bhello1A')
    expect(source.getText('content').toString()).toBe('Bhello1A')
  })
})

describe('F-2161 U6 실행 취소는 칸마다 자기 편집만', () => {
  it('첫 칸 실행 취소 두 번이 원본 생기기 전 편집까지 되돌리고 둘째 칸 편집은 남긴다', () => {
    const { source, a, b } = splitSetup()
    b.type(0, 'B')
    a.type(7, '2')
    a.flags.composing = true
    b.type(0, 'X')
    expect(a.text()).toBe('Bhello12')
    a.flags.composing = false
    a.gate()!.flushIfIdle()
    expect(a.text()).toBe('XBhello12')
    a.binding.undoManager.undo()
    a.binding.undoManager.undo()
    expect(a.text()).toBe('XBhello')
    expect(b.text()).toBe('XBhello')
    expect(source.getText('content').toString()).toBe('XBhello')
  })
})

describe('F-2161 U7 원본 버리기', () => {
  it('칸을 모두 빼면 원본을 destroy 하고 source 가 null', () => {
    const { sources, source, a, b } = splitSetup()
    sources.remove(DOC, a)
    expect(source.isDestroyed).toBe(false)
    expect(sources.source(DOC)).toBe(source)
    sources.remove(DOC, b)
    expect(source.isDestroyed).toBe(true)
    expect(sources.source(DOC)).toBeNull()
    expect(sources.prepare(DOC)).toBeNull()
  })

  it('새 칸 add 뒤 옛 칸 remove 면 마지막 칸이어도 원본이 남는다', () => {
    const { sources, source, a, b } = splitSetup()
    sources.remove(DOC, a)
    expect(sources.prepare(DOC)).toBe(source)
    const c = paneFrom(source)
    sources.add(DOC, c)
    sources.remove(DOC, b)
    expect(source.isDestroyed).toBe(false)
    c.type(0, 'C')
    expect(source.getText('content').toString()).toBe('Chello1')
  })

  it('같은 칸 두 번 add·없는 칸 remove 는 아무 일 없다', () => {
    const sources = createPaneSources()
    const a = makePane(createYBinding('hello'))
    sources.add(DOC, a)
    sources.add(DOC, a)
    sources.remove(DOC, makePane(createYBinding('x')))
    sources.remove('doc-2', a)
    const source = sources.prepare(DOC)!
    sources.remove(DOC, a)
    expect(source.isDestroyed).toBe(true)
    expect(sources.source(DOC)).toBeNull()
  })
})

describe('F-2161 U8 sourceText', () => {
  it.each([
    ['crlf', 'a\r\nb\r\n\r\nc'],
    ['lf', 'a\nb\n\nc\n'],
  ] as const)('%s — 같은 본문 handle getText 와 같은 바이트', (lineEnding, body) => {
    const sources = createPaneSources()
    const a = makePane(createYBinding(body))
    sources.add(DOC, a)
    const source = sources.prepare(DOC)!
    const sep = lineEnding === 'crlf' ? '\r\n' : '\n'
    const doc = EditorState.create({ doc: a.text() }).doc
    expect(sourceText(source, lineEnding)).toBe(doc.sliceString(0, doc.length, sep))
    expect(sourceText(source, lineEnding)).toBe(body)
  })
})
