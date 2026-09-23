// 편집 모드 블록 수식 위젯 $$…$$ (specs/features/F-291.md 4.2) — mermaidWidget.ts 와 같은 모양이되 KaTeX 는 동기라 비동기 대기가 없다
import { EditorView, WidgetType } from '@codemirror/view'

import { renderMath, requestRemeasureOnFontsReady } from '../../lib/mathRender'
import { enterOnClick, observeHeight, stopObservingHeight } from './blocks'

// eq() 비교 키는 TeX 원문 하나다(mermaidWidget.ts 44행과 같은 판단) — 위치는 넣지 않는다
export class MathBlockWidget extends WidgetType {
  tex: string

  constructor(tex: string) {
    super()
    this.tex = tex
  }

  eq(other: MathBlockWidget): boolean {
    return other.tex === this.tex
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-math'

    const result = renderMath(this.tex, { display: true })
    if ('html' in result) {
      wrap.innerHTML = result.html
    } else {
      wrap.className = 'md-block'
      const errorEl = document.createElement('div')
      errorEl.className = 'md-math-error'
      errorEl.textContent = result.error
      wrap.appendChild(errorEl)
    }

    // KaTeX 웹폰트가 늦게 도착하면 위젯 폭이 나중에 바뀐다(4.3 C5)
    requestRemeasureOnFontsReady(view, () => view.requestMeasure())
    observeHeight(wrap, view)
    enterOnClick(wrap, view)
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(dom: HTMLElement): void {
    stopObservingHeight(dom)
  }
}
