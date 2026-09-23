// 좌표 계산 순수 함수 (specs/features/F-144.md 3.3 — 메인 검토 A4·A5 좌표 버그 수정)
import { describe, expect, it } from 'vitest'
import { computeCurrentIndex, findViewerHeadingElByLine, topInScroller } from './outlinePosition'

describe('computeCurrentIndex — 현재 위치 (F-144.md 3.3)', () => {
  it('스크롤 위 끝 + 24px 보다 위에 있는 제목 중 마지막을 고른다', () => {
    const tops = [0, 100, 200, 300]
    expect(computeCurrentIndex(0, tops)).toBe(0)
    expect(computeCurrentIndex(90, tops)).toBe(1) // 90+24=114 > 100
    expect(computeCurrentIndex(190, tops)).toBe(2)
    expect(computeCurrentIndex(1000, tops)).toBe(3)
  })

  it('없으면(맨 위) 첫 제목', () => {
    expect(computeCurrentIndex(0, [50, 150])).toBe(0)
  })
})

describe('topInScroller — offsetTop 대신 getBoundingClientRect 차이 (메인 검토 버그 2)', () => {
  it('요소·컨테이너 rect 차이에 컨테이너 scrollTop 을 더한다', () => {
    const el = { getBoundingClientRect: () => ({ top: 250 }) }
    const container = { getBoundingClientRect: () => ({ top: 50 }), scrollTop: 400 }
    // 화면상 el 이 container 보다 200px 아래. container 는 이미 400px 스크롤된 상태이므로
    // 스크롤 좌표계에서 el 의 top 은 200 + 400 = 600
    expect(topInScroller(el, container)).toBe(600)
  })

  it('컨테이너가 스크롤되지 않았으면 화면 좌표 차이 그대로', () => {
    const el = { getBoundingClientRect: () => ({ top: 120 }) }
    const container = { getBoundingClientRect: () => ({ top: 20 }), scrollTop: 0 }
    expect(topInScroller(el, container)).toBe(100)
  })
})

describe('findViewerHeadingElByLine — 줄 번호로 h1~h6 (F-2018 7.3 U21)', () => {
  it('h1~h6[data-source-line="n"] 선택자로 찾는다', () => {
    let asked = ''
    const el = { tag: 'h5' }
    const container = {
      querySelector: (selector: string) => {
        asked = selector
        return el
      },
    }
    expect(findViewerHeadingElByLine(container as unknown as Element, 12)).toBe(el)
    expect(asked).toBe(
      'h1[data-source-line="12"], h2[data-source-line="12"], h3[data-source-line="12"], h4[data-source-line="12"], h5[data-source-line="12"], h6[data-source-line="12"]',
    )
  })

  it('컨테이너가 없으면 null', () => {
    expect(findViewerHeadingElByLine(null, 3)).toBeNull()
  })
})
