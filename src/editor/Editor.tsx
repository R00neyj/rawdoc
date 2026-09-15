// CM6 React 래퍼 (specs/features/F-103.md 3.3)
// docId·lineEnding 은 인터페이스에는 있지만 이 컴포넌트 내부에서는 쓰지 않는다.
// App 이 key={docId} 로 문서마다 새로 마운트하고(위→아래 데이터 흐름), lineEnding 은
// ref 로 노출한 handle.getText(lineEnding) 호출 시점에 App 이 직접 넘긴다 (F-110)
import { useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { Ref } from 'react'
import type { EditorState } from '@codemirror/state'

import { createEditor } from './createEditor'
import type { OnOpenWikiLink } from './preview/wikiLinks'
import type { ResolveAttachment } from './preview/blocks'
import type { OnImageFiles } from './imageInsert'
import type { OnTitleChange, OnTitleCommit } from './docTitle'

export type EditorHandle = ReturnType<typeof createEditor>

type EditorProps = {
  text?: string
  viewMode?: 'live' | 'raw' | 'view'
  readOnly?: boolean
  // true: 본문 맨 앞에 포커스. 'title': 본문 맨 위 제목에 포커스 + 전체 선택(새 문서, F-217.md 2.3)
  autoFocus?: boolean | 'title'
  onDocChange?: (state: EditorState) => void
  onSelectionChange?: (state: EditorState) => void
  wikiTitles?: string[]
  onOpenWikiLink?: OnOpenWikiLink
  onImageFiles?: OnImageFiles
  resolveAttachment?: ResolveAttachment
  title?: string
  titleReadOnly?: boolean
  onTitleChange?: OnTitleChange
  onTitleCommit?: OnTitleCommit
  ref?: Ref<EditorHandle | null>
}

export default function Editor({
  text,
  viewMode,
  readOnly,
  autoFocus,
  onDocChange,
  onSelectionChange,
  wikiTitles,
  onOpenWikiLink,
  onImageFiles,
  resolveAttachment,
  title,
  titleReadOnly,
  onTitleChange,
  onTitleCommit,
  ref,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<EditorHandle | null>(null)

  // 마운트 시 1회 생성, 언마운트 시 destroy. text prop 이 나중에 바뀌어도 에디터
  // 내용을 바꾸지 않는다(역방향 동기화 금지, architecture.md 3장) — 그래서 의존성
  // 배열을 비워 최초 마운트에만 실행한다. StrictMode 이중 effect(마운트→해제→마운트)
  // 에서도 destroy() 가 매번 정리하므로 에디터가 2개 생기지 않는다.
  // useImperativeHandle 은 내부적으로 layout effect 라 handleRef 설정도 layout effect 로
  // 맞춰야 ref 가 노출될 때 handle 이 이미 준비돼 있다
  useLayoutEffect(() => {
    const handle = createEditor(containerRef.current!, {
      text,
      viewMode,
      readOnly,
      onDocChange,
      onSelectionChange,
      wikiTitles,
      onOpenWikiLink,
      onImageFiles,
      resolveAttachment,
      title,
      titleReadOnly,
      onTitleChange,
      onTitleCommit,
    })
    handleRef.current = handle
    // 문서 전환 후 포커스 + 커서 맨 앞 (ia.md 3.4, F-103 3.4). App 의 passive effect 에서
    // editorRef 를 뒤늦게 focus() 하지 않고, 뷰를 만드는 이 layout effect 안에서 바로
    // 적용한다: StrictMode 는 새로 마운트되는 컴포넌트의 effect 를 마운트→해제→재마운트로
    // 한 번 더 실행하고, 이 블록도 재마운트 때 다시 실행되므로 실제로 남는(최종) 뷰가
    // 항상 포커스를 받는다. 이전에는 App 의 passive effect 가 첫 번째(곧 파괴될) 뷰만
    // focus() 하고 플래그를 내려서, StrictMode 재마운트로 만들어진 두 번째 뷰는 포커스를
    // 못 받는 문제가 있었다(dev 서버에서만 재현, 프로덕션 빌드는 이중 마운트가 없어 안 보임)
    // autoFocus === 'title' 은 새 문서 흐름(ia.md 3.3) — 본문 맨 위 제목에 포커스 + 전체 선택
    if (autoFocus === 'title') {
      handle.focusTitle(true)
    } else if (autoFocus) {
      handle.focus()
      handle.setCursorToStart()
    }
    return () => {
      handle.destroy()
      handleRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useImperativeHandle<EditorHandle | null, EditorHandle | null>(ref, () => handleRef.current, [])

  return <div className="cm-host" ref={containerRef} />
}
