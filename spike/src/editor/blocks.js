import { Prec, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view'

/**
 * 커서나 선택 영역이 [from, to] 와 겹치는가.
 *
 * inline.js 의 activeLines 를 재사용하지 않는다 — 그쪽은 **줄 번호** 집합으로 판정하고
 * 여기는 **노드 범위** 겹침으로 판정한다. 판정 단위가 달라 같은 함수가 될 수 없다.
 */
function overlaps(state, from, to) {
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true
  }
  return false
}

/**
 * 위젯 DOM 에 "클릭하면 원문으로 진입" 을 붙인다.
 *
 * WidgetType.ignoreEvent 의 기본값이 "모든 이벤트 무시" 라서 이것 없이는
 * 마우스로 블록에 들어갈 수 없다 (방향키로만 가능해진다).
 * preventDefault 를 빠뜨리면 CM6 가 그 뒤에 자기 방식으로 selection 을 다시 잡아
 * 진입 위치가 어긋난다.
 *
 * 위치는 위젯이 들고 있지 않고 클릭 시점에 posAtDOM 으로 역산한다 —
 * eq() 가 true 면 CM6 가 옛 위젯 인스턴스를 그대로 두므로 저장해 둔 위치는 낡을 수 있다.
 */
function enterOnClick(dom, view) {
  dom.addEventListener('mousedown', (event) => {
    event.preventDefault()
    view.dispatch({ selection: { anchor: view.posAtDOM(dom) } })
    view.focus()
  })
}

/** 펜스 코드블록. 구문 강조는 하지 않는다 (계획 7장) */
class CodeWidget extends WidgetType {
  constructor(info, code) {
    super()
    this.info = info
    this.code = code
  }

  // 비교 기준은 원문뿐이다. 위치를 넣으면 블록 앞에서 한 글자만 쳐도 전부 새로 그려진다.
  eq(other) {
    return other.info === this.info && other.code === this.code
  }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-codeblock'
    if (this.info) {
      const lang = document.createElement('span')
      lang.className = 'md-codeblock-lang'
      lang.textContent = this.info
      wrap.appendChild(lang)
    }
    const pre = document.createElement('pre')
    pre.textContent = this.code
    wrap.appendChild(pre)
    enterOnClick(wrap, view)
    return wrap
  }
}

/** GFM 표. 셀 내용은 원문 문자열 그대로 넣는다 — 셀 안의 인라인 프리뷰는 하지 않는다 */
class TableWidget extends WidgetType {
  constructor(rows) {
    super()
    this.rows = rows
    this.key = JSON.stringify(rows)
  }

  eq(other) {
    return other.key === this.key
  }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-table'
    const table = document.createElement('table')
    for (const row of this.rows) {
      const tr = document.createElement('tr')
      for (const cell of row.cells) {
        const td = document.createElement(row.header ? 'th' : 'td')
        td.textContent = cell
        tr.appendChild(td)
      }
      table.appendChild(tr)
    }
    wrap.appendChild(table)
    enterOnClick(wrap, view)
    return wrap
  }
}

function codeWidget(state, node) {
  let info = ''
  let code = ''
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeInfo') info = state.doc.sliceString(child.from, child.to)
    else if (child.name === 'CodeText') code = state.doc.sliceString(child.from, child.to)
  }
  return new CodeWidget(info, code)
}

function tableWidget(state, node) {
  const rows = []
  for (let row = node.firstChild; row; row = row.nextSibling) {
    if (row.name !== 'TableHeader' && row.name !== 'TableRow') continue
    const cells = []
    for (let cell = row.firstChild; cell; cell = cell.nextSibling) {
      // 빈 셀은 from === to 라 sliceString 이 '' 를 준다. 그대로 넣는다.
      if (cell.name === 'TableCell') cells.push(state.doc.sliceString(cell.from, cell.to))
    }
    rows.push({ header: row.name === 'TableHeader', cells })
  }
  return new TableWidget(rows)
}

const TARGET = { Table: tableWidget, FencedCode: codeWidget }

function build(state) {
  const ranges = []
  syntaxTree(state).iterate({
    enter: (node) => {
      const make = TARGET[node.name]
      if (!make) return
      // block decoration 은 줄 경계에 놓여야 한다. 표·코드블록은 이미 줄 단위지만
      // 파서가 주는 범위를 그대로 믿지 않고 줄로 확장한다.
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      // 커서가 걸쳐 있으면 위젯을 씌우지 않는다 = 원문이 그대로 보인다.
      if (!overlaps(state, from, to)) {
        ranges.push(Decoration.replace({ widget: make(state, node.node), block: true }).range(from, to))
      }
      // 어느 쪽이든 블록 내부는 더 볼 것이 없다.
      return false
    },
  })
  return Decoration.set(ranges, true)
}

const theme = EditorView.baseTheme({
  '.md-block': {
    border: '1px solid #d0d7de',
    borderRadius: '4px',
    margin: '0.25rem 0',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  '.md-codeblock-lang': {
    display: 'block',
    padding: '0.15rem 0.5rem',
    fontSize: '0.75em',
    color: '#57606a',
    background: '#f6f8fa',
    borderBottom: '1px solid #d0d7de',
  },
  '.md-codeblock pre': {
    margin: 0,
    padding: '0.5rem',
    background: '#f6f8fa',
    overflowX: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  '.md-table table': { borderCollapse: 'collapse', width: '100%' },
  '.md-table th, .md-table td': {
    border: '1px solid #d0d7de',
    padding: '0.25rem 0.5rem',
    textAlign: 'left',
  },
  '.md-table th': { background: '#f6f8fa' },
})

/**
 * 방향키가 블록 위젯을 통째로 건너뛰는 것을 막는다.
 *
 * `atomicRanges` 를 안 쓰면 커서가 블록에 들어갈 줄 알았으나 아니었다 —
 * `Decoration.replace({ block: true })` 자체가 진입을 막는다.
 * `view.moveVertically` 가 블록 위젯을 **하나의 시각적 줄**로 보고 그 너머로 보낸다.
 * 실측(2026-09-08): 8줄에서 ↓ 를 누르면 코드블록 9~12 를 건너뛰고 13줄로 갔다.
 *
 * 그래서 이동 결과가 두 줄 이상 뛰면 바로 옆 줄로 돌려보낸다.
 * 그 줄이 블록 범위 안이라 겹침 판정에 걸려 블록이 열리고,
 * 그 다음 방향키부터는 기본 동작이 정상적으로 한 줄씩 움직인다.
 *
 * 전제: 줄바꿈(EditorView.lineWrapping)을 켜지 않는다. 켜면 한 논리적 줄이
 * 여러 시각 줄이 되어 "두 줄 이상" 판정이 무너진다.
 *
 * @param {boolean} down  아래로 이동이면 true
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

    view.dispatch({
      selection: { anchor: state.doc.line(target).from },
      scrollIntoView: true,
    })
    return true
  }
}

// Prec.highest 가 필요하다. createEditor 가 defaultKeymap 을 먼저 조립하므로
// 그냥 두면 defaultKeymap 의 ArrowDown/ArrowUp 이 먼저 이벤트를 먹는다.
const blockKeymap = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: stepIntoBlock(true) },
    { key: 'ArrowUp', run: stepIntoBlock(false) },
  ]),
)

/**
 * 표·코드블록을 위젯으로 치환하는 확장.
 * 커서나 선택이 블록 범위와 겹치면 그 블록만 원문으로 둔다 (자동 해제).
 *
 * ViewPlugin 이 아니라 StateField 를 쓴다 — CM6 가 블록 decoration 을
 * 플러그인으로 제공하는 것을 거부하기 때문이다
 * ("Block decorations may not be specified via plugins").
 * 그 결과 visibleRanges 로 범위를 좁히지 못하고 문서 전체를 순회한다.
 *
 * atomicRanges 는 쓰지 않는다. 쓰면 방향키가 블록을 건너뛰어 진입 자체가 막힌다.
 *
 * @param {object} [opts]
 * @param {() => boolean} [opts.suspended]  true 를 반환하면 재계산을 건너뛴다
 * @param {import('@codemirror/state').StateEffectType<null>} [opts.forceRecalc]
 *        이 effect 가 실린 트랜잭션에서는 보류와 갱신 조건을 모두 무시하고 재계산한다
 * @returns {import('@codemirror/state').Extension}
 */
export function blockPreview(opts = {}) {
  const suspended = opts.suspended || (() => false)
  const forceRecalc = opts.forceRecalc

  const field = StateField.define({
    create: (state) => build(state),
    update(value, tr) {
      // 조합 종료 신호는 아래 두 조기 반환을 모두 건너뛴다 (결함 A).
      // compositionend 자체는 문서도 선택도 바꾸지 않으므로 첫 줄에 걸린다.
      const forced = !!forceRecalc && tr.effects.some((e) => e.is(forceRecalc))
      if (!forced) {
        if (!tr.docChanged && !tr.selection) return value
        // 보류 중에는 다시 만들지 않되, 문서가 바뀌었으면 위치는 따라가야 한다.
        if (suspended()) return tr.docChanged ? value.map(tr.changes) : value
      }
      return build(tr.state)
    },
    provide: (f) => EditorView.decorations.from(f),
  })

  return [theme, blockKeymap, field]
}
