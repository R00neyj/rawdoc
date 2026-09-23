// 편집 모드 Mermaid 다이어그램 블록 위젯 (specs/features/F-258.md 2.3, F-260.md 2.2). F-106 코드블록 패턴을 따르고, 클릭 진입은 blocks.ts 의 enterOnClick 을 그대로 쓴다
import { EditorView, WidgetType } from '@codemirror/view'

import { renderMermaid } from '../../lib/mermaidRender'
import type { MermaidResult } from '../../lib/mermaidRender'
import { enterOnClick, observeHeight, stopObservingHeight } from './blocks'

// 주 EditorView → Map<"테마:소스", Promise<결과>> (F-258 2.3, 키에 테마 포함 F-260 2.2) — 같은 소스·테마를 여러 번 렌더링하지 않는다. blocks.ts 의 tracker 가 destroy() 에서 destroyMermaidCache(view) 를 부른다
const cacheByView = new WeakMap<EditorView, Map<string, Promise<MermaidResult>>>()

function getCache(view: EditorView): Map<string, Promise<MermaidResult>> {
  let cache = cacheByView.get(view)
  if (!cache) {
    cache = new Map()
    cacheByView.set(view, cache)
  }
  return cache
}

// 에디터(view) destroy 때 부른다 — 캐시만 비운다(blob URL 이 없어 URL 해제는 불필요)
export function destroyMermaidCache(view: EditorView | null | undefined): void {
  if (!view) return
  cacheByView.delete(view)
}

function loadMermaid(view: EditorView, source: string, theme: string): Promise<MermaidResult> {
  const cache = getCache(view)
  const key = `${theme}:${source}`
  const cached = cache.get(key)
  if (cached) return cached
  const promise = renderMermaid(source, theme)
  cache.set(key, promise)
  return promise
}

// 펜스 코드블록 위젯(mermaid 정보 문자열, F-258 2.1). eq() 비교 키는 원문 소스 문자열(코드 본문)과 테마다(F-260 2.2) — 위치·정보문자열은 넣지 않는다(F-258 2.3)
export class MermaidWidget extends WidgetType {
  source: string
  theme: string

  constructor(source: string, theme: string) {
    super()
    this.source = source
    this.theme = theme
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source && other.theme === this.theme
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-mermaid'

    loadMermaid(view, this.source, this.theme).then((result) => {
      if (!wrap.isConnected) return
      if ('svg' in result) {
        wrap.innerHTML = result.svg
      } else {
        wrap.replaceChildren()
        const errorEl = document.createElement('div')
        errorEl.className = 'md-mermaid-error'
        errorEl.textContent = result.error
        wrap.appendChild(errorEl)
      }
    })

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
