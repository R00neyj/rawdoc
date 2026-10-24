// 휴대폰 폭 앱 틀을 visualViewport 에 맞춘다 — iOS 키보드 위로 줄이고 밀림을 따라간다 (F-2084 3.3)
import { useEffect } from 'react'
import { DOCK_QUERY, fitToVisualViewport } from './viewportFit'

const HEIGHT_VAR = '--vv-height'
const TOP_VAR = '--vv-top'

export function useViewportFit(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const mql = window.matchMedia(DOCK_QUERY)
    const rootStyle = document.documentElement.style
    let frame = 0

    function clear() {
      rootStyle.removeProperty(HEIGHT_VAR)
      rootStyle.removeProperty(TOP_VAR)
    }

    function apply() {
      frame = 0
      if (!mql.matches || !vv) {
        clear()
        return
      }
      const fit = fitToVisualViewport({ innerHeight: window.innerHeight, vvHeight: vv.height, vvOffsetTop: vv.offsetTop, vvScale: vv.scale })
      // 레이아웃 뷰포트와 같으면 CSS 기본값(100%)에 맡긴다 — 안드로이드 resizes-content 는 여기서 늘 무동작
      if (!fit || (fit.top === 0 && fit.height >= document.documentElement.clientHeight)) {
        clear()
        return
      }
      rootStyle.setProperty(HEIGHT_VAR, `${fit.height}px`)
      rootStyle.setProperty(TOP_VAR, `${fit.top}px`)
    }

    function schedule() {
      if (frame === 0) frame = requestAnimationFrame(apply)
    }

    schedule()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    mql.addEventListener('change', schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      mql.removeEventListener('change', schedule)
      clear()
    }
  }, [])
}
