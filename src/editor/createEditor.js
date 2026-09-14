// CM6 EditorView 생성·확장 조립 (specs/features/F-103.md 3.1)
// basicSetup 을 쓰지 않는다 — 자동완성·검색 패널을 넣지 않는다. 괄호·강조 기호 자동
// 짝은 `@codemirror/autocomplete` 의 closeBrackets() 가 아니라 F-127 의 autoPair() 다
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { autoPair } from './autoPair.js'
import { compositionCatchup, isComposing, isForced } from './composition.js'
import { frontmatterExtension } from './frontmatter.js'
import { highlightExtension } from './highlight.js'
import { shortcutKeymap } from './commands.js'
import { extractHeadings } from './outline.js'
import { livePreview } from './preview/index.js'
import { fenceLinePreview } from './preview/lines.js'
import { setWikiTitlesEffect, wikiTitlesField } from './preview/wikiLinks.js'
import { wikiComplete } from './wikiComplete.js'

// 제목 목록 갱신 debounce (specs/features/F-144.md 3.3 "입력이 멈춘 뒤(150ms) 갱신")
const HEADINGS_DEBOUNCE_MS = 150

function previewExtensionFor(mode, { onOpenWikiLink } = {}) {
  return mode === 'live' ? livePreview({ onOpenWikiLink }) : []
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
 * @param {string[]} [options.wikiTitles] 위키링크 대상 판정용 문서 제목 목록(F-131). 이후
 *   갱신은 handle.setWikiTitles() 로 한다 — 이 값은 최초 생성에만 쓴다
 * @param {(target:string)=>void} [options.onOpenWikiLink] 위키링크 클릭·자동완성 흐름 (F-131 3·5장)
 */
export function createEditor(parent, options = {}) {
  const { text = '', viewMode = 'live', onDocChange, onSelectionChange, wikiTitles = [], onOpenWikiLink } = options

  let destroyed = false

  // 목차 갱신은 조합 중 보류, 조합 종료(forceRecalc) 시 즉시 따라잡음 (F-144 3.3)
  const headingsListeners = new Set()
  let headingsTimer = null

  function notifyHeadings(state) {
    const headings = extractHeadings(state)
    headingsListeners.forEach((cb) => cb(headings))
  }

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
    // extensions: 문서 첫 줄 YAML 프론트매터를 Frontmatter 노드로 만든다 (F-133 3.2) —
    // 모드(편집·원문) 공통. 이게 없으면 lezer 는 첫 `---` 를 HorizontalRule, 그 다음
    // 줄을 SetextHeading2 로 잘못 읽는다
    markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }),
    indentUnit.of('  '),
    EditorState.tabSize.of(2),
    highlightExtension(),
    // 펼친 코드블록 줄 표시 (F-124 3.4 11번) — 모드(편집·원문)와 무관하게 항상 켠다.
    // highlight.js 의 주석 참고: 태그 자체를 나누는 방법은 실측으로 안 먹히는 것을
    // 확인해 줄 decoration 으로 바꿨다
    fenceLinePreview(),
    // 위키링크 대상 문서 제목(F-131). 모드와 무관하게 항상 켠다 — wikiComplete() 도
    // 같은 필드를 읽고, 모드 전환으로 previewCompartment 가 바뀌어도 값을 잃지 않는다
    wikiTitlesField.init(() => wikiTitles),
    wikiComplete(),
    previewCompartment.of(previewExtensionFor(viewMode, { onOpenWikiLink })),
    attributesCompartment.of(attributesExtensionFor(viewMode)),
    // F-109 단축키가 defaultKeymap 보다 먼저 키를 받도록 Prec.high
    Prec.high(keymap.of(shortcutKeymap)),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    compositionCatchup(() => destroyed),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onDocChange) onDocChange(update.state)
      if (update.selectionSet && onSelectionChange) onSelectionChange(update.state)

      if (isForced(update)) {
        clearTimeout(headingsTimer)
        notifyHeadings(update.state)
      } else if (update.docChanged && !isComposing(update.view)) {
        clearTimeout(headingsTimer)
        headingsTimer = setTimeout(() => {
          if (destroyed) return
          notifyHeadings(update.state)
        }, HEADINGS_DEBOUNCE_MS)
      }
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
          previewCompartment.reconfigure(previewExtensionFor(mode, { onOpenWikiLink })),
          attributesCompartment.reconfigure(attributesExtensionFor(mode)),
          scroll,
        ],
      })
    },

    /** 문서 제목 목록 갱신 (F-131 3장) — 문서 생성·삭제·제목 변경 시 App 이 부른다 */
    setWikiTitles(titles) {
      view.dispatch({ effects: setWikiTitlesEffect.of(titles) })
    },

    getHeadings() {
      return extractHeadings(view.state)
    },

    /** @returns {() => void} 구독 해제 */
    onHeadingsChange(callback) {
      headingsListeners.add(callback)
      return () => headingsListeners.delete(callback)
    },

    // 화면 밖 줄 높이 추정 오차를 그려진 뒤(rAF 2회) 실측으로 보정 (F-144 3.3, F-152 2.5)
    scrollToHeading(pos) {
      const clamped = Math.max(0, Math.min(pos, view.state.doc.length))
      view.dispatch({ effects: EditorView.scrollIntoView(clamped, { y: 'start', yMargin: 16 }) })
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (destroyed) return
          const coords = view.coordsAtPos(clamped)
          if (!coords) return
          const scrollerTop = view.scrollDOM.getBoundingClientRect().top
          const delta = coords.top - scrollerTop - 16
          if (Math.abs(delta) > 0.5) view.scrollDOM.scrollTop += delta
        })
      })
    },

    /** 두 번째 호출은 무시한다 */
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(headingsTimer)
      headingsListeners.clear()
      view.destroy()
    },
  }
}
