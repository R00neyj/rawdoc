import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

/**
 * @typedef {object} EditorHandle
 * @property {EditorView} view
 * @property {() => string} getDoc    현재 문서 원문
 * @property {() => void}   destroy   view 해제. 두 번째 호출부터는 아무 일도 하지 않는다
 */

/**
 * CM6 에디터를 parent 에 마운트한다.
 *
 * basicSetup 을 쓰지 않는다 — 줄 번호·자동완성·괄호 매칭이 한꺼번에 붙으면
 * 이후 IME 관찰에 노이즈가 된다. 편집에 필요한 최소 확장만 조립한다.
 *
 * @param {HTMLElement} parent      마운트 대상. HTMLElement 가 아니면 TypeError 를 던진다
 * @param {object}      [options]
 * @param {string}      [options.doc]       초기 문서. 기본 ''
 * @param {(doc:string)=>void} [options.onChange]  문서가 바뀔 때마다 호출
 * @returns {EditorHandle}
 */
export function createEditor(parent, options = {}) {
  if (!(parent instanceof HTMLElement)) {
    throw new TypeError('createEditor: parent 는 HTMLElement 여야 합니다')
  }

  const { doc = '', onChange } = options

  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString())
        }
      }),
    ],
  })

  const view = new EditorView({ state, parent })

  let destroyed = false

  return {
    view,
    getDoc: () => view.state.doc.toString(),
    destroy: () => {
      if (destroyed) return
      destroyed = true
      view.destroy()
    },
  }
}
