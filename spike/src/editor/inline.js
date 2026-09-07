import { syntaxTree } from '@codemirror/language'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

/** 마커를 화면에서만 지운다. 문서는 바뀌지 않는다. */
const HIDE = Decoration.replace({})

/** 구문 노드 → 적용할 스타일 */
const STYLE = {
  StrongEmphasis: Decoration.mark({ class: 'md-strong' }),
  Emphasis: Decoration.mark({ class: 'md-em' }),
  InlineCode: Decoration.mark({ class: 'md-code' }),
  Link: Decoration.mark({ class: 'md-link' }),
}

/** 커서가 없는 줄에서 숨길 마커 노드 */
const MARKER = new Set(['EmphasisMark', 'CodeMark', 'LinkMark', 'URL'])

/**
 * 커서나 선택 영역이 걸친 줄 번호 집합.
 * 선택이 여러 줄에 걸치면 걸친 줄 전부를 원문으로 둔다.
 */
function activeLines(state) {
  const lines = new Set()
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

function build(view) {
  const { state } = view
  const active = activeLines(state)
  const ranges = []

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const style = STYLE[node.name]
        if (style) {
          ranges.push(style.range(node.from, node.to))
          return
        }
        if (MARKER.has(node.name) && node.to > node.from) {
          const line = state.doc.lineAt(node.from).number
          if (!active.has(line)) ranges.push(HIDE.range(node.from, node.to))
        }
      },
    })
  }

  return Decoration.set(ranges, true)
}

const theme = EditorView.baseTheme({
  '.md-strong': { fontWeight: 'bold' },
  '.md-em': { fontStyle: 'italic' },
  '.md-code': {
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    background: '#f0f0f0',
  },
  '.md-link': { color: '#0645ad', textDecoration: 'underline' },
})

/**
 * 인라인 마크다운 마커를 커서 없는 줄에서 숨기는 확장.
 *
 * @param {object} [opts]
 * @param {() => boolean} [opts.suspended]  true 를 반환하면 재계산을 건너뛴다
 * @returns {import('@codemirror/state').Extension}
 */
export function inlinePreview(opts = {}) {
  const suspended = opts.suspended || (() => false)

  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = build(view)
      }

      update(update) {
        // 재계산이 필요한 상황이 아니면 suspended 를 묻지도 않는다.
        // 그래야 로그의 recalc/skip 이 실제 판단 시점과 일치한다.
        if (!update.docChanged && !update.selectionSet && !update.viewportChanged) return
        if (suspended()) return
        this.decorations = build(update.view)
      }
    },
    { decorations: (v) => v.decorations },
  )

  return [theme, plugin]
}
