// wikiLinks.js 단위 테스트 (specs/features/F-131.md 7장 A2)
// EditorState + ensureSyntaxTree 로 계산 함수를 직접 부른다. DOM 은 쓰지 않는다
// (클릭 처리 EditorView.domEventHandlers 는 links.js 와 같은 이유로 여기서 테스트하지 않는다)
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { frontmatterExtension } from '../frontmatter'
import { buildWikiLinks, findWikiLinkAt, setWikiContextEffect, wikiContextField, type WikiContext } from './wikiLinks'
import type { EditorState as CMState } from '@codemirror/state'
import { createWikiResolver } from '../../lib/wikiResolve'

function titlesContext(titles: string[]): WikiContext {
  return { resolver: createWikiResolver(titles.map((title, i) => ({ id: String(i), title, folderId: null })), []), sourceFolderId: null }
}

function makeState(
  doc: string,
  { anchor = 0, head = anchor, titles = [], context }: { anchor?: number; head?: number; titles?: string[]; context?: WikiContext } = {},
) {
  const state = EditorState.create({
    doc,
    selection: { anchor, head },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }),
      wikiContextField.init(() => context ?? titlesContext(titles)),
    ],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function build(state: CMState) {
  return buildWikiLinks(state, [{ from: 0, to: state.doc.length }], state.field(wikiContextField))
}

describe('buildWikiLinks — 커서가 밖일 때', () => {
  it('[[a]] 의 [[ ]] 를 숨기고 보이는 글자 a 에 md-wikilink 를 붙인다(문서 있음)', () => {
    const doc = '[[a]]\nx'
    const state = makeState(doc, { anchor: doc.length, titles: ['a'] })
    const ranges = build(state)

    const hidden = ranges.filter((r) => r.value.spec.class === undefined)
    expect(hidden).toHaveLength(2) // [[ 와 ]]
    expect(hidden.reduce((sum, r) => sum + (r.to - r.from), 0)).toBe(4)

    const visible = ranges.find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.from).toBe(2)
    expect(visible.to).toBe(3)
    expect(visible.value.spec.class).toBe('md-wikilink')
    expect(visible.value.spec.attributes.title).toBe('a')
  })

  it('문서가 없으면 md-wikilink--missing 과 "새 문서 만들기: " title', () => {
    const doc = '[[없는 제목]]\nx'
    const state = makeState(doc, { anchor: doc.length, titles: [] })
    const ranges = build(state)
    const visible = ranges.find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.value.spec.class).toBe('md-wikilink md-wikilink--missing')
    expect(visible.value.spec.attributes.title).toBe('새 문서 만들기: 없는 제목')
  })

  it('별칭 [[a|B]] 는 대상|(a|) 도 숨기고 별칭 B 만 보인다', () => {
    const doc = '[[a|B]]\nx'
    const state = makeState(doc, { anchor: doc.length, titles: ['a'] })
    const ranges = build(state)
    const hidden = ranges.filter((r) => r.value.spec.class === undefined)
    // [[ , a| , ]] = 3개
    expect(hidden).toHaveLength(3)
    const visible = ranges.find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(doc.slice(visible.from, visible.to)).toBe('B')
  })
})

describe('buildWikiLinks — 커서가 닿으면', () => {
  it('숨김이 없고 기호에만 md-wikilink-mark 가 붙는다', () => {
    const doc = '[[a]]'
    const state = makeState(doc, { anchor: 3, titles: ['a'] }) // 커서: 'a' 안
    const ranges = build(state)
    const hidden = ranges.filter((r) => r.value.spec.class === undefined)
    expect(hidden).toHaveLength(0)
    const marks = ranges.filter((r) => r.value.spec.class === 'md-wikilink-mark')
    expect(marks).toHaveLength(2) // [[ 와 ]]
  })
})

describe('buildWikiLinks — 코드블록·인라인코드·표 칸 제외', () => {
  it('인라인코드 안은 위키링크로 처리하지 않는다', () => {
    const doc = '`[[a]]`\nx'
    const state = makeState(doc, { anchor: doc.length, titles: ['a'] })
    expect(build(state)).toEqual([])
  })

  it('펜스 코드블록 안은 위키링크로 처리하지 않는다', () => {
    const doc = '```\n[[a]]\n```\nx'
    const state = makeState(doc, { anchor: doc.length, titles: ['a'] })
    expect(build(state)).toEqual([])
  })

  it('표 칸 안은 위키링크로 처리하지 않는다', () => {
    const doc = '| a | [[b]] |\n| --- | --- |\n| x | y |\nz'
    const state = makeState(doc, { anchor: doc.length, titles: ['b'] })
    expect(build(state)).toEqual([])
  })

  it('프론트매터 안은 위키링크로 처리하지 않는다 (본문은 그대로 처리)', () => {
    const doc = '---\nrelated: [[사용법]]\n---\n[[사용법]]'
    // 커서를 0(문서 시작)에 둔다 — 마지막 줄 링크에 커서가 닿으면(F-131 3장) 기호가
    // 숨겨지지 않아 이 테스트가 보려는 md-wikilink(visible) 클래스가 아닌
    // md-wikilink-mark 로 나온다
    const state = makeState(doc, { anchor: 0, titles: ['사용법'] })
    const ranges = build(state)
    const visible = ranges.filter((r) => r.value.spec.class === 'md-wikilink' || r.value.spec.class === 'md-wikilink md-wikilink--missing')
    expect(visible).toHaveLength(1)
    expect(doc.slice(visible[0].from, visible[0].to)).toBe('사용법')
    // 본문 [[사용법]] 은 마지막 줄에 있다 — 프론트매터 안 위치가 아니어야 한다
    const bodyLineStart = doc.lastIndexOf('\n') + 1
    expect(visible[0].from).toBeGreaterThanOrEqual(bodyLineStart)
  })
})

describe('setWikiContext 재계산', () => {
  it('제목 목록이 바뀌면 있음/없음 클래스가 바뀐다', () => {
    const doc = '[[a]]\nx'
    let state = makeState(doc, { anchor: doc.length, titles: [] })
    let ranges = build(state)
    let visible = ranges.find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.value.spec.class).toContain('--missing')

    const tr = state.update({ effects: setWikiContextEffect.of(titlesContext(['a'])) })
    state = tr.state
    ranges = build(state)
    visible = ranges.find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.value.spec.class).toBe('md-wikilink')
  })
})

describe('findWikiLinkAt', () => {
  it('위키링크 범위 안 위치에서 target 을 돌려준다', () => {
    const doc = '[[a]]'
    const state = makeState(doc, { titles: ['a'] })
    expect(findWikiLinkAt(state, 2)).toMatchObject({ from: 0, to: 5, target: 'a' })
  })

  it('범위 밖 위치는 null', () => {
    const doc = '[[a]] x'
    const state = makeState(doc, { titles: ['a'] })
    expect(findWikiLinkAt(state, 6)).toBeNull()
  })
})

describe('F-2018 U13 — 해석 문맥으로 표시', () => {
  const folders = [
    { id: 'g', name: '교안', parentId: null },
    { id: 'h', name: '과제', parentId: null },
  ]
  const docs = [
    { id: 'm', title: '회의록', folderId: null },
    { id: 'w', title: '1주차', folderId: 'g' },
  ]
  const context: WikiContext = { resolver: createWikiResolver(docs, folders), sourceFolderId: 'h' }

  function visibleOf(doc: string, ctx: WikiContext = context) {
    const state = makeState(`${doc}\nx`, { anchor: doc.length + 2, context: ctx })
    const visible = build(state).find((r) => r.value.spec.class?.includes('md-wikilink') && r.value.spec.class !== 'md-wikilink-mark')!
    return { cls: visible.value.spec.class, title: visible.value.spec.attributes.title, text: state.doc.sliceString(visible.from, visible.to) }
  }

  it('[[회의록]] 있음 / 없음', () => {
    expect(visibleOf('[[회의록]]')).toEqual({ cls: 'md-wikilink', title: '회의록', text: '회의록' })
    expect(visibleOf('[[없음]]')).toEqual({ cls: 'md-wikilink md-wikilink--missing', title: '새 문서 만들기: 없음', text: '없음' })
  })

  it('[[회의록#결정]] 은 문서만 본다', () => {
    expect(visibleOf('[[회의록#결정]]')).toEqual({ cls: 'md-wikilink', title: '회의록#결정', text: '회의록#결정' })
    expect(visibleOf('[[없음#결정]]')).toEqual({ cls: 'md-wikilink md-wikilink--missing', title: '새 문서 만들기: 없음', text: '없음#결정' })
  })

  it('[[#결정]] 은 언제나 있음', () => {
    expect(visibleOf('[[#결정]]')).toEqual({ cls: 'md-wikilink', title: '#결정', text: '#결정' })
  })

  it('[[교안/1주차]] 는 경로식 해석', () => {
    expect(visibleOf('[[교안/1주차]]')).toEqual({ cls: 'md-wikilink', title: '교안/1주차', text: '교안/1주차' })
    expect(visibleOf('[[과제/1주차]]').cls).toBe('md-wikilink md-wikilink--missing')
  })

  it('setWikiContextEffect 뒤 경로식 링크가 있음이 된다', () => {
    const doc = '[[교안/1주차]]\nx'
    let state = makeState(doc, { anchor: doc.length, titles: ['1주차'] })
    let visible = build(state).find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.value.spec.class).toContain('--missing')
    state = state.update({ effects: setWikiContextEffect.of(context) }).state
    visible = build(state).find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.value.spec.class).toBe('md-wikilink')
  })

  it('findWikiLinkAt 이 heading 을 돌려준다', () => {
    const state = makeState('[[회의록#결정]] [[#끝]] [[a]]', { context })
    expect(findWikiLinkAt(state, 3)).toMatchObject({ target: '회의록', heading: '결정' })
    expect(findWikiLinkAt(state, 14)).toMatchObject({ target: '', heading: '끝' })
    expect(findWikiLinkAt(state, 21)).toMatchObject({ target: 'a', heading: null })
  })
})

// F-2044 U5 — hoverPreview 문맥이면 있는 문서 링크에서 title 을 뺀다(4.5)
describe('F-2044 U5 — hoverPreview 문맥의 title 생략', () => {
  it('있는 문서 링크는 title 속성이 없다', () => {
    const doc = '[[a]] x'
    const state = makeState(doc, {
      anchor: doc.length,
      context: { resolver: createWikiResolver([{ id: '0', title: 'a', folderId: null }], []), sourceFolderId: null, hoverPreview: true },
    })
    const visible = build(state).find((r) => r.value.spec.class === 'md-wikilink')!
    expect(visible.value.spec.attributes).toBeUndefined()
  })

  it('없는 문서 링크는 title 이 그대로 "새 문서 만들기: …" 다', () => {
    const doc = '[[없는 제목]] x'
    const state = makeState(doc, {
      anchor: doc.length,
      context: { resolver: createWikiResolver([], []), sourceFolderId: null, hoverPreview: true },
    })
    const visible = build(state).find((r) => r.value.spec.class?.includes('md-wikilink'))!
    expect(visible.value.spec.attributes.title).toBe('새 문서 만들기: 없는 제목')
  })

  it('hoverPreview 를 안 주면 기존과 같이 title 이 붙는다', () => {
    const doc = '[[a]] x'
    const state = makeState(doc, { anchor: doc.length, titles: ['a'] })
    const visible = build(state).find((r) => r.value.spec.class === 'md-wikilink')!
    expect(visible.value.spec.attributes.title).toBe('a')
  })
})
