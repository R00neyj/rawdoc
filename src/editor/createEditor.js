// CM6 EditorView 생성·확장 조립 (specs/features/F-103.md 3.1)
// basicSetup 을 쓰지 않는다 — 자동완성·검색 패널을 넣지 않는다. 괄호·강조 기호 자동
// 짝은 `@codemirror/autocomplete` 의 closeBrackets() 가 아니라 F-127 의 autoPair() 다
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { autoPair } from './autoPair.js'
import { compositionCatchup } from './composition.js'
import { highlightExtension } from './highlight.js'
import { shortcutKeymap } from './commands.js'
import { livePreview } from './preview/index.js'
import { fenceLinePreview } from './preview/lines.js'

function previewExtensionFor(mode) {
  return mode === 'live' ? livePreview() : []
}

function attributesExtensionFor(mode) {
  return EditorView.editorAttributes.of({ 'data-view': mode })
}

/**
 * @param {HTMLElement} parent
 * @param {object} [options]
 * @param {string} [options.text] 저장소 content 그대로. 줄바꿈 형식을 여기서 바꾸지 않는다
 * @param {'live'|'raw'} [options.viewMode]
 * @param {(state:import('@codemirror/state').EditorState)=>void} [options.onDocChange]
 * @param {(state:import('@codemirror/state').EditorState)=>void} [options.onSelectionChange]
 */
export function createEditor(parent, options = {}) {
  const { text = '', viewMode = 'live', onDocChange, onSelectionChange } = options

  let destroyed = false

  const previewCompartment = new Compartment()
  const attributesCompartment = new Compartment()

  const extensions = [
    lineNumbers(),
    history(),
    EditorView.lineWrapping,
    // autoPair() 의 Backspace 키맵(Prec.high)이 markdown()의 deleteMarkupBackward
    // (역시 Prec.high)보다 먼저 받으려면 같은 우선순위 안에서 더 앞서 조립해야 한다
    // (@codemirror/view keymap 문서: "specified early... get checked first")
    autoPair(),
    // base 기본값(commonmarkLanguage)은 GFM 표를 파싱하지 않는다 (spike index.js 86~88행)
    markdown({ base: markdownLanguage }),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    highlightExtension(),
    // 펼친 코드블록 줄 표시 (F-124 3.4 11번) — 모드(편집·원문)와 무관하게 항상 켠다.
    // highlight.js 의 주석 참고: 태그 자체를 나누는 방법은 실측으로 안 먹히는 것을
    // 확인해 줄 decoration 으로 바꿨다
    fenceLinePreview(),
    previewCompartment.of(previewExtensionFor(viewMode)),
    attributesCompartment.of(attributesExtensionFor(viewMode)),
    // F-109 단축키가 defaultKeymap 보다 먼저 키를 받도록 Prec.high
    Prec.high(keymap.of(shortcutKeymap)),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    compositionCatchup(() => destroyed),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onDocChange) onDocChange(update.state)
      if (update.selectionSet && onSelectionChange) onSelectionChange(update.state)
    }),
  ]

  const state = EditorState.create({ doc: text, extensions })
  const view = new EditorView({ state, parent })

  return {
    view,

    /** @param {'crlf'|'lf'} lineEnding */
    getText(lineEnding) {
      const sep = lineEnding === 'crlf' ? '\r\n' : '\n'
      return view.state.doc.sliceString(0, view.state.doc.length, sep)
    },

    focus() {
      view.focus()
    },

    setCursorToStart() {
      view.dispatch({ selection: { anchor: 0, head: 0 } })
    },

    /** @param {'live'|'raw'} mode 재마운트하지 않는다. 커서·선택·실행 취소 기록 유지 */
    setViewMode(mode) {
      const scroll = view.scrollSnapshot()
      view.dispatch({
        effects: [
          previewCompartment.reconfigure(previewExtensionFor(mode)),
          attributesCompartment.reconfigure(attributesExtensionFor(mode)),
          scroll,
        ],
      })
    },

    /** 두 번째 호출은 무시한다 */
    destroy() {
      if (destroyed) return
      destroyed = true
      view.destroy()
    },
  }
}
