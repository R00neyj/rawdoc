// 편집기 Doc 의 title Y.Text 쓰기·원격 변경 듣기 (specs/features/F-305.md 9.3, U18·U19)
import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

import { LOCAL_TITLE, observeTitle, writeTitle } from './liveTitle'

function docWithTitle(title: string) {
  const doc = new Y.Doc()
  doc.getText('title').insert(0, title)
  return doc
}

describe('F-305 U18 writeTitle', () => {
  it("'가나다' → '가X나다' 는 한 글자 삽입 한 번, origin 은 LOCAL_TITLE", () => {
    const doc = docWithTitle('가나다')
    const deltas: unknown[] = []
    const origins: unknown[] = []
    doc.getText('title').observe((event) => {
      deltas.push(event.delta)
      origins.push(event.transaction.origin)
    })
    expect(writeTitle(doc, '가X나다')).toBe(true)
    expect(doc.getText('title').toString()).toBe('가X나다')
    expect(deltas).toEqual([[{ retain: 1 }, { insert: 'X' }]])
    expect(origins).toEqual([LOCAL_TITLE])
  })

  it('지우고 넣기도 바뀐 구간만', () => {
    const doc = docWithTitle('옛 제목')
    const deltas: unknown[] = []
    doc.getText('title').observe((event) => deltas.push(event.delta))
    expect(writeTitle(doc, '새 제목')).toBe(true)
    expect(doc.getText('title').toString()).toBe('새 제목')
    expect(deltas).toEqual([[{ delete: 1 }, { insert: '새' }]])
  })

  it('같은 값이면 false, 업데이트 없음', () => {
    const doc = docWithTitle('그대로')
    const onUpdate = vi.fn()
    doc.on('update', onUpdate)
    expect(writeTitle(doc, '그대로')).toBe(false)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('빈 제목에서 쓰기·전부 지우기', () => {
    const doc = new Y.Doc()
    expect(writeTitle(doc, '처음')).toBe(true)
    expect(doc.getText('title').toString()).toBe('처음')
    expect(writeTitle(doc, '')).toBe(true)
    expect(doc.getText('title').toString()).toBe('')
  })

  it('동시에 친 상대 글자 중 겹치지 않은 것은 남는다', () => {
    const a = docWithTitle('abc')
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    writeTitle(a, 'abcX')
    b.getText('title').insert(0, 'R')
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    expect(a.getText('title').toString()).toBe('RabcX')
    expect(b.getText('title').toString()).toBe('RabcX')
  })
})

// 제목 입력 중(포커스라 textarea 가 원격 값을 받지 않음) 들어온 원격 변경을 다음 입력이 지우지 않는다 (리뷰 E4)
describe('writeTitle — 직전 textarea 값 기준 (리뷰 E4)', () => {
  it("원격이 앞에 X 를 넣은 뒤 'Hello' → 'Hello!' 는 X 를 남긴다", () => {
    const doc = docWithTitle('Hello')
    doc.getText('title').insert(0, 'X') // 원격 변경 — textarea 는 여전히 'Hello'
    expect(writeTitle(doc, 'Hello!', 'Hello')).toBe(true)
    expect(doc.getText('title').toString()).toBe('XHello!')
  })

  it('원격이 뒤를 지운 뒤 앞에 친 글자도 제자리에 들어간다', () => {
    const doc = docWithTitle('Hello')
    doc.getText('title').delete(4, 1) // 원격: 'Hell'
    expect(writeTitle(doc, 'AHello', 'Hello')).toBe(true)
    expect(doc.getText('title').toString()).toBe('AHell')
  })

  it('직전 값이 Y.Text 와 같으면 그대로 바뀐 구간만', () => {
    const doc = docWithTitle('Hello')
    expect(writeTitle(doc, 'Hell', 'Hello')).toBe(true)
    expect(doc.getText('title').toString()).toBe('Hell')
  })

  it('직전 값과 새 값이 같으면 false', () => {
    const doc = docWithTitle('XHello')
    expect(writeTitle(doc, 'Hello', 'Hello')).toBe(false)
    expect(doc.getText('title').toString()).toBe('XHello')
  })
})

describe('F-305 U19 observeTitle', () => {
  it('다른 origin 의 변경에만 불리고 LOCAL_TITLE 에는 안 불린다', () => {
    const doc = docWithTitle('제목')
    const onRemote = vi.fn()
    const stop = observeTitle(doc, onRemote)
    writeTitle(doc, '내 제목')
    expect(onRemote).not.toHaveBeenCalled()

    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc))
    other.getText('title').insert(0, '남의 ')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), { relay: 'x' })
    expect(onRemote).toHaveBeenCalledTimes(1)
    expect(onRemote).toHaveBeenCalledWith('남의 내 제목')

    doc.transact(() => doc.getText('content').insert(0, '본문'), { relay: 'y' })
    expect(onRemote).toHaveBeenCalledTimes(1)

    stop()
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other), { relay: 'x' })
    other.getText('title').insert(0, '더 ')
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)), { relay: 'x' })
    expect(onRemote).toHaveBeenCalledTimes(1)
  })
})
