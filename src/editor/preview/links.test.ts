// links.js 단위 테스트 (specs/features/F-129.md 4장 A1)
// findLinkAt·isOpenableUrl 은 순수 함수라 EditorState + ensureSyntaxTree 로 직접 부른다.
// 클릭 처리(linkClicks, EditorView.domEventHandlers)는 DOM 이 필요해 여기서 테스트하지
// 않는다 — vitest environment 가 'node' 라 EditorView 를 만들 수 없다(createEditor.test.js 참고).
// 브라우저 확인은 F-129 4장 A2~A6.
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { clickTargetIsLinkText, findLinkAt, isOpenableUrl } from './links'

function makeState(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage })],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

describe('findLinkAt', () => {
  it('[t](https://a.com) 의 t 위치에서 글자 범위와 url 을 돌려준다', () => {
    const doc = '[t](https://a.com)'
    const state = makeState(doc)
    expect(findLinkAt(state, 1)).toEqual({ from: 1, to: 2, url: 'https://a.com' })
  })

  it('맨 URL(GFM 자동 링크) 위치에서 글자 범위와 url 을 돌려준다', () => {
    const doc = 'https://a.com'
    const state = makeState(doc)
    expect(findLinkAt(state, 5)).toEqual({ from: 0, to: 13, url: 'https://a.com' })
  })

  it('<https://a.com> 위치에서 <> 를 뺀 글자 범위와 url 을 돌려준다', () => {
    const doc = '<https://a.com>'
    const state = makeState(doc)
    expect(findLinkAt(state, 5)).toEqual({ from: 1, to: 14, url: 'https://a.com' })
  })

  it('[a][ref] 처럼 URL 이 없으면 null 이다', () => {
    const doc = '[a][ref]'
    const state = makeState(doc)
    expect(findLinkAt(state, 1)).toBeNull()
  })

  it('![a](b.png) 처럼 Image 안이면 null 이다', () => {
    const doc = '![a](b.png)'
    const state = makeState(doc)
    expect(findLinkAt(state, 7)).toBeNull()
  })

  it('링크가 없는 평범한 글자 위치는 null 이다', () => {
    const doc = '그냥 글자'
    const state = makeState(doc)
    expect(findLinkAt(state, 1)).toBeNull()
  })
})

describe('isOpenableUrl', () => {
  it.each(['https://a.com', 'http://a.com', 'HTTP://a.com', 'mailto:a@b.com', 'MAILTO:a@b.com'])(
    '%s 는 열 수 있다',
    (url) => {
      expect(isOpenableUrl(url)).toBe(true)
    },
  )

  it.each(['./a.md', '#x', 'javascript:alert(1)', '', undefined, null])('%s 는 열 수 없다', (url) => {
    expect(isOpenableUrl(url)).toBe(false)
  })
})

// F-134 3.2: posAtCoords 만으로 판정하면 줄 끝 오른쪽 빈 곳을 눌러도 줄 끝 위치가
// 나와 링크가 열려버린다. 실제 클릭 좌표가 링크 글자(표시용 mark .md-link) 위인지
// event.target 기준으로 추가 확인한다
describe('clickTargetIsLinkText (F-134 3.2)', () => {
  it('target 이 .md-link 표시 요소 안이면 true', () => {
    const target = { closest: (sel: string) => (sel === '.md-link' ? {} : null) } as unknown as EventTarget
    expect(clickTargetIsLinkText(target)).toBe(true)
  })

  it('target 이 .md-link 밖(줄 끝 오른쪽 여백 등)이면 false', () => {
    const target = { closest: () => null } as unknown as EventTarget
    expect(clickTargetIsLinkText(target)).toBe(false)
  })

  it('target 이 없거나 closest 가 없으면 false', () => {
    expect(clickTargetIsLinkText(null)).toBe(false)
    expect(clickTargetIsLinkText(undefined as unknown as EventTarget | null)).toBe(false)
    expect(clickTargetIsLinkText({} as unknown as EventTarget)).toBe(false)
  })
})
