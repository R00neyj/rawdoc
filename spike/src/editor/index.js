import { Compartment, EditorState, StateEffect } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { inlinePreview } from './inline.js'
import { blockPreview } from './blocks.js'
import { imeLog, makeEntry } from './imeLog.js'

/**
 * 조합이 끝났으니 밀린 재계산을 지금 하라는 신호.
 *
 * compositionend 는 그 자체로 문서도 선택도 바꾸지 않는다. 그래서 보류 중에 밀린
 * 재계산을 따라잡을 시점이 아예 없었다 — 다음 사용자 조작이 올 때까지 화면이
 * 낡은 채로 남았다 (T-004 verify 6.5, 결함 A).
 *
 * inline.js 와 blocks.js 는 이 effect 를 인자로 받아서 본다.
 * 별도 모듈로 빼지 않은 이유는 두 파일이 index.js 를 import 하면 순환이 생기기 때문이다.
 */
const forceRecalc = StateEffect.define()

/**
 * @typedef {object} EditorHandle
 * @property {EditorView} view
 * @property {() => string} getDoc    현재 문서 원문
 * @property {() => void}   destroy   view 해제. 두 번째 호출부터는 아무 일도 하지 않는다
 * @property {(on:boolean) => void} setSuspendOnComposition  보류 토글. 재마운트하지 않는다
 * @property {(on:boolean) => void} setBlockPreview          블록 위젯 토글. Compartment 로 재구성한다
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
 * @param {boolean}     [options.livePreview]           인라인 프리뷰. 기본 true
 * @param {boolean}     [options.blockPreview]          표·코드블록 위젯. 기본 true
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
    blockPreview: useBlockPreview = true,
    suspendOnComposition = true,
    onLog,
  } = options

  // ViewPlugin 은 view 가 만들어진 뒤에야 동작하므로, 여기서 참조만 잡아두고
  // 확장 안에서는 클로저로 읽는다. 그래야 inlinePreview 의 suspended 를
  // 인자 없는 콜백으로 유지할 수 있다.
  let view = null
  let suspend = suspendOnComposition
  // compositionend 핸들러가 다음 틱에 읽는다. view.destroy() 뒤의 dispatch 를 막는다.
  let destroyed = false

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
    // base 기본값은 commonmarkLanguage 라 GFM 표가 파싱되지 않는다.
    // markdownLanguage 로 바꿔야 Table 노드가 생긴다.
    markdown({ base: markdownLanguage }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onChange) {
        onChange(update.state.doc.toString())
      }
    }),
    EditorView.domEventHandlers({
      compositionend: (_event, v) => {
        // 이 시점에 CM6 가 DOM 정리를 끝냈다는 보장이 없다. 다음 틱으로 미룬다.
        setTimeout(() => {
          if (destroyed) return
          log('recalc:end')
          v.dispatch({ effects: forceRecalc.of(null) })
        }, 0)
        return false
      },
    }),
  ]

  if (livePreview) extensions.push(inlinePreview({ suspended, forceRecalc }))
  if (onLog) extensions.push(imeLog(onLog))

  // 블록 프리뷰는 StateField 라 나중에 껐다 켜려면 Compartment 가 필요하다.
  // 재마운트로 대신하면 토글할 때마다 문서가 초기화된다.
  const blocks = new Compartment()
  const blockExt = () => blockPreview({ suspended, forceRecalc })
  extensions.push(blocks.of(useBlockPreview ? blockExt() : []))

  view = new EditorView({
    state: EditorState.create({ doc, extensions }),
    parent,
  })

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
    setBlockPreview: (on) => {
      view.dispatch({ effects: blocks.reconfigure(on ? blockExt() : []) })
    },
  }
}
