// Outline(F-144) 최소 핸들 — PublicView.tsx makeFakeHandle 과 같은 방식으로 도움말 원문을 모듈 스코프에서 한 번만 만든다 (F-249.md 3.1)
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { EditorView } from '@codemirror/view'

import { extractHeadings, type Heading } from '../editor/outline'
import { frontmatterExtension } from '../editor/frontmatter'
import { HELP_DOC_CONTENT } from './helpDoc'

export type HelpOutlineHandle = {
  getHeadings(): Heading[]
  onHeadingsChange(cb: (headings: Heading[]) => void): () => void
  view: EditorView
  scrollToHeading(from: number): void
  focus(): void
}

const helpEditorState = EditorState.create({
  doc: HELP_DOC_CONTENT,
  extensions: [markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] })],
})

export const helpOutlineHandle: HelpOutlineHandle = {
  getHeadings: () => extractHeadings(helpEditorState),
  onHeadingsChange: () => () => {},
  view: { state: helpEditorState } as unknown as EditorView,
  scrollToHeading: () => {},
  focus: () => {},
}
