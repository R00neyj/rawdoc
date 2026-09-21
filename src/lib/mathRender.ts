// 수식 렌더링 공용 로직 (specs/features/F-291.md 6장) — 편집·보기 모드가 같은 모듈을 쓴다. KaTeX 는 동기 렌더라 mermaidRender.ts 와 달리 Promise 를 쓰지 않는다
import katex from 'katex'

// 앱 화면용 KaTeX CSS(7.3). document 없으면(SSR — site/build.ts 가 renderMarkdown.ts 를 통해 이 모듈을 불러온다) 건너뛴다 — 정적 import 로 두면 sitePlugin 의 SSR 모듈 그래프가 이 css 를 물어 빌드가 깨진다(2026-09-21 실측)
if (typeof document !== 'undefined') {
  void import('katex/dist/katex.min.css')
}

const DEFAULT_ERROR = '수식을 그릴 수 없습니다'

export type MathResult = { html: string } | { error: string }

// tex: 수식 원문($…$·$$…$$ 안쪽). display: 블록(true)·인라인(false, 기본값). 성공하면 {html}, 실패하면 {error}(6.3)
export function renderMath(tex: string, options?: { display?: boolean }): MathResult {
  try {
    const html = katex.renderToString(tex, {
      throwOnError: true,
      displayMode: options?.display ?? false,
      trust: false,
      maxSize: 100,
    })
    return { html }
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : DEFAULT_ERROR
    return { error: message }
  }
}

// KaTeX 웹폰트가 늦게 도착하면 위젯 폭이 나중에 바뀐다(4.3 C5) — 뷰당 한 번만 폰트 도착 후 다시 재도록 건다
const measuredViews = new WeakSet<object>()

export function requestRemeasureOnFontsReady(view: object, requestMeasure: () => void): void {
  if (measuredViews.has(view)) return
  measuredViews.add(view)
  void document.fonts?.ready?.then(() => requestMeasure())
}
