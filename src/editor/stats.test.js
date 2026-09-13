import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'

import { countChars, countWords, cursorInfo } from './stats.js'

describe('cursorInfo', () => {
  it('첫 줄 첫 칸', () => {
    const state = EditorState.create({ doc: 'abc', selection: EditorSelection.single(0) })
    expect(cursorInfo(state)).toEqual({ line: 1, col: 1 })
  })

  it('한글이 있는 줄에서 col — 코드포인트 수 + 1', () => {
    // '가나다' 3글자 뒤 = col 4
    const state = EditorState.create({ doc: '가나다라', selection: EditorSelection.single(3) })
    expect(cursorInfo(state)).toEqual({ line: 1, col: 4 })
  })

  it('이모지(서로게이트 쌍)가 있는 줄에서 col — 코드포인트 1개로 센다', () => {
    // '😀' 는 UTF-16 으로 2 코드 유닛. head 를 이모지 뒤(유닛 오프셋 2)에 두면
    // 코드포인트 기준 col 은 2 (이모지 1개 + 1) 여야 한다
    const doc = '😀나'
    const state = EditorState.create({ doc, selection: EditorSelection.single(2) })
    expect(cursorInfo(state)).toEqual({ line: 1, col: 2 })
  })

  it('둘째 줄에서 line·col', () => {
    const state = EditorState.create({ doc: 'ab\ncd', selection: EditorSelection.single(4) })
    expect(cursorInfo(state)).toEqual({ line: 2, col: 2 })
  })
})

describe('countChars', () => {
  it('빈 문자열 0', () => {
    expect(countChars('')).toBe(0)
  })

  it('\\r \\n 을 뺀 코드포인트 수. 공백 포함', () => {
    // 명세(F-113.md A1)는 이 입력의 기대값을 4 로 적었지만, 2.1 의 정의(줄바꿈만 제거,
    // 공백 포함)대로 세면 5 다 — 가·나·다·공백·라 5개. \r\n 을 빼고 남는 것은
    // '가나다 라'(공백 포함 5글자)이지 4글자가 아니다. 정의를 기준으로 구현하고
    // 최종 보고에 이 불일치를 적는다
    expect(countChars('가나\r\n다 라')).toBe(5)
  })

  it('CRLF·LF 섞여도 전부 제거', () => {
    expect(countChars('a\r\nb\nc')).toBe(3)
  })
})

describe('countWords', () => {
  it('빈 문자열 0', () => {
    expect(countWords('')).toBe(0)
  })

  it('공백류로 나눈 비어 있지 않은 덩어리 수', () => {
    expect(countWords('  a b\n\nc ')).toBe(3)
  })
})
