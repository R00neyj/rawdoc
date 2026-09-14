// 블록 위젯 — 표·코드블록 (specs/features/F-106.md)
// CM6 는 block decoration 을 ViewPlugin 에서 받지 않는다("Block decorations may not
// be specified via plugins") — 그래서 StateField 로 제공한다 (spike blocks.js 225~232행).
// 그 결과 visibleRanges 로 범위를 좁히지 못하고 buildBlocks 가 문서 전체를 순회한다
// (F-106 2.5 성능 기록은 이 비용을 재는 것이다).
// decoration 은 문서를 바꾸지 않는다 — 위젯 치환도 표시만 바꾼다 (CLAUDE.md 불변조건)
import { Prec, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'

import { parseImageBlock } from '../../lib/imageBlock.js'
import { isComposing, isForced } from '../composition.js'
import { isEditorFocused } from './active.js'
import { ImageWidget, destroyImageCache } from './imageWidget.js'
import {
  TableWidget,
  enterTableFromKeyboard,
  isCellComposing,
  trackActiveEditRange,
  trackPendingWrites,
} from './tableWidget.js'

/**
 * 커서나 선택 영역이 [from, to] 와 겹치는가.
 * active.js 의 activeLines 를 쓰지 않는다 — 그쪽은 줄 번호 집합으로 판정하고
 * 여기는 노드 범위(줄 경계로 확장한 값) 겹침으로 판정해 기준이 다르다.
 */
function overlaps(state, from, to) {
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true
  }
  return false
}

/**
 * 표 원문 범위 안에 있는 **빈 커서**인가 (F-139 3.1). 표를 치는 도중(구분 행이
 * 아직 다 안 쳐졌는데 GFM 최소 조건을 만족해 Table 로 인식되는 순간 등) 위젯이
 * 그 범위를 가리면 커서가 위젯 DOM(비활성, `ignoreEvent()` 참) 안에 놓여 이어지는
 * 키 입력이 사라진다 — 이 조건일 때는 표를 위젯이 아니라 원문으로 보여 코드블록과
 * 같은 "겹치면 원문" 경로를 타게 한다.
 * 표를 걸친 **비어 있지 않은** 선택(Shift+방향키)은 여기 해당하지 않는다(F-125 A2
 * 유지) — `main.empty` 로 가른다.
 * 칸 편집 중에는(tableWidget.js `startEdit`·`enterTableFromKeyboard`) 주 에디터
 * 선택을 표 범위 안으로 옮기지 않으므로 이 조건과 겹치지 않는다.
 */
function emptyCursorInside(state, from, to) {
  const { main } = state.selection
  return main.empty && main.head >= from && main.head <= to
}

/**
 * 위젯 DOM 에서 클릭한 지점의, 블록 시작 기준 상대 오프셋을 구한다.
 * 코드블록 줄 `<span>`, 표 셀 `<td>`/`<th>` 가 `data-offset` 을 들고 있으면 그 값을,
 * 없으면 0(블록 시작)을 쓴다.
 */
function offsetAt(event) {
  const target = event.target.closest?.('[data-offset]')
  return target ? Number(target.dataset.offset) : 0
}

/**
 * 위젯 DOM 에 "클릭하면 원문으로 진입" 을 붙인다 (F-106 2.3, spike 18~35행).
 * `mousedown` 에서 `preventDefault` 하지 않으면 CM6 가 그 뒤에 자기 방식으로
 * selection 을 다시 잡아 진입 위치가 어긋난다.
 * 위치는 위젯이 들고 있지 않고 클릭 시점에 `view.posAtDOM(wrap)` 으로 역산한다 —
 * `eq()` 가 true 면 CM6 가 옛 위젯 인스턴스를 그대로 두므로 저장해 둔 위치는 낡을 수 있다.
 */
function enterOnClick(wrap, view) {
  wrap.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const pos = view.posAtDOM(wrap) + offsetAt(event)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
  })
}

/**
 * 위젯 DOM 요소별 ResizeObserver 추적 (F-134 3.6).
 *
 * 이전엔 observer 를 위젯 인스턴스(this.observer)에 저장했다. buildBlocks 는 재계산할
 * 때마다 새 위젯 인스턴스를 만드는데, eq() 가 참이면 CM 은 옛 DOM 을 그대로 두고 새
 * 인스턴스를 그 DOM 에 이어붙인다 — 이때 toDOM 이 다시 불리지 않으므로 새 인스턴스엔
 * observer 가 없다. 나중에 그 DOM 이 정말 제거될 때 destroy(dom) 은 "최신" 위젯
 * 인스턴스에서 불리므로(처음 toDOM 을 부른 인스턴스가 아니다), observer 를 인스턴스에
 * 저장했다면 그 인스턴스엔 값이 없어 원래 만든 ResizeObserver 를 끊지 못하고 샌다.
 * DOM 요소를 key 로 쓰면 "어느 인스턴스가 만들었는지" 와 무관하게 해제할 수 있다.
 */
const heightObservers = new WeakMap()

/**
 * 위젯 최상위 요소 높이가 (가로 스크롤바 등장 등으로) toDOM 이후 바뀌면 CM6 에 알린다
 * (F-124 3.4 12번 요청). CM6 는 위젯 높이를 DOM 에서 재어 줄 위치표를 만드는데,
 * `requestMeasure()` 를 부르지 않으면 그 아래 줄들의 클릭 위치가 어긋난다.
 *
 * 실측 중 한 번은 여기에 `requestAnimationFrame` 으로 추가 `requestMeasure()` 를
 * 더 걸어봤다가, 문서 전체 줄 높이가 미측정 기본값(14)으로 굳고 브라우저 탭이
 * 멈추는 것처럼 보이는 현상을 만났다 — 원인을 추가로 실측한 결과, 실제로는
 * 코드 문제가 아니라 **테스트 탭이 백그라운드(`document.hidden === true`)라
 * `ResizeObserver`·`requestAnimationFrame`·CM6 의 `requestMeasure` 모두가 브라우저
 * 차원에서 멈춰 있었던 것**이었다(탭을 화면에 그려지게(스크린샷 등으로 페인트를
 * 한 번 강제) 만들자 ResizeObserver 가 위젯마다 정확히 1번씩만 불렸고, `<table>`
 * auto layout 위젯을 포함해 4개 모두 `cmBlockHeight === domHeight` 로 정확히
 * 맞았다 — 실측 로그 참고). 즉 ResizeObserver 하나만으로 충분하고, 이 함수는
 * 원래 형태(추가 재측정 없음)가 맞다
 * @param {HTMLElement} el 관찰할 위젯 최상위 요소
 * @param {import('@codemirror/view').EditorView} view
 */
export function observeHeight(el, view) {
  const observer = new ResizeObserver(() => view.requestMeasure())
  observer.observe(el)
  heightObservers.set(el, observer)
}

/** el 에 연결된 ResizeObserver 를 해제한다. 어느 위젯 인스턴스가 불렀는지와 무관하다
 * (F-134 3.6) — el 자체가 key 다.
 * @param {HTMLElement} el
 */
export function stopObservingHeight(el) {
  heightObservers.get(el)?.disconnect()
  heightObservers.delete(el)
}

/** 펜스 코드블록 위젯. 구문 강조는 하지 않는다 (F-106 2.1) */
class CodeWidget extends WidgetType {
  /**
   * @param {string} info CodeInfo (언어)
   * @param {{text:string, offset:number}[]} lines 각 줄의 원문(들여쓰기·`> ` 접두 제외)과
   *   블록 시작 기준 상대 offset(그 줄 첫 글자 위치). 목록·인용 안 코드블록은 줄마다
   *   `CodeText` 가 나뉘어(F-134 3.4) offset 이 등차수열이 아닐 수 있어 줄별로 든다
   */
  constructor(info, lines) {
    super()
    this.info = info
    this.lines = lines
    // 비교 기준은 화면 표시 내용뿐 아니라 클릭 위치 계산에 쓰는 offset 도 포함한다
    // (F-134 3.3) — 칸 글자가 같아도 공백·구분 행·펜스 길이·들여쓰기가 다르면 offset 이
    // 달라진다. eq 를 참으로 잘못 판정하면 CM 이 옛 DOM(옛 data-offset)을 재사용해
    // 클릭 위치가 어긋난다. (예전 주석은 "codeOffset 은 info 길이에서 나오는 파생값"
    // 이라 했지만 사실이 아니다 — 목록·인용 들여쓰기, 펜스 길이에 따라서도 달라진다.)
    this.key = JSON.stringify({ info, lines })
  }

  eq(other) {
    return other.key === this.key
  }

  toDOM(view) {
    // 최상위 요소(wrap)에는 세로 margin 을 쓰지 않는다 — CM6 는 위젯 높이를 DOM 에서
    // 잴 때 margin 을 포함하지 않는다(F-124 3.4 12번 요청 원인 (나)). 위아래 간격은
    // wrap 자체의 padding 으로 주고(=wrap 의 높이에 포함됨), 배경·모서리는 안쪽
    // 요소(inner)에 준다 — 그래야 간격 자리가 배경색으로 칠해지지 않는다
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-codeblock'

    const inner = document.createElement('div')
    inner.className = 'md-codeblock-inner'

    if (this.info) {
      const lang = document.createElement('span')
      lang.className = 'md-codeblock-lang'
      lang.textContent = this.info
      inner.appendChild(lang)
    }

    const pre = document.createElement('pre')
    this.lines.forEach((line, i) => {
      const span = document.createElement('span')
      span.className = 'md-codeblock-line'
      span.dataset.offset = String(line.offset)
      span.textContent = line.text
      pre.appendChild(span)
      if (i < this.lines.length - 1) pre.appendChild(document.createTextNode('\n'))
    })

    // pre 를 스크롤 전용 래퍼로 감싼다 — 긴 코드 줄이 문서 전체를 가로로 밀지 않고
    // 코드블록 안에서만 가로 스크롤되게 한다 (F-124 3.4). data-offset 클릭 위치 계산은
    // pre 안 구조(span[data-offset])를 그대로 두므로 영향받지 않는다
    const scroll = document.createElement('div')
    scroll.className = 'md-codeblock-scroll'
    scroll.appendChild(pre)
    inner.appendChild(scroll)
    wrap.appendChild(inner)

    observeHeight(wrap, view)

    enterOnClick(wrap, view)
    return wrap
  }

  ignoreEvent() {
    return true
  }

  destroy(dom) {
    stopObservingHeight(dom)
  }
}

/**
 * @param {number} blockFrom 위젯이 치환할 범위의 시작(줄 경계로 확장한 값)
 *
 * 목록·인용 안 코드블록은 lezer 가 줄마다 `CodeText` 를 나눈다(각 줄 앞 들여쓰기·`> `
 * 접두를 건너뛰기 위해서다 — `@lezer/markdown/dist/index.js:396-402, 478-487`).
 * 이전엔 마지막 `CodeText` 만 써서 목록·인용 안에서는 마지막 줄만 보였다 (F-134 3.4).
 * 모든 `CodeText` 를 모아 줄마다 이어 붙인다. 한 `CodeText` 조각 자체에 `\n` 이 여러
 * 개 들어 있을 수도 있다(빈 줄이 이어질 때는 들여쓰기를 건널 것이 없어 조각이
 * 나뉘지 않는다) — 그래서 조각 단위가 아니라 조각을 `\n` 으로 쪼갠 것이 한 "줄" 이다.
 * 마지막이 아닌 조각의 끝에 `\n` 하나가 남아 있으면(=다음 조각으로 이어지는
 * 연결일 뿐 실제 빈 줄이 아니면) 쪼갠 결과의 마지막 빈 문자열 하나만 버린다.
 * 조각이 하나뿐(목록·인용 밖의 보통 코드블록)이면 늘 "마지막" 이라 아무것도 버리지
 * 않는다 — 끝에 진짜 빈 줄이 있으면 그대로 남는다(예전 동작과 같다).
 */
function codeWidget(state, node, blockFrom) {
  let info = ''
  const codeTexts = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeInfo') info = state.doc.sliceString(child.from, child.to)
    else if (child.name === 'CodeText') codeTexts.push(child)
  }

  const lines = []
  codeTexts.forEach((child, i) => {
    const text = state.doc.sliceString(child.from, child.to)
    const parts = text.split('\n')
    if (i < codeTexts.length - 1 && parts[parts.length - 1] === '') parts.pop()
    let offset = child.from
    for (const part of parts) {
      lines.push({ text: part, offset: offset - blockFrom })
      offset += part.length + 1 // +1 은 다음 줄과의 '\n'
    }
  })

  return new CodeWidget(info, lines)
}

/**
 * 표는 tableModel.js 가 텍스트를 직접 다시 해석하므로(lezer TableCell 노드를 쓰지
 * 않는다 — tableModel.js 상단 주석 참고), 여기서는 블록 전체 원문을 그대로 잘라
 * 새 TableWidget 에 넘기기만 한다. `node`(lezer Table 노드)는 쓰지 않지만 TARGET
 * 맵의 다른 항목(codeWidget)과 시그니처를 맞추려고 인자로 받는다.
 * @param {number} blockFrom 위젯이 치환할 범위의 시작(줄 경계로 확장한 값)
 * @param {number} blockTo 위젯이 치환할 범위의 끝(줄 경계로 확장한 값)
 */
function tableWidget(state, node, blockFrom, blockTo) {
  return new TableWidget(state.doc.sliceString(blockFrom, blockTo))
}

const TARGET = { Table: tableWidget, FencedCode: codeWidget }

// 목록·인용 안인가 (F-157 2.1 "문서 최상위"). 이미지 블록만 검사한다 — 표·코드블록은 F-106 그대로 목록·인용 안에서도 위젯이 된다
const LIST_OR_QUOTE = new Set(['Blockquote', 'BulletList', 'OrderedList', 'ListItem'])
function isInsideListOrQuote(node) {
  for (let n = node.parent; n; n = n.parent) {
    if (LIST_OR_QUOTE.has(n.name)) return true
  }
  return false
}

/**
 * 표·코드블록·이미지 블록을 위젯 decoration 으로 치환한다. DOM 없이 동작한다.
 * @param {import('@codemirror/state').EditorState} state
 * @param {boolean} [hasFocus] 편집기 포커스 (F-146 3.2). 포커스가 없으면 겹침(커서가
 *   원문 안)을 무시하고 항상 위젯(접힌 프리뷰)으로 본다 — "코드블록·표 원문 펼침"도
 *   비포커스 표시에서 숨기는 예로 든 것과 같다. 기본값 true 는 포커스를 다루지 않는
 *   기존 호출부(테스트 등)의 동작을 그대로 유지한다
 * @param {(id:string)=>Promise<{blob:Blob,width:number,height:number}|null>} [resolveAttachment]
 *   이미지 블록 위젯이 첨부를 읽는 콜백 (F-157 2.2)
 * @returns {import('@codemirror/state').Range<import('@codemirror/view').Decoration>[]}
 */
export function buildBlocks(state, hasFocus = true, resolveAttachment) {
  const out = []
  syntaxTree(state).iterate({
    enter: (node) => {
      // 이미지 블록 (F-157 2.1) — HTMLBlock 은 TARGET 에 없어 parseImageBlock 이 실패하거나 목록·인용 안이면 원문 그대로 둔다
      if (node.name === 'HTMLBlock') {
        if (isInsideListOrQuote(node.node)) return
        const from = state.doc.lineAt(node.from).from
        const to = state.doc.lineAt(node.to).to
        const parsed = parseImageBlock(state.doc.sliceString(from, to))
        if (!parsed) return
        const showsSource = hasFocus && overlaps(state, from, to)
        if (!showsSource) {
          out.push(
            Decoration.replace({ widget: new ImageWidget(parsed, resolveAttachment), block: true }).range(from, to),
          )
        }
        return false
      }

      const make = TARGET[node.name]
      if (!make) return

      // block decoration 은 줄 경계에 놓여야 한다. 표·코드블록은 이미 줄 단위지만
      // 파서가 주는 범위를 그대로 믿지 않고 줄로 확장한다.
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to

      // 표는 커서·선택이 걸쳐 있어도 항상 위젯이다(F-125 2.1) — 칸 편집은 위젯
      // 안 하위 에디터로 하므로 원문을 노출할 필요가 없다(코드블록은 그대로
      // "겹치면 원문" 규칙을 유지한다).
      // 예외(F-139 3.1): 주 에디터의 빈 커서가 표 원문 범위 안이면 위젯으로 만들지
      // 않는다 — emptyCursorInside 가 참이면 overlaps 도 항상 참이라(같은 조건이라
      // 부분집합) 아래 `!overlaps` 분기로 자연히 원문이 노출된다.
      // 포커스가 없으면(F-146 3.2) 이 예외를 적용하지 않는다 — 항상 위젯이다
      const alwaysWidget = node.name === 'Table' && (!hasFocus || !emptyCursorInside(state, from, to))
      const showsSource = hasFocus && overlaps(state, from, to)
      if (alwaysWidget || !showsSource) {
        out.push(Decoration.replace({ widget: make(state, node.node, from, to), block: true }).range(from, to))
      }
      // 어느 쪽이든 블록 내부는 더 볼 것이 없다. 표 안 인라인·코드블록 강조는 하지 않는다.
      return false
    },
  })
  return out
}

/** pos 를 포함하는 Table 노드(있으면)를 찾는다. 표는 항상 위젯이라(F-125 2.1) 그
 * 줄에 커서가 닿아도 화면엔 원문이 보이지 않는다 — 원문 자리로 커서를 두는 대신
 * 칸 편집을 시작해야 한다(2.3) */
function findTableAt(state, pos) {
  let found = null
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === 'Table') found = node.node
    },
  })
  return found
}

/**
 * 방향키가 블록 위젯을 통째로 건너뛰는 것을 막는다 (F-106 2.2).
 *
 * `Decoration.replace({ block: true })` 자체가 `view.moveVertically` 로 하여금
 * 블록 위젯을 하나의 시각적 줄로 보고 그 너머로 커서를 보내게 만든다
 * (spike 178~187행, verify.md 4장 C4). `atomicRanges` 는 쓰지 않는다 — 쓰면
 * 방향키로 블록에 들어가는 길 자체가 막힌다.
 *
 * 판정은 **논리 줄 번호** 차이다: 이동 결과가 두 줄 이상 뛰면 바로 옆 줄로 돌려보낸다.
 * 그 줄이 블록 범위 안이라 겹침 판정에 걸려 블록이 열리고, 다음 방향키부터는
 * 기본 동작이 정상적으로 한 줄씩 움직인다.
 *
 * lineWrapping 을 켜서 한 논리 줄이 여러 시각 줄이 되어도, 같은 줄 안 이동(차이 0)과
 * 옆 줄 이동(차이 1)에는 이 판정이 개입하지 않는다 — "두 줄 이상 뛰는" 경우만
 * 블록을 건너뛴 것이므로 판정이 깨지지 않는다 (F-106 2.2. 실측: 3장 A3).
 *
 * 표는 그 자체가 항상 위젯이라(F-125 2.1) 옆 줄로 돌려보내는 대신 칸 편집을
 * 시작한다(2.3) — findTableAt·enterTableFromKeyboard 참고.
 *
 * @param {boolean} down 아래로 이동이면 true
 */
function stepIntoBlock(down) {
  return (view) => {
    const { state } = view
    const main = state.selection.main
    // 선택 영역이 있으면 개입하지 않는다 — Shift+방향키를 망가뜨리지 않기 위해서다.
    if (!main.empty) return false

    const cur = state.doc.lineAt(main.head).number
    const landing = state.doc.lineAt(view.moveVertically(main, down).head).number
    if (Math.abs(landing - cur) <= 1) return false

    const target = down ? cur + 1 : cur - 1
    if (target < 1 || target > state.doc.lines) return false
    const targetPos = state.doc.line(target).from

    // 표로 들어가는 경우: 아래 화살표는 머리 행 첫 칸, 위 화살표는 마지막 행
    // 첫 칸에서 편집을 시작한다(F-125 2.3) — enterTableFromKeyboard 의 fromAbove 는
    // "위에서 내려오며 들어왔다(=아래로 이동해 들어왔다)"는 뜻이라 down 과 같다.
    const tableNode = findTableAt(state, targetPos)
    if (tableNode) {
      const tableFrom = state.doc.lineAt(tableNode.from).from
      if (enterTableFromKeyboard(view, tableFrom, down)) return true
    }

    view.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: true,
    })
    return true
  }
}

// createEditor 가 defaultKeymap 을 먼저 조립하므로(F-109 shortcutKeymap 도 Prec.high 다)
// Prec.highest 로 두어야 ArrowDown/ArrowUp 을 먼저 받는다.
const blockKeymap = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: stepIntoBlock(true) },
    { key: 'ArrowUp', run: stepIntoBlock(false) },
  ]),
)

/**
 * 표·코드블록 위젯 확장.
 *
 * StateField 는 view 를 인자로 받지 못해 `view.composing` 을 직접 볼 수 없다.
 * 그래서 위젯 없는 ViewPlugin(tracker)으로 view 참조만 잡아 StateField.update 의
 * 클로저에서 읽는다. tracker 는 view 생성 이후에나 존재하므로, 최초 빌드(create)
 * 시점엔 항상 composing 이 아니라고 본다 — 문서가 없던 시점엔 조합 중일 수 없어 안전하다.
 *
 * IME 규칙(F-106 2.1)은 F-104 2.3 과 같다: 조합 종료 신호(forceRecalc)는 무조건
 * 재계산, 아니면 문서·선택 변화가 없으면 건너뛰고, 조합 중이면 건너뛰되 문서가
 * 바뀌었으면 `value.map(tr.changes)` 로 위치만 따라간다.
 *
 * 표 칸 조합(F-125 2.2)은 주 view 가 아니라 칸의 하위 EditorView 자기 DOM 에서
 * 일어난다 — 주 view 의 `composing` 은 그동안 계속 false 라 `isComposing(view)` 만으로는
 * 못 잡는다. `isCellComposing` 으로 "지금 편집 중인 칸이 조합 중인가" 도 같이 본다.
 * 이걸 안 보면 조합 중 표 재계산이 그대로 일어나 편집 중인 하위 EditorView 의 DOM 을
 * 파괴해 조합이 깨진다(updateDOM 의 "구조 바뀜" 분기 → endEdit → cellView.destroy()).
 * @param {{resolveAttachment?: (id:string)=>Promise<{blob:Blob,width:number,height:number}|null>}} [options]
 *   resolveAttachment 는 이미지 블록 위젯이 첨부를 읽는 콜백 (F-157 2.2)
 */
export function blockPreview({ resolveAttachment } = {}) {
  const viewRef = { current: null }
  const tracker = ViewPlugin.fromClass(
    class {
      constructor(view) {
        viewRef.current = view
      }
      // 에디터 destroy 때 이미지 블록 위젯이 만든 blob URL 을 모두 해제한다 (F-157 2.2)
      destroy() {
        destroyImageCache(viewRef.current)
      }
    },
  )

  const field = StateField.define({
    // EditorState.create 시점엔 view 가 없어 포커스를 알 수 없다 — false 가 맞다(autoFocus 의 focus() 가 곧 focusin·forceRecalc 로 다시 그린다, F-146 3.2)
    create: (state) => Decoration.set(buildBlocks(state, false, resolveAttachment), true),
    update(value, tr) {
      // F-135 3.2: 편집 중인 칸이 있으면 모든 주 문서 트랜잭션마다(칸 자신의 입력
      // 포함) 세션이 든 칸 범위를 옮긴다. 이 재계산 함수 자체와 무관하게, 아래에서
      // 조합 중이라 위젯을 다시 그리지 않고 건너뛰는 경우에도 범위는 계속 옮겨야 한다
      if (tr.docChanged) trackActiveEditRange(viewRef.current, tr)
      // F-138 3.5: endEdit 이 뷰 갱신 도중 미뤄둔 쓰기(마이크로태스크로 dispatch 대기 중)도
      // 같은 이유로 모든 트랜잭션마다 범위를 옮긴다
      if (tr.docChanged) trackPendingWrites(viewRef.current, tr)
      if (!isForced(tr)) {
        // F-134 3.8: 배경 구문 분석이 끝나 트리만 바뀐 갱신도 재계산 조건에 넣는다.
        // 안 넣으면 긴 문서 뒷부분(첫 파싱이 못 미친 곳)의 위젯이 다음 문서·선택
        // 변화가 올 때까지 늦게 생긴다
        const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
        if (!tr.docChanged && !tr.selection && !treeChanged) return value
        if (isComposing(viewRef.current) || isCellComposing(viewRef.current)) {
          return tr.docChanged ? value.map(tr.changes) : value
        }
      }
      return Decoration.set(buildBlocks(tr.state, isEditorFocused(viewRef.current), resolveAttachment), true)
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  return [blockKeymap, tracker, field]
}
