// 편집기 Doc 의 title Y.Text 쓰기·원격 변경 듣기 — 게이트가 방 Doc 으로 중계한다 (specs/features/F-305.md 9.3)
import type * as Y from 'yjs'

import { Y_TITLE_NAME } from '../lib/docRoomProtocol'
import { diffText } from '../lib/textRebase'

// 이 브라우저가 제목을 쓰는 트랜잭션의 origin — UndoManager 가 추적하지 않는다
export const LOCAL_TITLE: object = { title: 'local' }

// 바뀐 구간만 한 트랜잭션으로 — 통째로 바꾸면 상대가 동시에 친 글자까지 지운다
export function writeTitle(doc: Y.Doc, value: string): boolean {
  const text = doc.getText(Y_TITLE_NAME)
  const edit = diffText(text.toString(), value)
  if (!edit) return false
  doc.transact(() => {
    if (edit.to > edit.from) text.delete(edit.from, edit.to - edit.from)
    if (edit.insert) text.insert(edit.from, edit.insert)
  }, LOCAL_TITLE)
  return true
}

export function observeTitle(doc: Y.Doc, onRemote: (title: string) => void): () => void {
  const text = doc.getText(Y_TITLE_NAME)
  const observer = (event: Y.YTextEvent) => {
    if (event.transaction.origin === LOCAL_TITLE) return
    onRemote(text.toString())
  }
  text.observe(observer)
  return () => text.unobserve(observer)
}
