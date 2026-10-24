// 창 안 원본 모음 — 링크 없는 문서가 두 칸 이상에 뜨면 네트워크 없는 원본 Y.Doc 을 둔다 (specs/features/F-2161.md 3장·5장)
import * as Y from 'yjs'

import type { LineEnding } from '../lib/markdown/lineEnding'
import { Y_TEXT_NAME } from './yBinding'

export type SourcePane = { editorDoc: Y.Doc; followSource(source: Y.Doc): void }

export type PaneSources = {
  prepare(docId: string): Y.Doc | null
  add(docId: string, pane: SourcePane): void
  remove(docId: string, pane: SourcePane): void
  source(docId: string): Y.Doc | null
}

// 씨앗 트랜잭션 origin — 어느 게이트의 중계도 아니다
const SEED = { seed: 'pane-source' }

type Entry = { panes: SourcePane[]; source: Y.Doc | null }

export function createPaneSources(): PaneSources {
  const entries = new Map<string, Entry>()

  return {
    // 씨앗과 followSource 사이에 await 가 없어 그 틈으로 편집이 새지 않는다 (3장)
    prepare(docId) {
      const entry = entries.get(docId)
      if (!entry) return null
      if (entry.source) return entry.source
      const [first] = entry.panes
      const source = new Y.Doc()
      Y.applyUpdate(source, Y.encodeStateAsUpdate(first.editorDoc), SEED)
      entry.source = source
      first.followSource(source)
      return source
    },
    add(docId, pane) {
      const entry = entries.get(docId)
      if (!entry) entries.set(docId, { panes: [pane], source: null })
      else if (!entry.panes.includes(pane)) entry.panes.push(pane)
    },
    // 1칸만 남아도 원본을 둔다 — 모든 칸에서 빠질 때 버린다 (F-2159 2장)
    remove(docId, pane) {
      const entry = entries.get(docId)
      const index = entry?.panes.indexOf(pane) ?? -1
      if (!entry || index < 0) return
      entry.panes.splice(index, 1)
      if (entry.panes.length > 0) return
      entry.source?.destroy()
      entries.delete(docId)
    },
    source: (docId) => entries.get(docId)?.source ?? null,
  }
}

// 편집기 Y.Text 는 늘 \n 이라 handle getText 와 같은 바이트가 된다 (5장)
export function sourceText(source: Y.Doc, lineEnding: LineEnding): string {
  const text = source.getText(Y_TEXT_NAME).toString()
  return lineEnding === 'crlf' ? text.replaceAll('\n', '\r\n') : text
}
