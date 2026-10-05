// 코드블록 중첩 파싱·구문 색·들여쓰기 보정 (F-2125 2장)
import { LanguageDescription, LanguageSupport, LRLanguage, indentService, languageDataProp, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { Language } from '@codemirror/language'
import { countColumn } from '@codemirror/state'
import type { Extension, Facet } from '@codemirror/state'
import type { CommentTokens } from '@codemirror/commands'
import type { NodeType, SyntaxNode } from '@lezer/common'
import type { Highlighter } from '@lezer/highlight'
import type { LRParser } from '@lezer/lr'

import { codeLangId, type CodeLangId } from '../lib/codeLang'
import { codeTokenHighlighter } from '../lib/codeHighlight'
import { loadCodeGrammar } from '../lib/codeParsers'

// sql·shell 은 cmLanguage 가 자체 주석 자료를 갖는다 (F-2125 2.4·R6)
export const CODE_COMMENT_TOKENS: Partial<Record<CodeLangId, CommentTokens>> = {
  javascript: { line: '//', block: { open: '/*', close: '*/' } },
  jsx: { line: '//', block: { open: '/*', close: '*/' } },
  typescript: { line: '//', block: { open: '/*', close: '*/' } },
  tsx: { line: '//', block: { open: '/*', close: '*/' } },
  css: { block: { open: '/*', close: '*/' } },
  html: { block: { open: '<!--', close: '-->' } },
  xml: { block: { open: '<!--', close: '-->' } },
  python: { line: '#' },
  yaml: { line: '#' },
}

type LanguageData = Facet<{ [name: string]: unknown }>

const descriptions = new Map<CodeLangId, LanguageDescription>()
const failed = new Set<CodeLangId>()
const ownData = new Set<LanguageData>()

async function loadSupport(id: CodeLangId): Promise<LanguageSupport> {
  const grammar = await loadCodeGrammar(id)
  if (!grammar) {
    failed.add(id)
    throw new Error(`코드 문법을 불러오지 못함: ${id}`)
  }
  const tokens = CODE_COMMENT_TOKENS[id]
  const lang: Language =
    grammar.cmLanguage ??
    LRLanguage.define({ name: id, parser: grammar.parser as LRParser, languageData: tokens ? { commentTokens: tokens } : {} })
  ownData.add(lang.data)
  return new LanguageSupport(lang)
}

// 실패한 id 는 그 탭에서 null — 안 그러면 CM6 가 파싱마다 load() 를 다시 부른다 (F-2125 2.1·R7)
export function codeLanguageFor(info: string): LanguageDescription | null {
  const id = codeLangId(info)
  if (!id || failed.has(id)) return null
  let desc = descriptions.get(id)
  if (!desc) {
    desc = LanguageDescription.of({ name: id, load: () => loadSupport(id) })
    descriptions.set(id, desc)
  }
  return desc
}

// 언어 자료가 없는 트리(html 안 <script> 의 날 js 파서)도 칠한다 — 본문 HTML 은 lang-html 자료가 있어 빠진다 (R1)
function inCodeScope(type: NodeType): boolean {
  const data = type.prop(languageDataProp)
  return data === undefined || ownData.has(data)
}

export const codeHighlighter: Highlighter = { style: codeTokenHighlighter.style, scope: inCodeScope }

// 펜스 안이면 커서가 든 문서 줄의 앞 공백 칸 수 — 가상 줄(cx.lineAt)을 읽으면 {|} 가 달라진다 (R5)
const fencedCodeIndent = indentService.of((cx, pos) => {
  for (let node: SyntaxNode | null = syntaxTree(cx.state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name !== 'FencedCode') continue
    const text = cx.state.doc.lineAt(pos).text
    return countColumn(/^\s*/.exec(text)![0], cx.state.tabSize)
  }
  return undefined
})

export function codeEditorExtension(): Extension {
  return [syntaxHighlighting(codeHighlighter), fencedCodeIndent]
}
