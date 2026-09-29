// D-16 의 CM6 뷰 — 문서 편집기와 공유하는 코드가 없다 (specs/features/F-2096.md 4.1)
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { LanguageSupport, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { cssLanguage } from '@codemirror/lang-css'
import { classHighlighter } from '@lezer/highlight'
import { exceedsUserCssBytes } from './userCssEdit'

type Input = { parent: HTMLElement; doc: string; otherBytes: number; onDocChange: () => void; onTooLarge: () => void }

export function createUserCssEditor(i: Input): EditorView {
  const state = EditorState.create({
    doc: i.doc,
    extensions: [
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      syntaxHighlighting(classHighlighter),
      new LanguageSupport(cssLanguage),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        spellcheck: 'false',
        autocapitalize: 'off',
        autocorrect: 'off',
        'aria-labelledby': 'user-css-edit-css-label',
      }),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap]),
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged || !exceedsUserCssBytes(i.otherBytes, tr.newDoc.toString())) return tr
        i.onTooLarge()
        return []
      }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) i.onDocChange()
      }),
    ],
  })
  return new EditorView({ state, parent: i.parent })
}
