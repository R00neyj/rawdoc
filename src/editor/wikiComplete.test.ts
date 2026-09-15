// wikiComplete.js 단위 테스트 (specs/features/F-137.md 3.2)
// wikiCompletionSource 를 CompletionContext 로 직접 부른다. autocompletion() 자체
// (팝업 UI)는 DOM 이 필요해 여기서 테스트하지 않는다 — wikiLinks.js 테스트와 같은 방침
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { CompletionContext } from '@codemirror/autocomplete'
import { frontmatterExtension } from './frontmatter'
import { wikiTitlesField } from './preview/wikiLinks'
import { wikiCompletionSource } from './wikiComplete'

function makeState(doc: string, { anchor, titles = ['사용법'] }: { anchor?: number; titles?: string[] } = {}) {
  const state = EditorState.create({
    doc,
    selection: { anchor: anchor ?? doc.length },
    extensions: [
      markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }),
      wikiTitlesField.init(() => titles),
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
