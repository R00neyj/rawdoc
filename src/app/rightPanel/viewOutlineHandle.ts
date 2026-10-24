// Outline(F-144) 최소 핸들 — 편집기 없는 보기 전용 화면(공개 보기·도움말·공유받은 문서)이 EditorState 하나로 제목·줄 위치만 흉내낸다
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'

import { extractHeadings, type Heading } from '../../editor/outline'
import { frontmatterExtension } from '../../editor/frontmatter'

export type ViewOutlineHandle = {
  getHeadings(): Heading[]
  onHeadingsChange(cb: (headings: Heading[]) => void): () => void
  view: EditorView
  scrollToHeading(from: number): void
  focus(): void
}

// content 는 보기 화면이 렌더한 원문과 같아야 한다 — 목차는 줄 번호로 data-source-line 제목을 찾는다
export function makeViewOutlineHandle(content: string): ViewOutlineHandle {
  const state = EditorState.create({
    doc: content,
    extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
  })
  return {
    getHeadings: () => extractHeadings(state),
    onHeadingsChange: () => () => {},
    view: { state } as unknown as EditorView,
    scrollToHeading: () => {},
    focus: () => {},
  }
}
