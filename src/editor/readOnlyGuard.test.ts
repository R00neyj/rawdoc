// 읽기 전용이면 위젯(체크박스·표·이미지)이 직접 보내는 문서 변경도 막는다(리뷰 E1) — EditorState.readOnly 는 기본 명령만 막고 view.dispatch 는 안 막는다
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { ySyncAnnotation, YSyncConfig } from 'y-codemirror.next'
import * as Y from 'yjs'
import { readOnlyChangeGuard } from './readOnlyGuard'

function stateWith(readOnly: boolean) {
  return EditorState.create({
    doc: '- [ ] a',
    extensions: [EditorState.readOnly.of(readOnly), readOnlyChangeGuard],
  })
}

describe('readOnlyChangeGuard (리뷰 E1)', () => {
  it('읽기 전용이면 로컬 문서 변경(위젯 dispatch)을 버린다', () => {
    const state = stateWith(true)
    const next = state.update({ changes: { from: 3, to: 4, insert: 'x' } }).state
    expect(next.doc.toString()).toBe('- [ ] a')
    const table = state.update({ changes: { from: 0, insert: 'z' }, userEvent: 'input.table' }).state
    expect(table.doc.toString()).toBe('- [ ] a')
  })

  it('읽기 전용이어도 원격(ySyncAnnotation) 변경은 들어온다', () => {
    const state = stateWith(true)
    const ydoc = new Y.Doc()
    const conf = new YSyncConfig(ydoc.getText(), null as never)
    const next = state.update({ changes: { from: 3, to: 4, insert: 'x' }, annotations: ySyncAnnotation.of(conf) }).state
    expect(next.doc.toString()).toBe('- [x] a')
  })

  it('읽기 전용이면 선택만 바꾸는 트랜잭션은 그대로 둔다', () => {
    const state = stateWith(true)
    expect(state.update({ selection: { anchor: 2 } }).state.selection.main.head).toBe(2)
  })

  it('읽기 전용이 아니면 로컬 변경을 그대로 둔다', () => {
    const state = stateWith(false)
    const next = state.update({ changes: { from: 3, to: 4, insert: 'x' } }).state
    expect(next.doc.toString()).toBe('- [x] a')
  })
})
