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
