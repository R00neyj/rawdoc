// 본문 맨 위 제목 block widget — 문서 위치 0 에 원문을 건드리지 않는 decoration 으로 얹는다 (specs/features/F-217.md 2장)
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

import { observeHeight, stopObservingHeight } from './preview/blocks'

export type OnTitleChange = (value: string) => void
export type OnTitleCommit = () => void

export const setTitleEffect = StateEffect.define<string>()
export const setTitleReadOnlyEffect = StateEffect.define<boolean>()

const PLACEHOLDER = '제목 없는 문서'

// 커서가 textarea 의 시각적 마지막 줄에 있는지 — 숨은 거울 요소로 줄바꿈 위치를 잰다
function caretOnLastVisualLine(textarea: HTMLTextAreaElement): boolean {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const props: (keyof CSSStyleDeclaration)[] = [
    'boxSizing',
    'width',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'letterSpacing',
    'lineHeight',
  ]
  for (const prop of props) {
    // CSSStyleDeclaration 인덱스 접근은 string 값이지만 타입은 모든 속성을 허용하지 않아 단언한다
    ;(mirror.style as unknown as Record<string, string>)[prop as string] = style[prop] as string
  }
  mirror.style.position = 'fixed'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'keep-all'
  mirror.style.height = 'auto'
  mirror.style.top = '-9999px'
  document.body.appendChild(mirror)

  const caret = textarea.selectionStart
  mirror.textContent = textarea.value.slice(0, caret)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(caret) || '.'
  mirror.appendChild(marker)
  const markerTop = marker.offsetTop
  const fullHeight = mirror.offsetHeight
  const lineHeight = parseFloat(style.lineHeight) || markerTop || 1
  document.body.removeChild(mirror)

  return markerTop + lineHeight >= fullHeight - 1
}

function resizeToContent(textarea: HTMLTextAreaElement): void {
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

// 본문 맨 앞으로 포커스 (2.3, ia.md 6장 Enter 행)
function focusBodyStart(view: EditorView): void {
  view.dispatch({ selection: { anchor: 0, head: 0 } })
  view.focus()
}

class TitleWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly readOnly: boolean,
    private readonly onChange: OnTitleChange,
    private readonly onCommit: OnTitleCommit,
  ) {
    super()
  }

  eq(other: TitleWidget): boolean {
    return other.title === this.title && other.readOnly === this.readOnly
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-block doc-title-block'

    const textarea = document.createElement('textarea')
    textarea.className = 'doc-title'
    textarea.setAttribute('aria-label', '문서 제목')
    textarea.rows = 1
    textarea.value = this.title
    textarea.placeholder = this.readOnly ? '' : PLACEHOLDER
    textarea.readOnly = this.readOnly

    textarea.addEventListener('input', () => {
      // 붙여넣기의 줄바꿈은 공백 1개로 (2.2) — 키다운에서 막는 Enter 와 달리 붙여넣기는 input 에서만 잡힌다
      if (textarea.value.includes('\n')) {
        const pos = textarea.selectionStart
        textarea.value = textarea.value.replace(/\n/g, ' ')
        textarea.selectionStart = textarea.selectionEnd = pos
      }
      resizeToContent(textarea)
      this.onChange(textarea.value)
    })

    textarea.addEventListener('blur', () => this.onCommit())

    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        focusBodyStart(view)
        return
      }
      if (event.key === 'ArrowDown' && caretOnLastVisualLine(textarea)) {
        event.preventDefault()
        focusBodyStart(view)
      }
    })

    wrap.appendChild(textarea)
    requestAnimationFrame(() => resizeToContent(textarea))
    // textarea 가 늘어나 위젯 높이가 바뀌면 CM6 에 알려 그 아래 줄 클릭 위치가 어긋나지 않게 한다 (F-134 3.6 과 같은 이유)
    observeHeight(wrap, view)
    return wrap
  }

  destroy(dom: HTMLElement): void {
    stopObservingHeight(dom)
  }

  // 값·읽기 전용이 바뀌어도 DOM 을 다시 만들지 않는다 — 포커스·커서·IME 조합 유지 (2.2)
  updateDOM(dom: HTMLElement): boolean {
    const textarea = dom.querySelector('textarea.doc-title') as HTMLTextAreaElement | null
    if (!textarea) return false
    textarea.readOnly = this.readOnly
    textarea.placeholder = this.readOnly ? '' : PLACEHOLDER
    // 포커스가 없을 때만 값을 바꾼다 — 포커스 중엔 사용자가 입력한 값이 곧 최신 값이다 (2.2)
    if (document.activeElement !== textarea && textarea.value !== this.title) {
      textarea.value = this.title
      resizeToContent(textarea)
    }
    return true
  }

  ignoreEvent(): boolean {
    return true
  }
}

export type TitleState = { title: string; readOnly: boolean }

type TitleFieldOptions = {
  title: string
  readOnly: boolean
  onChange: OnTitleChange
  onCommit: OnTitleCommit
}

// DOM 없이도(vitest environment: node) 값 갱신 리듀서만 검증할 수 있게 field 생성을 따로 뗐다
export function createTitleField(opts: TitleFieldOptions): StateField<TitleState> {
  return StateField.define<TitleState>({
    create: () => ({ title: opts.title, readOnly: opts.readOnly }),
    update(value, tr) {
      let next = value
      for (const effect of tr.effects) {
        if (effect.is(setTitleEffect)) next = { ...next, title: effect.value }
        if (effect.is(setTitleReadOnlyEffect)) next = { ...next, readOnly: effect.value }
      }
      return next
    },
    provide: (f) =>
      EditorView.decorations.from(f, (state) =>
        Decoration.set([
          Decoration.widget({
            widget: new TitleWidget(state.title, state.readOnly, opts.onChange, opts.onCommit),
            side: -1,
            block: true,
          }).range(0),
        ]),
      ),
  })
}

// createEditor.ts 가 최초 생성 시 조립한다. 값 갱신은 setTitleEffect·setTitleReadOnlyEffect 로
export function docTitleExtension(opts: TitleFieldOptions): Extension {
  return createTitleField(opts)
}

// 본문 첫 시각 줄에서 ↑ — 제목 끝으로 포커스 (2.3)
export function focusTitleFromBody(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const headCoords = view.coordsAtPos(sel.head)
  const topCoords = view.coordsAtPos(0)
  if (!headCoords || !topCoords || Math.abs(headCoords.top - topCoords.top) > 1) return false
  focusTitleWidget(view)
  return true
}

export function focusTitleWidget(view: EditorView, selectAll = false): void {
  const textarea = view.dom.querySelector('textarea.doc-title') as HTMLTextAreaElement | null
  if (!textarea) return
  textarea.focus()
  if (selectAll) textarea.select()
  else textarea.setSelectionRange(textarea.value.length, textarea.value.length)
}
