// specs/features/F-2168.md 5장 U1 — 편집기 트리와 보기 HTML 의 강조 순서가 같고 기대값과도 같다
import { describe, expect, it } from 'vitest'
import { markdownLanguage } from '@codemirror/lang-markdown'
import type { MarkdownParser } from '@lezer/markdown'

import { cjkEmphasis } from '../../../src/editor/cjkEmphasis'
import { renderMarkdown } from '../../../src/viewer/renderMarkdown'

const parser = (markdownLanguage.parser as unknown as MarkdownParser).configure([cjkEmphasis])

const TREE_NAMES: Record<string, string> = { StrongEmphasis: 'strong', Emphasis: 'em', Strikethrough: 's' }

function treeMarks(text: string): string[] {
  const out: string[] = []
  parser.parse(text).iterate({
    enter(node) {
      const name = TREE_NAMES[node.name]
      if (name) out.push(name)
    },
  })
  return out
}

function htmlMarks(text: string): string[] {
  return [...renderMarkdown(text).matchAll(/<(strong|em|s)>/g)].map((m) => m[1])
}

const CASES: [string, string[]][] = [
  ['과변조 **"문구"**를', ['strong']],
  ['**이 괄호(parenthesis)**가 있는', ['strong']],
  ['*"기울"*임', ['em']],
  ['~~"취소"~~를', ['s']],
  ['***"굵기울"***는', ['em', 'strong']],
  ['첫 줄\n과변조 **"문구"**를', ['strong']],
  ['[과변조 **"문구"**를](https://a.b)', ['strong']],
  ['> 인용 **"문구"**를', ['strong']],
  ['**강조。**この', ['strong']],
  ['😀**"a"**를', ['strong']],
  ['**"WHAT not HOW"**', ['strong']],
  ['**문구**를', ['strong']],
  ['「**강조**」했다', ['strong']],
  ['foo*bar*baz', ['em']],
  ['**foo**bar', ['strong']],
  ['a **"b"**c', []],
  ['한_글_한', []],
  ['snake_case_word', []],
]

describe('cjkEmphasis — 편집기·보기 강조 일치 (U1)', () => {
  it.each(CASES)('%j', (text, expected) => {
    expect(treeMarks(text)).toEqual(htmlMarks(text))
    expect(treeMarks(text)).toEqual(expected)
  })
})
