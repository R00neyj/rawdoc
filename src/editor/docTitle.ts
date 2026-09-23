// 본문 맨 위 제목 block widget — 문서 위치 0 에 원문을 건드리지 않는 decoration 으로 얹는다 (specs/features/F-217.md 2장)
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { Extension } from '@codemirror/state'

import { observeHeight, stopObservingHeight } from './preview/blocks'

export type OnTitleChange = (value: string) => void
export type OnTitleCommit = () => void
export type Breadcrumb = { id: string; name: string }[]
export type OnNavigateFolder = (id: string) => void

export const setTitleEffect = StateEffect.define<string>()
export const setTitleReadOnlyEffect = StateEffect.define<boolean>()
// 폴더 경로 + 이동 콜백을 함께 갱신한다 — 새 문서(포커스 없음) 흐름 밖에서만 바뀐다 (F-234.md 3.3)
export const setBreadcrumbEffect = StateEffect.define<{ breadcrumb: Breadcrumb; onNavigateFolder: OnNavigateFolder }>()

const PLACEHOLDER = '제목 없는 문서'
const NO_NAVIGATE: OnNavigateFolder = () => {}

function breadcrumbEqual(a: Breadcrumb, b: Breadcrumb): boolean {
  if (a.length !== b.length) return false
  return a.every((entry, i) => entry.id === b[i].id && entry.name === b[i].name)
}

// updateDOM 이 재사용 가능한 DOM 인지 판정하는 값 — id·이름이 하나라도 다르면 다시 그린다(폴더 이름 변경 포함)
function breadcrumbKey(breadcrumb: Breadcrumb): string {
  return breadcrumb.map((entry) => `${entry.id}:${entry.name}`).join('/')
}

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
    readonly breadcrumb: Breadcrumb,
    private readonly onChange: OnTitleChange,
    private readonly onCommit: OnTitleCommit,
    private readonly onNavigateFolder: OnNavigateFolder,
  ) {
    super()
  }

  eq(other: TitleWidget): boolean {
    return other.title === this.title && other.readOnly === this.readOnly && breadcrumbEqual(other.breadcrumb, this.breadcrumb)
  }

  // 폴더 안이면 경로(F-234 3.3), 밖이면 줄 번호 칸이 켜져 있을 때만 보이는 "제목" 표시 (F-217.md 2.3-1)
  private buildLabel(): HTMLElement {
    const label = document.createElement('span')
    label.className = 'doc-title-label'
    if (this.breadcrumb.length > 0) {
      this.breadcrumb.forEach((entry, i) => {
        if (i > 0) {
          const sep = document.createElement('span')
          sep.className = 'doc-title-crumb-sep'
          sep.setAttribute('aria-hidden', 'true')
          sep.textContent = ' / '
          label.appendChild(sep)
        }
        const crumb = document.createElement('button')
        crumb.type = 'button'
        crumb.className = 'doc-title-crumb'
        crumb.setAttribute('aria-label', `${entry.name} 폴더로 이동`)
        crumb.textContent = entry.name
        crumb.addEventListener('click', () => this.onNavigateFolder(entry.id))
        label.appendChild(crumb)
      })
    } else {
      label.setAttribute('aria-hidden', 'true')
      label.textContent = '제목'
    }
    return label
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-block doc-title-block'
    wrap.dataset.breadcrumbKey = breadcrumbKey(this.breadcrumb)

    wrap.appendChild(this.buildLabel())

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

    // 호버·포커스 시 뜨는 툴팁 — 앱 공통 아이콘 툴팁과 같은 모양(F-149·F-228, F-217.md 2.3-1)
    const tooltip = document.createElement('span')
    tooltip.className = 'icon-tooltip doc-title-tooltip'
    tooltip.setAttribute('aria-hidden', 'true')
    tooltip.textContent = '문서 제목'
    wrap.appendChild(tooltip)

    requestAnimationFrame(() => resizeToContent(textarea))
    // textarea 가 늘어나 위젯 높이가 바뀌면 CM6 에 알려 그 아래 줄 클릭 위치가 어긋나지 않게 한다 (F-134 3.6 과 같은 이유)
    observeHeight(wrap, view)
    return wrap
  }

  destroy(dom: HTMLElement): void {
    stopObservingHeight(dom)
  }

  // 값·읽기 전용·경로가 바뀌어도 textarea 는 다시 만들지 않는다(2.2) — 새 문서를 만든 직후 경로가 뒤늦게 오면
  // textarea 를 갈아 끼우면서 막 받은 제목 포커스가 사라졌다(폴더 메뉴 새 문서, 2026-09-24). 경로 줄만 바꾼다(F-234.md 3.3)
  updateDOM(dom: HTMLElement): boolean {
    const textarea = dom.querySelector('textarea.doc-title') as HTMLTextAreaElement | null
    const label = dom.querySelector('.doc-title-label')
    if (!textarea || !label) return false
    const key = breadcrumbKey(this.breadcrumb)
    if (dom.dataset.breadcrumbKey !== key) {
      label.replaceWith(this.buildLabel())
      dom.dataset.breadcrumbKey = key
    }
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

export type TitleState = { title: string; readOnly: boolean; breadcrumb: Breadcrumb; onNavigateFolder: OnNavigateFolder }

type TitleFieldOptions = {
  title: string
  readOnly: boolean
  onChange: OnTitleChange
  onCommit: OnTitleCommit
  breadcrumb?: Breadcrumb
  onNavigateFolder?: OnNavigateFolder
}

// DOM 없이도(vitest environment: node) 값 갱신 리듀서만 검증할 수 있게 field 생성을 따로 뗐다
export function createTitleField(opts: TitleFieldOptions): StateField<TitleState> {
  return StateField.define<TitleState>({
    create: () => ({
      title: opts.title,
      readOnly: opts.readOnly,
      breadcrumb: opts.breadcrumb ?? [],
      onNavigateFolder: opts.onNavigateFolder ?? NO_NAVIGATE,
    }),
    update(value, tr) {
      let next = value
      for (const effect of tr.effects) {
        if (effect.is(setTitleEffect)) next = { ...next, title: effect.value }
        if (effect.is(setTitleReadOnlyEffect)) next = { ...next, readOnly: effect.value }
        if (effect.is(setBreadcrumbEffect)) {
          next = { ...next, breadcrumb: effect.value.breadcrumb, onNavigateFolder: effect.value.onNavigateFolder }
        }
      }
      return next
    },
    provide: (f) =>
      EditorView.decorations.from(f, (state) =>
        Decoration.set([
          Decoration.widget({
            widget: new TitleWidget(
              state.title,
              state.readOnly,
              state.breadcrumb,
              opts.onChange,
              opts.onCommit,
              state.onNavigateFolder,
            ),
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
