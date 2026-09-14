// 편집 모드 프론트매터 위젯 — 표 DOM (specs/features/F-155.md 2.1). 자리·원자 범위·커서 보정은 editor/frontmatter.js 가 맡는다
import { WidgetType } from '@codemirror/view'

// props 가 배열이면 그 내용으로, null(해석 불가)이면 원문(content)으로 동일성을 가른다
function widgetKey(content, props) {
  return props === null ? `raw:${content}` : `props:${JSON.stringify(props)}`
}

export class FrontmatterWidget extends WidgetType {
  // content: 프론트매터 내용(여는·닫는 --- 제외) 원문. props: parseSimpleProperties 결과(null 이면 해석 불가)
  constructor(content, props) {
    super()
    this.content = content
    this.props = props
    this.key = widgetKey(content, props)
  }

  eq(other) {
    return other.key === this.key
  }

  toDOM(view) {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-frontmatter-widget'
    wrap.setAttribute('aria-label', '문서 속성')

    const hint = document.createElement('span')
    hint.className = 'md-frontmatter-widget-hint'
    hint.textContent = '원문 모드에서 편집'
    wrap.appendChild(hint)

    wrap.appendChild(this.props === null ? this.renderRaw() : this.renderTable())

    // 클릭은 커서 보정 외 동작 없음(F-155 2.2) — frontmatter.js 의 transactionFilter 가 바로잡는다
    wrap.addEventListener('mousedown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: view.posAtDOM(wrap) } })
      view.focus()
    })

    return wrap
  }

  renderRaw() {
    const pre = document.createElement('pre')
    pre.className = 'markdown-frontmatter-raw'
    const code = document.createElement('code')
    code.textContent = this.content
    pre.appendChild(code)
    return pre
  }

  renderTable() {
    const table = document.createElement('table')
    table.className = 'markdown-frontmatter'
    const tbody = document.createElement('tbody')
    for (const { key, value } of this.props) {
      const row = document.createElement('tr')
      const th = document.createElement('th')
      th.textContent = key
      const td = document.createElement('td')
      td.textContent = Array.isArray(value) ? value.join(', ') : value
      row.appendChild(th)
      row.appendChild(td)
      tbody.appendChild(row)
    }
    table.appendChild(tbody)
    return table
  }

  ignoreEvent() {
    return true
  }
}
