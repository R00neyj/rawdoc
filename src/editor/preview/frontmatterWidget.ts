// 편집 모드 프론트매터 위젯 — 표 DOM (specs/features/F-155.md 2.1), 값 칸 편집 진입(F-2113 2.1·5.1). 자리·원자 범위·커서 보정은 editor/frontmatter.ts 가 맡는다
import { WidgetType } from '@codemirror/view'
import type { EditorView } from '@codemirror/view'
import type { FrontmatterProperty } from '../../lib/frontmatter'
import { observeHeight, stopObservingHeight } from './blocks'
import { endFrontmatterEdit, frontmatterEditCell, startFrontmatterEdit } from './frontmatterEdit'

type Props = FrontmatterProperty[] | null

// props 가 배열이면 그 내용으로, null(해석 불가)이면 원문(content)으로 동일성을 가른다
function widgetKey(content: string, props: Props): string {
  return props === null ? `raw:${content}` : `props:${JSON.stringify(props)}`
}

// 모양 = raw 여부 + 키 순서 + 키마다 칸 수. 같으면 칸 글자만 갈아 끼운다 (F-2113 5.1)
function shapeKey(content: string, props: Props): string {
  if (props === null) return `raw:${content}`
  return JSON.stringify(props.map(({ key, value }) => [key, Array.isArray(value) ? value.length : -1]))
}

// 편집 칸 순서 = frontmatterValueRanges 순서 = data-cell 번호 (F-2113 3.1 A2)
function cellTexts(props: Props): string[] {
  return (props ?? []).flatMap(({ value }) => (Array.isArray(value) ? value : [value]))
}

// destroy(dom) 이 view 를 못 받는 WidgetType API 한계를 메꾼다(TableWidget wrapView 와 같은 이유)
const wrapView = new WeakMap<HTMLElement, EditorView>()
const renderedShape = new WeakMap<HTMLElement, string>()

export class FrontmatterWidget extends WidgetType {
  content: string
  props: Props
  key: string

  // content: 프론트매터 내용(여는·닫는 --- 제외) 원문. props: parseSimpleProperties 결과(null 이면 해석 불가)
  constructor(content: string, props: Props) {
    super()
    this.content = content
    this.props = props
    this.key = widgetKey(content, props)
  }

  eq(other: FrontmatterWidget): boolean {
    return other.key === this.key
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-frontmatter-widget'
    wrap.setAttribute('aria-label', '문서 속성')
    wrapView.set(wrap, view)
    this.render(wrap, view)

    // 키 칸·여백 클릭은 커서 보정 외 동작 없음(F-155 2.2) — frontmatter.ts 의 transactionFilter 가 바로잡는다
    wrap.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })

    observeHeight(wrap, view)
    return wrap
  }

  render(wrap: HTMLElement, view: EditorView): void {
    wrap.textContent = ''
    wrap.appendChild(this.props === null ? this.renderRaw() : this.renderTable(wrap, view))
    renderedShape.set(wrap, shapeKey(this.content, this.props))
  }

  renderRaw(): HTMLElement {
    const pre = document.createElement('pre')
    pre.className = 'markdown-frontmatter-raw'
    const code = document.createElement('code')
    code.textContent = this.content
    pre.appendChild(code)
    return pre
  }

  renderTable(wrap: HTMLElement, view: EditorView): HTMLElement {
    const table = document.createElement('table')
    table.className = 'markdown-frontmatter'
    const tbody = document.createElement('tbody')
    let cell = 0
    for (const { key, value } of this.props ?? []) {
      const row = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = key
      const td = document.createElement('td')
      for (const text of Array.isArray(value) ? value : [value]) td.appendChild(valueCell(wrap, view, cell++, text))
      row.appendChild(th)
      row.appendChild(td)
      tbody.appendChild(row)
    }
    table.appendChild(tbody)
    return table
  }

  // 모양이 같으면 활성 칸만 빼고 글자를 갈아 끼워 하위 view 를 살린다. 다르면 세션을 끝내고 다시 그린다 (F-2113 5.1)
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    if (renderedShape.get(dom) !== shapeKey(this.content, this.props)) {
      endFrontmatterEdit(view, dom, { deferDispatch: true })
      this.render(dom, view)
      return true
    }
    const active = frontmatterEditCell(view, dom)
    cellTexts(this.props).forEach((text, i) => {
      if (i === active) return
      const el = dom.querySelector(`.md-frontmatter-value[data-cell="${i}"]`)
      if (el && el.textContent !== text) el.textContent = text
    })
    return true
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(dom: HTMLElement): void {
    stopObservingHeight(dom)
    const view = wrapView.get(dom)
    if (view) endFrontmatterEdit(view, dom, { deferDispatch: true })
  }
}

function valueCell(wrap: HTMLElement, view: EditorView, cell: number, text: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'md-frontmatter-value'
  el.dataset.cell = String(cell)
  el.textContent = text
  el.addEventListener('mousedown', (event) => {
    // 편집 중인 칸 안 클릭은 하위 view 가 처리하고, wrap 의 커서 보정으로 올라가지 않게만 한다
    if (frontmatterEditCell(view, wrap) === cell) {
      event.stopPropagation()
      return
    }
    if (event.button !== 0 || !startFrontmatterEdit(view, wrap, el, cell)) return
    event.preventDefault()
    event.stopPropagation()
  })
  return el
}
