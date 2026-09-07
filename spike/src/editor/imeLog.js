import { EditorView } from '@codemirror/view'

/**
 * @typedef {object} LogEntry
 * @property {number} t                     performance.now()
 * @property {string} kind                  'compositionstart' | 'compositionend' | 'recalc' | 'skip'
 *                                          | 'suspend:on' | 'suspend:off'  (화면 토글 조작)
 * @property {boolean} composing            EditorView.composing 값
 * @property {boolean} compositionStarted   EditorView.compositionStarted 값
 * @property {number} docLength
 */

/**
 * 로그 항목 하나를 만든다.
 *
 * composing 과 compositionStarted 를 **둘 다** 남긴다.
 * @codemirror/view 의 d.ts 가 compositionStarted 는 안드로이드에서 단어에 커서를
 * 올리기만 해도 true 가 된다고 경고하므로, B-005 에서 두 값의 차이를 봐야 한다.
 *
 * @param {string} kind
 * @param {EditorView | null} view
 * @returns {LogEntry}
 */
export function makeEntry(kind, view) {
  return {
    t: performance.now(),
    kind,
    composing: !!view?.composing,
    compositionStarted: !!view?.compositionStarted,
    docLength: view ? view.state.doc.length : 0,
  }
}

/**
 * composition 이벤트를 sink 로 흘려보내는 확장. 검증 전용이며 본 제품 이식 시 제거한다.
 *
 * @param {(entry:LogEntry)=>void} sink
 * @returns {import('@codemirror/state').Extension}
 */
export function imeLog(sink) {
  return EditorView.domEventHandlers({
    compositionstart: (_event, view) => {
      sink(makeEntry('compositionstart', view))
      return false
    },
    compositionend: (_event, view) => {
      sink(makeEntry('compositionend', view))
      return false
    },
  })
}
