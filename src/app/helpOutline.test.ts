// F-249 A1 — Outline 용 도움말 핸들: getHeadings() 가 12묶음 제목을 순서대로 낸다
import { describe, it, expect } from 'vitest'
import { helpOutlineHandle } from './helpOutline'

const GROUP_NAMES = [
  '제목',
  '강조',
  '목록',
  '인용',
  '링크',
  '위키링크',
  '표',
  '코드블록',
  '이미지',
  '콜아웃',
  '구분선',
  '프론트매터',
]

describe('helpOutlineHandle', () => {
  it('getHeadings() 가 12묶음 ## 제목을 순서대로 낸다', () => {
    const texts = helpOutlineHandle.getHeadings().map((h) => h.text)
    let cursor = -1
    for (const name of GROUP_NAMES) {
      const idx = texts.indexOf(name, cursor + 1)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }
  })

  it('onHeadingsChange 는 구독 해제 함수를 준다(고정 문서라 다시 부르지 않는다)', () => {
    const unsubscribe = helpOutlineHandle.onHeadingsChange(() => {})
    expect(typeof unsubscribe).toBe('function')
  })

  it('view.state 에 도움말 원문이 들어 있다', () => {
    expect(helpOutlineHandle.view.state.doc.toString()).toContain('## 제목')
  })
})
