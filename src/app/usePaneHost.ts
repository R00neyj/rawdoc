// 칸 편집기 등록부·창 안 원본 모음·문서 묶음 host — 창에 하나인 App 값(편집기 handle·보기·내용 영역 ref)은 포커스 칸 것을 가리킨다 (F-2163 3·6장)
import { useLayoutEffect, useState, type RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import { createPaneSources, sourceText, type PaneSources } from '../editor/paneSource'
import { Y_TEXT_NAME } from '../editor/yBinding'
import { Y_COMMENTS_NAME } from '../lib/docRoomProtocol'
import type { CommentRecord } from '../lib/docComments'
import type { ScrollAnchor } from '../lib/scrollAnchor'
import type { LineEnding } from '../types'
import type { ViewMode } from './ViewModeMenu'
import { buildLocalCommentRecords } from './useDocComments'

export type PaneEntry = {
  docId: string | null
  viewMode: ViewMode
  editorRef: RefObject<EditorHandle | null>
  viewerRef: RefObject<HTMLDivElement | null>
  contentAreaRef: RefObject<HTMLDivElement | null>
}

export type PaneHost = {
  sources: PaneSources
  register: (paneKey: string, entry: PaneEntry) => void
  unregister: (paneKey: string) => void
  // SplitPanes 가 커밋마다 부른다 — 칸 layout effect 뒤, App layout effect 앞이라 useEditorSync 가 새 편집기를 본다
  publish: (focusKey: string | null, current: boolean) => void
  focusEditor: (paneKey: string) => boolean
  getText: (docId: string, lineEnding: LineEnding) => string
  // 창 안 원본이 있는 로컬 문서만 — 그 밖은 null (F-2161 5장)
  getComments: (docId: string, local: boolean) => CommentRecord[] | null
}

export type UsePaneHostOptions = {
  setEditorRefs: (handle: EditorHandle | null) => void
  viewerRef: RefObject<HTMLDivElement | null>
  contentAreaRef: RefObject<HTMLDivElement | null>
  scrollAnchorRef: RefObject<{ docId: string; anchor: ScrollAnchor } | null>
  viewMode: ViewMode
  // 포커스 칸 편집기 본문으로 보기 HTML 을 다시 만든다 — 같은 문서를 다른 칸에서 고쳤을 수 있다 (F-2163 3장)
  renderViewer: () => void
}

function createPaneHost(opts: Pick<UsePaneHostOptions, 'setEditorRefs' | 'viewerRef' | 'contentAreaRef' | 'scrollAnchorRef'>) {
  const sources = createPaneSources()
  const entries = new Map<string, PaneEntry>()
  const published: { key: string | null; handle: EditorHandle | null } = { key: null, handle: null }
  let rebuild = false

  const host: PaneHost & { takeRebuild: () => boolean } = {
    sources,
    register: (paneKey, entry) => void entries.set(paneKey, entry),
    unregister: (paneKey) => void entries.delete(paneKey),
    publish(focusKey, current) {
      const entry = focusKey === null ? undefined : entries.get(focusKey)
      const handle = current ? (entry?.editorRef.current ?? null) : null
      if (handle !== published.handle) {
        published.handle = handle
        opts.setEditorRefs(handle)
      }
      opts.viewerRef.current = entry?.viewerRef.current ?? null
      opts.contentAreaRef.current = entry?.contentAreaRef.current ?? null
      if (focusKey !== published.key) {
        // 포커스를 옮기면 모드 전환 스크롤 기준값은 옛 칸 것이라 버린다
        if (published.key !== null && focusKey !== null) {
          opts.scrollAnchorRef.current = null
          rebuild = true
        }
        published.key = focusKey
      }
    },
    focusEditor(paneKey) {
      const entry = entries.get(paneKey)
      if (!entry) return false
      const target = entry.viewMode === 'view' ? entry.viewerRef.current : entry.editorRef.current
      target?.focus()
      return target !== null
    },
    getText(docId, lineEnding) {
      const source = sources.source(docId)
      if (source) return sourceText(source, lineEnding)
      const focused = published.key === null ? undefined : entries.get(published.key)
      const shown = [focused, ...entries.values()].find((e) => e?.docId === docId && e.editorRef.current)
      return shown?.editorRef.current?.getText(lineEnding) ?? ''
    },
    getComments(docId, local) {
      const source = local ? sources.source(docId) : null
      if (!source) return null
      const map = source.getMap<unknown>(Y_COMMENTS_NAME)
      return buildLocalCommentRecords({ map, ytext: source.getText(Y_TEXT_NAME), text: sourceText(source, 'lf'), ranges: new Map() })
    },
    takeRebuild() {
      const was = rebuild
      rebuild = false
      return was
    },
  }
  return host
}

export function usePaneHost(options: UsePaneHostOptions): PaneHost {
  const { viewMode, renderViewer } = options
  const [host] = useState(() => createPaneHost(options))
  // 포커스가 다른 칸으로 옮겨 갔고 그 칸이 보기면 그 칸 편집기 본문으로 다시 그린다
  useLayoutEffect(() => {
    if (host.takeRebuild() && viewMode === 'view') renderViewer()
  })
  return host
}
