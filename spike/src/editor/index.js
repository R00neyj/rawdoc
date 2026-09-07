import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { inlinePreview } from './inline.js'
import { imeLog, makeEntry } from './imeLog.js'

/**
 * @typedef {object} EditorHandle
 * @property {EditorView} view
 * @property {() => string} getDoc    현재 문서 원문
 * @property {() => void}   destroy   view 해제. 두 번째 호출부터는 아무 일도 하지 않는다
 * @property {(on:boolean) => void} setSuspendOnComposition  보류 토글. 재마운트하지 않는다
 */

/**
 * CM6 에디터를 parent 에 마운트한다.
 *
 * basicSetup 을 쓰지 않는다 — 줄 번호·자동완성·괄호 매칭이 한꺼번에 붙으면
 * IME 관찰에 노이즈가 된다. 편집에 필요한 최소 확장만 조립한다.
 *
 * @param {HTMLElement} parent      마운트 대상. HTMLElement 가 아니면 TypeError 를 던진다
 * @param {object}      [options]
 * @param {string}      [options.doc]                   초기 문서. 기본 ''
 * @param {(doc:string)=>void} [options.onChange]       문서가 바뀔 때마다 호출
 * @param {boolean}     [options.livePreview]           기본 true
 * @param {boolean}     [options.suspendOnComposition]  기본 true
 * @param {(entry:import('./imeLog.js').LogEntry)=>void} [options.onLog]
 * @returns {EditorHandle}
 */
export function createEditor(parent, options = {}) {
  if (!(parent instanceof HTMLElement)) {
    throw new TypeError('createEditor: parent 는 HTMLElement 여야 합니다')
  }

  const {
    doc = '',
    onChange,
    livePreview = true,
    suspendOnComposition = true,
    onLog,
  } = options

  // ViewPlugin 은 view 가 만들어진 뒤에야 동작하므로, 여기서 참조만 잡아두고
  // 확장 안에서는 클로저로 읽는다. 그래야 inlinePreview 의 suspended 를
  // 인자 없는 콜백으로 유지할 수 있다.
  let view = null
  let suspend = suspendOnComposition

  const log = (kind) => {
    if (onLog) onLog(makeEntry(kind, view))
  }

  /**
   * 조합 중 재계산을 보류할지 판단하고, 그 판단을 로그로 남긴다.
   * compositionStarted 가 아니라 composing 을 쓴다 — 후자는 안드로이드에서
   * 상시 true 에 가까워 보류가 풀리지 않을 수 있다 (imeLog.js 주석 참조).
   */
  const suspended = () => {
    const skip = suspend && !!view?.composing
    log(skip ? 'skip' : 'recalc')
    return skip
  }

  const extensions = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        onChange(update.state.doc.toString())
      }
    }),
  ]

  if (livePreview) extensions.push(inlinePreview({ suspended }))
  if (onLog) extensions.push(imeLog(onLog))

  view = new EditorView({
    state: EditorState.create({ doc, extensions }),
    parent,
  })

  let destroyed = false

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      view.destroy()
    },
    setSuspendOnComposition: (on) => {
      suspend = !!on
    },
  }
}
