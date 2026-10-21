// CM6 React 래퍼. docId 는 원격 연결 훅 전달용(F-303), lineEnding 은 App 이 handle.getText 호출 시점에 직접 넘긴다(F-103 3.3, F-110)
import { useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { Ref } from 'react'
import type { EditorState } from '@codemirror/state'

import { createEditor } from './createEditor'
import type { LiveEditorOptions } from './createEditor'
import type { PaneSources } from './paneSource'
import type { OnOpenWikiLink, WikiContext } from './preview/wikiLinks'
import type { ResolveAttachment } from './preview/blocks'
import type { OnImageFiles } from './imageInsert'
import type { OnTitleChange, OnTitleCommit } from './docTitle'
import type { ResolveImagePath } from '../lib/imageMarkdown'

export type EditorHandle = ReturnType<typeof createEditor>

type EditorProps = {
  text?: string
  viewMode?: 'live' | 'raw' | 'view'
  readOnly?: boolean
  // true: 본문 맨 앞에 포커스. 'title': 본문 맨 위 제목에 포커스 + 전체 선택(새 문서, F-217.md 2.3)
  autoFocus?: boolean | 'title'
  onDocChange?: (state: EditorState) => void
  onSelectionChange?: (state: EditorState) => void
  wikiContext?: WikiContext
  onOpenWikiLink?: OnOpenWikiLink
  onImageFiles?: OnImageFiles
  resolveAttachment?: ResolveAttachment
  // 마운트 때만 읽는다 — 이후 값은 handle.setImagePaths() (F-2131 3.1)
  resolveImagePath?: ResolveImagePath | null
  title?: string
  titleReadOnly?: boolean
  onTitleChange?: OnTitleChange
  onTitleCommit?: OnTitleCommit
  // 원격 연결 훅에 넘긴다 (F-303 4.4). 마운트 때 한 번만 읽는다 — App 이 key 로 문서마다 새로 마운트한다
  docId?: string
  // 실시간 경로의 방 Doc (F-305 9장). 마운트 때 한 번만 읽는다
  live?: LiveEditorOptions
  // 같은 문서가 여러 칸에 뜨면 창 안 원본을 따른다 (F-2163 6장). live 가 있으면 넘기지 않는다, 마운트 때 한 번만 읽는다
  paneSources?: PaneSources
  ref?: Ref<EditorHandle | null>
}

export default function Editor({
  text,
  viewMode,
  readOnly,
  autoFocus,
  onDocChange,
  onSelectionChange,
  wikiContext,
  onOpenWikiLink,
  onImageFiles,
  resolveAttachment,
  resolveImagePath,
  title,
  titleReadOnly,
  onTitleChange,
  onTitleCommit,
  docId,
  live,
  paneSources,
  ref,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<EditorHandle | null>(null)

  // 빈 deps 로 최초 마운트에만 생성 — text 재동기화 금지(역방향 동기화 금지, architecture.md 3장), StrictMode 이중 effect 도 destroy() 가 정리함
  // useImperativeHandle 도 layout effect 라 handleRef 를 여기서 같이 설정해야 ref 노출 시점에 handle 이 준비돼 있다
  useLayoutEffect(() => {
    // 새 칸이 원본을 만든 뒤 붙는다 — 사이에 await 가 없어 씨앗과 게이트 사이로 편집이 새지 않는다 (F-2161 3장)
    const sources = paneSources && docId ? paneSources : null
    const paneSource = sources?.prepare(docId!) ?? undefined
    const handle = createEditor(containerRef.current!, {
      text,
      viewMode,
      readOnly,
      onDocChange,
      onSelectionChange,
      wikiContext,
      onOpenWikiLink,
      onImageFiles,
      resolveAttachment,
      resolveImagePath: resolveImagePath ?? undefined,
      title,
      titleReadOnly,
      onTitleChange,
      onTitleCommit,
      docId,
      live,
      paneSource,
    })
    sources?.add(docId!, handle)
    handleRef.current = handle
    // 포커스는 뷰를 만드는 이 layout effect 에서 바로 적용한다 — App 의 passive effect 에서 하면 StrictMode 재마운트 시 파괴될 첫 뷰만 focus 되고 남는 뷰는 못 받는다(dev 전용, ia.md 3.4, F-103 3.4)
    // autoFocus === 'title' 은 새 문서 흐름 — 제목에 포커스 + 전체 선택(ia.md 3.3)
    if (autoFocus === 'title') {
      handle.focusTitle(true)
    } else if (autoFocus) {
      handle.focus()
      handle.setCursorToStart()
    }
    return () => {
      sources?.remove(docId!, handle)
      handle.destroy()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle<EditorHandle | null, EditorHandle | null>(ref, () => handleRef.current, [])

  return <div className="cm-host" data-ui="editor" ref={containerRef} />
}
