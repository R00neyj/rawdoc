// Outline.jsx 좌표 계산 순수 함수 — 컴포넌트 파일은 react-refresh 규칙상 비-컴포넌트 export 불가 (F-144.md 3.3)
import type { EditorView } from '@codemirror/view'

const CURRENT_OFFSET = 24 // 3.3 "스크롤 영역 위 끝 + 24px 보다 위에 있는 제목 중 마지막"

type RectSource = { getBoundingClientRect(): { top: number } }
type Scroller = RectSource & { scrollTop: number }

export function lineOf(handle: { view: EditorView }, pos: number): number {
  return handle.view.state.doc.lineAt(Math.min(pos, handle.view.state.doc.length)).number
}

// h1~h3 로 좁힌다 — F-295 가 최상위 블록마다 data-source-line 을 붙이면서 같은 줄을 가리키는 요소가 늘 수 있다 (F-144.md 3.4, F-295.md 9.4)
export function findViewerHeadingEl(
  container: Element | null | undefined,
  handle: { view: EditorView },
  from: number,
): Element | null {
  if (!container) return null
  const n = lineOf(handle, from)
  return container.querySelector(`h1[data-source-line="${n}"], h2[data-source-line="${n}"], h3[data-source-line="${n}"]`)
}

// offsetTop 은 offsetParent(.content-area) 기준이라 쓰지 않음
export function topInScroller(el: RectSource, container: Scroller): number {
  return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
}

// tops 는 문서 순서 오름차순. 해당 제목이 없으면 0(첫 제목)
export function computeCurrentIndex(scrollTop: number, tops: number[]): number {
  let idx = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] < scrollTop + CURRENT_OFFSET) idx = i
    else break
  }
  return idx
}
