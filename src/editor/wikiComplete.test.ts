// wikiComplete.js 단위 테스트 (specs/features/F-137.md 3.2)
// wikiCompletionSource 를 CompletionContext 로 직접 부른다. autocompletion() 자체
// (팝업 UI)는 DOM 이 필요해 여기서 테스트하지 않는다 — wikiLinks.js 테스트와 같은 방침
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { CompletionContext } from '@codemirror/autocomplete'
import { frontmatterExtension } from './frontmatter'
import { wikiContextField, type WikiContext } from './preview/wikiLinks'
import { createWikiResolver, type WikiDocRef, type WikiFolderRef } from '../lib/wikiResolve'
import { wikiCompletionSource } from './wikiComplete'

function makeState(doc: string, { anchor, titles = ['사용법'], context }: { anchor?: number; titles?: string[]; context?: WikiContext } = {}) {
  const ctx = context ?? { resolver: createWikiResolver(titles.map((title, i) => ({ id: String(i), title, folderId: null })), []), sourceFolderId: null }
  const state = EditorState.create({
    doc,
    selection: { anchor: anchor ?? doc.length },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }),
      wikiContextField.init(() => ctx),
    ],
  })
  ensureSyntaxTree(state, doc.length, 5000)
  return state
}

function sourceAt(doc: string, pos: number) {
  const state = makeState(doc, { anchor: pos })
  return wikiCompletionSource(new CompletionContext(state, pos, false))
}

describe('wikiCompletionSource — 구문 트리로 막는 위치 (F-137 3.2)', () => {
  it('FencedCode 안에서는 null', () => {
    const doc = '```\n[[사\n```'
    const pos = doc.indexOf('사') + 1
    expect(sourceAt(doc, pos)).toBeNull()
  })

  it('InlineCode 안에서는 null', () => {
    const doc = '`[[사`'
    const pos = doc.indexOf('사') + 1
    expect(sourceAt(doc, pos)).toBeNull()
  })

  it('Frontmatter 안에서는 null', () => {
    const doc = '---\nrelated: [[사\n---\n본문'
    const pos = doc.indexOf('사') + 1
    expect(sourceAt(doc, pos)).toBeNull()
  })

  it('본문에서는 결과가 있다', () => {
    const doc = '[[사'
    const result = sourceAt(doc, doc.length)
    expect(result).not.toBeNull()
    expect(result!.options.map((o) => o.label)).toContain('사용법')
  })
})

describe('F-2018 U14 — 같은 제목이면 폴더 경로, 가장 짧은 형태 넣기', () => {
  const folders: WikiFolderRef[] = [
    { id: 'g', name: '교안', parentId: null },
    { id: 'h', name: '과제', parentId: null },
    { id: 'u', name: '상위', parentId: null },
    { id: 'l', name: '하위', parentId: 'u' },
  ]
  const docs: WikiDocRef[] = [
    { id: 'hw', title: '1주차', folderId: 'h' },
    { id: 'lec', title: '1주차', folderId: 'g' },
    { id: 'deep', title: '색인', folderId: 'l' },
    { id: 'top', title: '색인', folderId: null },
    { id: 'shared', title: '색인', folderId: 'foreign' },
    { id: 'solo', title: '혼자', folderId: 'g' },
  ]
  const context: WikiContext = { resolver: createWikiResolver(docs, folders), sourceFolderId: 'g' }

  function optionsFor(doc: string) {
    const state = makeState(doc, { context })
    return { state, result: wikiCompletionSource(new CompletionContext(state, doc.length, false))! }
  }

  it('같은 제목 둘이면 detail 이 교안·과제', () => {
    const { result } = optionsFor('[[1주')
    expect(result.options.map((o) => [o.label, o.detail])).toEqual([
      ['1주차', '과제'],
      ['1주차', '교안'],
    ])
  })

  it('폴더 안은 상위 / 하위, 최상위, 공유받음', () => {
    const { result } = optionsFor('[[색')
    expect(result.options.map((o) => o.detail)).toEqual(['상위 / 하위', '최상위', '공유받음'])
  })

  it('하나뿐인 제목은 detail 없음', () => {
    const { result } = optionsFor('[[혼')
    expect(result.options).toHaveLength(1)
    expect(result.options[0].detail).toBeUndefined()
  })

  function applyOption(doc: string, index: number, after = '') {
    const full = doc + after
    let state = makeState(full, { anchor: doc.length, context })
    const result = wikiCompletionSource(new CompletionContext(state, doc.length, false))!
    const view = { get state() { return state }, dispatch: (spec: Parameters<typeof state.update>[0]) => { state = state.update(spec).state } }
    const apply = result.options[index].apply as (v: unknown, c: unknown, from: number, to: number) => void
    apply(view, result.options[index], result.from, result.to ?? doc.length)
    return state.doc.toString()
  }

  it('고르면 shortestWikiTarget 결과 — 과제 쪽은 [[과제/1주차]], 교안 쪽은 [[1주차]]', () => {
    expect(applyOption('[[1주', 0)).toBe('[[과제/1주차]]')
    expect(applyOption('[[1주', 1)).toBe('[[1주차]]')
  })

  it(']] 짝이 이미 있으면 그 뒤로 — 짝 규칙 그대로', () => {
    expect(applyOption('[[1주', 0, ']]')).toBe('[[과제/1주차]]')
  })
})

describe('F-409 U13 — 일반 문서에서는 금고 문서 후보를 거른다 (4.1)', () => {
  const docs: WikiDocRef[] = [
    { id: 'plain', title: '메모', folderId: null },
    { id: 'secretTitle', title: '비밀 제목', folderId: 'g', e2ee: true },
    { id: 'secretMemo', title: '메모', folderId: 'g', e2ee: true },
  ]
  const resolver = createWikiResolver(docs, [{ id: 'g', name: '금고폴더', parentId: null }])

  function optionsFor(doc: string, sourceE2ee?: boolean) {
    const context: WikiContext = { resolver, sourceFolderId: null, sourceE2ee }
    const state = makeState(doc, { context })
    return wikiCompletionSource(new CompletionContext(state, doc.length, false))
  }

  it('sourceE2ee 없음/거짓 — 후보 라벨이 메모 하나, detail 없음(걸러진 풀에서 같은 제목이 하나)', () => {
    const result = optionsFor('[[')
    expect(result!.options.map((o) => o.label)).toEqual(['메모'])
    expect(result!.options[0].detail).toBeUndefined()
  })

  it('sourceE2ee: false 도 같다', () => {
    const result = optionsFor('[[', false)
    expect(result!.options.map((o) => o.label)).toEqual(['메모'])
  })

  it('sourceE2ee: true — 셋 다, 두 메모에 폴더 detail', () => {
    const result = optionsFor('[[', true)
    const byLabel = result!.options.map((o) => [o.label, o.detail])
    expect(byLabel).toHaveLength(3)
    expect(byLabel.filter(([label]) => label === '메모').every(([, detail]) => detail !== undefined)).toBe(true)
    expect(byLabel.some(([label]) => label === '비밀 제목')).toBe(true)
  })

  it('원본이 일반 문서여도 본문에 [[비밀 제목]] 을 직접 넣으면 resolve 는 그 문서를 돌려준다', () => {
    expect(resolver.resolve('비밀 제목', null)?.id).toBe('secretTitle')
  })
})
