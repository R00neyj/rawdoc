// parseCellInline 단위 테스트 (specs/features/F-140.md 4장 A1)
import { describe, expect, it } from 'vitest'
import { parseCellInline } from '../../../../src/editor/preview/cellInline.js'

describe('parseCellInline', () => {
  it('빈 칸은 빈 배열', () => {
    expect(parseCellInline('')).toEqual([])
  })

  it('굵게 **a**·__a__', () => {
    expect(parseCellInline('**a**')).toEqual([{ text: 'a', marks: ['strong'] }])
    expect(parseCellInline('__a__')).toEqual([{ text: 'a', marks: ['strong'] }])
  })

  it('기울임 *a*·_a_', () => {
    expect(parseCellInline('*a*')).toEqual([{ text: 'a', marks: ['em'] }])
    expect(parseCellInline('_a_')).toEqual([{ text: 'a', marks: ['em'] }])
  })

  it('취소선 ~~a~~', () => {
    expect(parseCellInline('~~a~~')).toEqual([{ text: 'a', marks: ['strike'] }])
  })

  it('인라인코드 `a` — 안쪽 기호는 글자 그대로', () => {
    expect(parseCellInline('`**a**`')).toEqual([{ text: '**a**', marks: ['code'] }])
  })

  it('링크 [글자](주소) — href 에 주소', () => {
    expect(parseCellInline('[x](https://e.com)')).toEqual([
      { text: 'x', marks: ['link'], href: 'https://e.com' },
    ])
  })

  it('맨 URL·<URL> 은 주소 글자 그대로에 link mark', () => {
    expect(parseCellInline('https://e.com')).toEqual([
      { text: 'https://e.com', marks: ['link'], href: 'https://e.com' },
    ])
    expect(parseCellInline('<https://e.com>')).toEqual([
      { text: 'https://e.com', marks: ['link'], href: 'https://e.com' },
    ])
  })

  it('위키링크 [[대상]]·[[대상|별칭]] — 보이는 글자는 대상 또는 별칭, wiki 에 대상', () => {
    expect(parseCellInline('[[없는 문서]]')).toEqual([
      { text: '없는 문서', marks: ['wikilink'], wiki: { target: '없는 문서', heading: null } },
    ])
    expect(parseCellInline('[[문서|별칭]]')).toEqual([{ text: '별칭', marks: ['wikilink'], wiki: { target: '문서', heading: null } }])
  })

  it('위키링크 헤딩 — [[문서#절]] 은 문서#절, [[#절]] 은 #절 (F-2018 U12)', () => {
    expect(parseCellInline('[[문서#절]]')).toEqual([{ text: '문서#절', marks: ['wikilink'], wiki: { target: '문서', heading: '절' } }])
    expect(parseCellInline('[[#절]]')).toEqual([{ text: '#절', marks: ['wikilink'], wiki: { target: '', heading: '절' } }])
  })

  it('표 안 파이프 이스케이프에서 온 [[문서\\|별칭]] 은 별칭, 대상에 \\ 가 붙지 않는다', () => {
    expect(parseCellInline('[[문서\\|별칭]]')).toEqual([{ text: '별칭', marks: ['wikilink'], wiki: { target: '문서', heading: null } }])
  })

  it('나란한 위키링크 [[a]][[b]] 는 조각 둘', () => {
    expect(parseCellInline('[[a]][[b]]')).toEqual([
      { text: 'a', marks: ['wikilink'], wiki: { target: 'a', heading: null } },
      { text: 'b', marks: ['wikilink'], wiki: { target: 'b', heading: null } },
    ])
  })

  it('겹친 서식 **a *b***', () => {
    expect(parseCellInline('**a *b***')).toEqual([
      { text: 'a ', marks: ['strong'] },
      { text: 'b', marks: ['strong', 'em'] },
    ])
  })

  it('역슬래시 이스케이프 a\\|b → a|b (뒤 글자만, 역슬래시 숨김)', () => {
    expect(parseCellInline('a\\|b')).toEqual([{ text: 'a|b', marks: [] }])
  })

  it('그 밖 역슬래시(C:\\Users)는 글자 그대로', () => {
    expect(parseCellInline('C:\\Users')).toEqual([{ text: 'C:\\Users', marks: [] }])
  })

  it('표에 없는 것은 원문 글자 그대로: 이미지·HTML 태그·닫히지 않은 기호·블록 기호', () => {
    expect(parseCellInline('![a](b)')).toEqual([{ text: '![a](b)', marks: [] }])
    expect(parseCellInline('<b>x</b>')).toEqual([{ text: '<b>x</b>', marks: [] }])
    expect(parseCellInline('**a')).toEqual([{ text: '**a', marks: [] }])
    expect(parseCellInline('# a')).toEqual([{ text: '# a', marks: [] }])
    expect(parseCellInline('- a')).toEqual([{ text: '- a', marks: [] }])
    expect(parseCellInline('> a')).toEqual([{ text: '> a', marks: [] }])
    expect(parseCellInline('1. a')).toEqual([{ text: '1. a', marks: [] }])
  })

  it('인라인코드 안에서는 위키링크를 찾지 않는다', () => {
    expect(parseCellInline('`[[a]]`')).toEqual([{ text: '[[a]]', marks: ['code'] }])
  })

  it('<br>·<BR /> 를 줄바꿈 조각으로 (specs/features/F-162.md 4장 A1)', () => {
    expect(parseCellInline('a<br>b')).toEqual([{ text: 'a', marks: [] }, { br: true }, { text: 'b', marks: [] }])
    expect(parseCellInline('a<BR />b')).toEqual([{ text: 'a', marks: [] }, { br: true }, { text: 'b', marks: [] }])
    expect(parseCellInline('a<br/>b')).toEqual([{ text: 'a', marks: [] }, { br: true }, { text: 'b', marks: [] }])
  })

  it('인라인코드 안의 <br> 은 글자 그대로', () => {
    expect(parseCellInline('`a<br>b`')).toEqual([{ text: 'a<br>b', marks: ['code'] }])
  })
})
