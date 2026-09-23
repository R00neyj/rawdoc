// 공유 Y.Doc 중계 + IME 게이트 (specs/features/F-303.md 13.1 A1~A12)
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { ChangeSpec } from '@codemirror/state'
import { YSyncConfig } from 'y-codemirror.next'

import { createYBinding, undoLocal } from './yBinding'
import type { YBinding } from './yBinding'
import { REMOTE_HOLD_CHECK_MS, connectRemote, createRemoteGate } from './remoteGate'
import type { RemoteGate } from './remoteGate'

type Peer = {
  binding: YBinding
  gate: RemoteGate
  conf: YSyncConfig
  screen: { state: EditorState }
  outbox: Uint8Array[]
  flags: { composing: boolean; alive: boolean }
  log: string[]
}

const peers: Peer[] = []

afterEach(() => {
  for (const peer of peers.splice(0)) {
    peer.gate.destroy()
    peer.binding.destroy()
  }
  vi.useRealTimers()
})

// ySync observer 와 같은 규칙으로 원격(내 origin 이 아닌) Y.Text 변경을 EditorState 로 옮긴다 (F-302 A3b)
function attachScreen(binding: YBinding, conf: YSyncConfig) {
  const screen = { state: EditorState.create({ doc: binding.ytext.toString() }) }
  binding.ytext.observe((event, tr) => {
    if (tr.origin === conf) return
    const changes: ChangeSpec[] = []
    let pos = 0
    for (const d of event.delta) {
      if (d.insert != null) changes.push({ from: pos, to: pos, insert: d.insert as string })
      else if (d.delete != null) {
        changes.push({ from: pos, to: pos + d.delete, insert: '' })
        pos += d.delete
      } else pos += d.retain ?? 0
    }
    screen.state = screen.state.update({ changes }).state
  })
  return screen
}

function makePeer(text: string, options: { nogate?: boolean } = {}): Peer {
  const binding = createYBinding(text)
  const conf = new YSyncConfig(binding.ytext, null)
  binding.undoManager.addTrackedOrigin(conf)
  const screen = attachScreen(binding, conf)
  const flags = { composing: false, alive: true }
  const log: string[] = []
  const gate = createRemoteGate(binding.ydoc, {
    docId: 'doc-1',
    isComposing: () => flags.composing,
    isAlive: () => flags.alive,
    afterFlush: () => log.push('afterFlush'),
    nogate: options.nogate,
  })
  const outbox: Uint8Array[] = []
  gate.port.onLocalUpdate((update) => outbox.push(update))
  const peer = { binding, gate, conf, screen, outbox, flags, log }
  peers.push(peer)
  return peer
}

// 화면(EditorState)에 먼저 넣고 ySync 처럼 같은 변경을 로컬 origin 으로 Y.Text 에 쓴다
function typeAt(peer: Peer, pos: number, text: string) {
  const tr = peer.screen.state.update({
    changes: { from: pos, insert: text },
    selection: EditorSelection.cursor(pos + text.length),
  })
  peer.screen.state = tr.state
  peer.binding.ydoc.transact(() => peer.binding.ytext.insert(pos, text), peer.conf)
}

function cursor(peer: Peer) {
  return peer.screen.state.selection.main.head
}

function setCursor(peer: Peer, pos: number) {
  peer.screen.state = peer.screen.state.update({ selection: EditorSelection.cursor(pos) }).state
}

function relay(from: Peer, to: Peer) {
  for (const update of from.outbox.splice(0)) to.gate.port.applyRemote(update)
}

// 같은 본문을 심은 두 쪽 — B 가 A 상태를 입양하고 자기 전체 상태를 A 에 보낸다 (8.3)
function joined(text: string) {
  const a = makePeer(text)
  const b = makePeer(text)
  expect(b.gate.port.adopt(a.gate.port.encodeState())).toBe(true)
  a.gate.port.applyRemote(b.gate.port.encodeState())
  a.outbox.length = 0
  b.outbox.length = 0
  return { a, b }
}

function screenText(peer: Peer) {
  return peer.screen.state.doc.toString()
}

function editorText(peer: Peer) {
  return peer.binding.ytext.toString()
}

describe('F-303 A1 조합 아님 — 로컬은 곧바로 공유로, 원격은 곧바로 편집기로', () => {
  it('로컬 입력이 같은 호출 안에서 공유 Doc 과 onLocalUpdate 에 닿고, 원격은 곧바로 편집기에 들어간다', () => {
    const { a, b } = joined('본문')
    typeAt(a, 2, 'x')
    expect(a.gate.port.sharedText()).toBe('본문x')
    expect(a.outbox).toHaveLength(1)

    typeAt(b, 0, 'R')
    const heard: Uint8Array[] = []
    a.gate.port.onLocalUpdate((u) => heard.push(u))
    a.outbox.length = 0
    relay(b, a)
    expect(editorText(a)).toBe('R본문x')
    expect(screenText(a)).toBe('R본문x')
    expect(a.gate.port.holding()).toBe(false)
    expect(a.outbox).toHaveLength(0)
    expect(heard).toHaveLength(0)
  })
})

describe('F-303 A2 조합 중 원격은 보류', () => {
  it('원격 두 건 뒤 편집기·화면은 그대로, sharedText 에는 둘 다, holding true', () => {
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    typeAt(b, 4, 'Y')
    relay(b, a)
    expect(editorText(a)).toBe('가나다')
    expect(screenText(a)).toBe('가나다')
    expect(a.gate.port.sharedText()).toBe('X가나다Y')
    expect(a.gate.port.holding()).toBe(true)
  })
})

describe('F-303 A3 보류 중 로컬 입력은 막히지 않는다', () => {
  it('공유 Doc·onLocalUpdate 에 곧바로 닿는다', () => {
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    expect(a.gate.port.holding()).toBe(true)
    typeAt(a, 3, '라')
    expect(a.outbox).toHaveLength(1)
    expect(a.gate.port.sharedText()).toBe('X가나다라')
    expect(editorText(a)).toBe('가나다라')
  })
})

describe('F-303 A4 compositionend 경로의 비우기', () => {
  it('편집기 Y.Text observe 가 정확히 1번, 그 뒤 afterFlush', () => {
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    typeAt(b, 1, 'Y')
    relay(b, a)
    typeAt(b, 5, 'Z')
    relay(b, a)
    a.binding.ytext.observe(() => a.log.push('observe'))
    a.flags.composing = false
    a.gate.flushIfIdle()
    expect(a.log).toEqual(['observe', 'afterFlush'])
    expect(a.gate.port.holding()).toBe(false)
    expect(screenText(a)).toBe('XY가나다Z')
  })
})

describe('F-303 A5 여전히 조합 중이면 compositionend 경로가 아무것도 안 한다', () => {
  it('holding 그대로, 편집기 그대로, afterFlush 안 불림', () => {
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    a.gate.flushIfIdle()
    expect(a.gate.port.holding()).toBe(true)
    expect(editorText(a)).toBe('가나다')
    expect(a.log).toEqual([])
  })
})

describe('F-303 A6 점검 타이머', () => {
  it('조합 중·살아 있지 않음 → REMOTE_HOLD_CHECK_MS 뒤 비우기 + 콜백', () => {
    vi.useFakeTimers()
    const { a, b } = joined('가나다')
    a.flags.composing = true
    a.flags.alive = false
    typeAt(b, 0, 'X')
    relay(b, a)
    vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS - 1)
    expect(a.gate.port.holding()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(a.gate.port.holding()).toBe(false)
    expect(editorText(a)).toBe('X가나다')
    expect(a.log).toEqual(['afterFlush'])
  })

  it('조합 중·살아 있음 → 60,000ms 가 지나도 보류 그대로', () => {
    vi.useFakeTimers()
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    vi.advanceTimersByTime(60_000)
    expect(a.gate.port.holding()).toBe(true)
    expect(editorText(a)).toBe('가나다')
    expect(a.log).toEqual([])
  })

  it('조합이 끝났는데 비우기를 놓쳤으면 타이머에서 비운다', () => {
    vi.useFakeTimers()
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    a.flags.composing = false
    vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS)
    expect(a.gate.port.holding()).toBe(false)
    expect(editorText(a)).toBe('X가나다')
  })
})

describe('F-303 A7 강제 비우기', () => {
  it('조합 판정이 true 여도 비우고 콜백을 부른다', () => {
    const { a, b } = joined('가나다')
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    a.gate.forceFlush()
    expect(a.gate.port.holding()).toBe(false)
    expect(editorText(a)).toBe('X가나다')
    expect(a.log).toEqual(['afterFlush'])
  })
})

describe('F-303 A8 두 탭 수렴·커서 (실측 M1)', () => {
  it('조합 중 커서 앞·뒤 원격 뒤 두 글자를 치고 비우면 네 곳이 같고 글자·커서가 제자리', () => {
    const base = '첫 문단입니다. 여기에 이어 칩니다.'
    const { a, b } = joined(base)
    const at = base.indexOf('이어')
    setCursor(a, at)
    a.flags.composing = true

    typeAt(b, base.length, ' [뒤]')
    typeAt(b, 0, '[앞] ')
    relay(b, a)
    expect(screenText(a)).toBe(base)

    typeAt(a, at, '한')
    typeAt(a, at + 1, '글')
    a.flags.composing = false
    a.gate.flushIfIdle()
    relay(a, b)

    const expected = '[앞] 첫 문단입니다. 여기에 한글이어 칩니다. [뒤]'
    expect(screenText(a)).toBe(expected)
    expect(a.gate.port.sharedText()).toBe(expected)
    expect(b.gate.port.sharedText()).toBe(expected)
    expect(screenText(b)).toBe(expected)
    expect(cursor(a)).toBe(expected.indexOf('이어'))
    expect(cursor(a)).toBe(19)
    expect(Y.encodeStateVector(a.binding.ydoc)).toEqual(Y.encodeStateVector(a.gate.sharedDoc))
  })
})

describe('F-303 A9 되돌리기는 내 편집만 (실측 M2·M2b)', () => {
  function undo(peer: Peer) {
    const state = EditorState.create({ doc: editorText(peer), extensions: [peer.binding.extension] })
    return undoLocal({ state, dispatch: () => {} })
  }

  it('원격이 섞인 뒤 undoLocal 은 로컬만 되돌리고 원격은 남는다', () => {
    const { a, b } = joined('abc')
    typeAt(a, 3, 'X')
    typeAt(a, 4, 'Y')
    relay(a, b)
    typeAt(b, 0, 'R')
    relay(b, a)
    typeAt(a, 6, 'Z')
    expect(editorText(a)).toBe('RabcXYZ')
    expect(undo(a)).toBe(true)
    relay(a, b)
    expect(editorText(a)).toBe('Rabc')
    expect(screenText(a)).toBe('Rabc')
    expect(editorText(b)).toBe('Rabc')
  })

  it('보류 중 되돌리기 — 화면은 abc, 비운 뒤 두 쪽 모두 Rabc', () => {
    const { a, b } = joined('abc')
    a.flags.composing = true
    typeAt(a, 3, 'X')
    typeAt(a, 4, 'Y')
    typeAt(b, 0, 'R')
    relay(b, a)
    expect(undo(a)).toBe(true)
    expect(screenText(a)).toBe('abc')
    a.flags.composing = false
    a.gate.flushIfIdle()
    relay(a, b)
    expect(screenText(a)).toBe('Rabc')
    expect(a.gate.port.sharedText()).toBe('Rabc')
    expect(b.gate.port.sharedText()).toBe('Rabc')
    expect(screenText(b)).toBe('Rabc')
  })
})

describe('F-303 A10 입양 (실측 M5)', () => {
  it('같은 씨앗 두 쌍 — 입양 true, 본문 한 벌, 그 뒤 편집이 대기 없이 도착', () => {
    const text = '# 제목\n\n본문 한 줄'
    const a = makePeer(text)
    const b = makePeer(text)
    expect(b.gate.port.adopt(a.gate.port.encodeState())).toBe(true)
    expect(b.gate.port.sharedText()).toBe(text)
    expect(screenText(b)).toBe(text)

    a.gate.port.applyRemote(b.gate.port.encodeState())
    expect(a.gate.port.sharedText()).toBe(text)
    expect(screenText(a)).toBe(text)

    typeAt(b, text.length, '\nA1')
    relay(b, a)
    expect(a.gate.port.sharedText()).toBe(`${text}\nA1`)
    expect(a.gate.sharedDoc.store.pendingStructs).toBeNull()
    expect(screenText(a)).toBe(`${text}\nA1`)
  })

  it('대조군 — 입양 없이 합치면 본문이 두 벌', () => {
    const text = '본문'
    const a = makePeer(text)
    const b = makePeer(text)
    a.gate.port.applyRemote(b.gate.port.encodeState())
    expect(a.gate.port.sharedText().length).toBe(text.length * 2)
  })

  it('로컬 편집 뒤 adopt 는 false 이고 Y.Text 를 지우지 않는다', () => {
    const a = makePeer('본문')
    const b = makePeer('본문')
    typeAt(b, 2, 'x')
    expect(b.gate.port.adopt(a.gate.port.encodeState())).toBe(false)
    expect(b.gate.port.sharedText()).toContain('본문x')
    expect(editorText(b)).toContain('본문x')
  })
})

describe('F-303 A11 버리기', () => {
  it('destroy 뒤 두 Doc 이 버려지고, 걸려 있던 타이머가 콜백을 부르지 않고, 늦은 호출이 던지지 않는다', () => {
    vi.useFakeTimers()
    const { a, b } = joined('가나다')
    a.flags.composing = true
    a.flags.alive = false
    typeAt(b, 0, 'X')
    relay(b, a)
    expect(a.gate.port.holding()).toBe(true)

    // createEditor.destroy 와 같은 순서 — 연결 먼저, 편집기 Doc 은 binding 이 버린다 (4.4)
    a.gate.destroy()
    a.binding.destroy()
    expect(a.gate.sharedDoc.isDestroyed).toBe(true)
    expect(a.binding.ydoc.isDestroyed).toBe(true)

    vi.advanceTimersByTime(REMOTE_HOLD_CHECK_MS * 3)
    expect(a.log).toEqual([])
    typeAt(b, 0, 'Y')
    expect(() => relay(b, a)).not.toThrow()
    expect(() => a.gate.port.adopt(b.gate.port.encodeState())).not.toThrow()
    expect(() => a.gate.destroy()).not.toThrow()
  })
})

describe('F-303 A12 nogate', () => {
  it('조합 중에도 applyRemote 가 곧바로 편집기에 들어간다', () => {
    const a = makePeer('가나다', { nogate: true })
    const b = makePeer('가나다')
    expect(b.gate.port.adopt(a.gate.port.encodeState())).toBe(true)
    a.gate.port.applyRemote(b.gate.port.encodeState())
    b.outbox.length = 0
    a.flags.composing = true
    typeAt(b, 0, 'X')
    relay(b, a)
    expect(a.gate.port.holding()).toBe(false)
    expect(editorText(a)).toBe('X가나다')
    expect(screenText(a)).toBe('X가나다')
  })
})

describe('F-305 U16 바깥 공유 Doc 으로 게이트', () => {
  const PROVIDER = { provider: true }

  function setupExternal(roomText: string) {
    const room = new Y.Doc()
    room.getText('content').insert(0, roomText)
    const binding = createYBinding('')
    Y.applyUpdate(binding.ydoc, Y.encodeStateAsUpdate(room))
    const conf = new YSyncConfig(binding.ytext, null)
    binding.undoManager.addTrackedOrigin(conf)
    const flags = { composing: false }
    const log: string[] = []
    const gate = createRemoteGate(binding.ydoc, {
      docId: 'doc-1',
      sharedDoc: room,
      isComposing: () => flags.composing,
      afterFlush: () => log.push('afterFlush'),
    })
    return { room, binding, conf, flags, log, gate }
  }

  function remoteInsert(room: Y.Doc, index: number, text: string) {
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(room))
    other.getText('content').insert(index, text)
    Y.applyUpdate(room, Y.encodeStateAsUpdate(other, Y.encodeStateVector(room)), PROVIDER)
  }

  it('그 Doc 을 공유 Doc 으로 쓰고 채우지 않는다 — 두 벌이 되지 않는다', () => {
    const { room, binding, gate } = setupExternal('방 본문')
    expect(gate.sharedDoc).toBe(room)
    expect(room.getText('content').toString()).toBe('방 본문')
    expect(binding.ytext.toString()).toBe('방 본문')
    gate.destroy()
    binding.destroy()
  })

  it('편집기 쓰기가 공유 Doc 에 닿고, 공유 Doc 원격 쓰기가 편집기 Doc 에 닿는다', () => {
    const { room, binding, conf, gate } = setupExternal('abc')
    binding.ydoc.transact(() => binding.ytext.insert(3, 'd'), conf)
    expect(room.getText('content').toString()).toBe('abcd')
    remoteInsert(room, 0, 'R')
    expect(binding.ytext.toString()).toBe('Rabcd')
    gate.destroy()
    binding.destroy()
  })

  it('조합 중이면 보류했다가 flushIfIdle 에 들어온다', () => {
    const { room, binding, flags, log, gate } = setupExternal('가나')
    flags.composing = true
    remoteInsert(room, 2, '다')
    expect(binding.ytext.toString()).toBe('가나')
    expect(gate.port.holding()).toBe(true)
    gate.flushIfIdle()
    expect(binding.ytext.toString()).toBe('가나')
    flags.composing = false
    gate.flushIfIdle()
    expect(binding.ytext.toString()).toBe('가나다')
    expect(log).toEqual(['afterFlush'])
    gate.destroy()
    binding.destroy()
  })

  it('destroy 뒤 공유 Doc 은 살아 있고 처리기가 떨어져 있다', () => {
    const { room, binding, conf, gate } = setupExternal('x')
    gate.destroy()
    expect(room.isDestroyed).toBe(false)
    remoteInsert(room, 0, 'R')
    expect(binding.ytext.toString()).toBe('x')
    binding.ydoc.transact(() => binding.ytext.insert(1, 'y'), conf)
    expect(room.getText('content').toString()).toBe('Rx')
    binding.destroy()
    expect(room.isDestroyed).toBe(false)
  })
})

describe('F-305 U17 connectRemote 에 sharedDoc 을 주면 훅을 부르지 않는다', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  function fakeView() {
    const listeners: string[] = []
    return {
      listeners,
      view: {
        dom: {
          addEventListener: (type: string) => listeners.push(`+${type}`),
          removeEventListener: (type: string) => listeners.push(`-${type}`),
        },
        compositionStarted: false,
        dispatch: () => {},
      } as unknown as import('@codemirror/view').EditorView,
    }
  }

  it('프로바이더 팩토리 훅이 있어도 부르지 않고 게이트만 세운다', () => {
    const factory = vi.fn(() => ({ destroy() {} }))
    ;(globalThis as { window?: unknown }).window = { __yProviderFactory: factory }
    const room = new Y.Doc()
    room.getText('content').insert(0, '방')
    const binding = createYBinding('')
    Y.applyUpdate(binding.ydoc, Y.encodeStateAsUpdate(room))
    const { view, listeners } = fakeView()
    const connection = connectRemote({ view, editorDoc: binding.ydoc, docId: 'doc-1', sharedDoc: room })
    expect(factory).not.toHaveBeenCalled()
    expect(connection).not.toBeNull()
    binding.ydoc.getText('content').insert(1, '!')
    expect(room.getText('content').toString()).toBe('방!')
    connection!.destroy()
    expect(listeners).toEqual(['+compositionend', '+keydown', '-compositionend', '-keydown'])
    expect(room.isDestroyed).toBe(false)
    binding.destroy()
  })

  it('sharedDoc 이 없으면 지금처럼 훅을 부른다', () => {
    const factory = vi.fn(() => ({ destroy() {} }))
    ;(globalThis as { window?: unknown }).window = { __yProviderFactory: factory }
    const binding = createYBinding('a')
    const { view } = fakeView()
    const connection = connectRemote({ view, editorDoc: binding.ydoc, docId: 'doc-1' })
    expect(factory).toHaveBeenCalledTimes(1)
    connection!.destroy()
    binding.destroy()
  })
})
