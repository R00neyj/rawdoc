import type { Parser } from '@lezer/common'
import type { Language } from '@codemirror/language'
import type { CodeLangId } from './codeLang'

// cmLanguage 는 sql·shell 만 — 편집기가 LRLanguage 로 다시 감싸지 않고 그대로 쓴다 (F-2122 1.4)
export type CodeGrammar = { parser: Parser; cmLanguage?: Language }

// 이름공간을 넘기지 말고 받은 자리에서 바로 풀 것 — 안 쓰는 내보내기까지 청크에 따라온다 (F-2123 N4)
const LOADERS: Record<CodeLangId, () => Promise<CodeGrammar>> = {
  javascript: async () => {
    const { parser } = await import('@lezer/javascript')
    return { parser }
  },
  jsx: async () => {
    const { parser } = await import('@lezer/javascript')
    return { parser: parser.configure({ dialect: 'jsx' }) }
  },
  typescript: async () => {
    const { parser } = await import('@lezer/javascript')
    return { parser: parser.configure({ dialect: 'ts' }) }
  },
  tsx: async () => {
    const { parser } = await import('@lezer/javascript')
    return { parser: parser.configure({ dialect: 'ts jsx' }) }
  },
  css: async () => {
    const { parser } = await import('@lezer/css')
    return { parser }
  },
  html: async () => {
    const { parser, configureNesting } = await import('@lezer/html')
    const { parser: jsParser } = await import('@lezer/javascript')
    const { parser: cssParser } = await import('@lezer/css')
    const wrap = configureNesting([
      { tag: 'script', parser: jsParser },
      { tag: 'style', parser: cssParser },
    ])
    return { parser: parser.configure({ wrap }) }
  },
  xml: async () => {
    const { parser } = await import('@lezer/xml')
    return { parser }
  },
  json: async () => {
    const { parser } = await import('@lezer/json')
    return { parser }
  },
  yaml: async () => {
    const { parser } = await import('@lezer/yaml')
    return { parser }
  },
  python: async () => {
    const { parser } = await import('@lezer/python')
    return { parser }
  },
  sql: async () => {
    const { StandardSQL } = await import('@codemirror/lang-sql')
    return { parser: StandardSQL.language.parser, cmLanguage: StandardSQL.language }
  },
  shell: async () => {
    const { StreamLanguage } = await import('@codemirror/language')
    const { shell } = await import('@codemirror/legacy-modes/mode/shell')
    const language = StreamLanguage.define(shell)
    return { parser: language.parser, cmLanguage: language }
  },
}

const loading = new Map<CodeLangId, Promise<CodeGrammar | null>>()
const loaded = new Map<CodeLangId, CodeGrammar>()

// 실패한 id 는 null 약속이 남아 그 탭에서 다시 import 하지 않는다 (F-2123 3.2)
export function loadCodeGrammar(id: CodeLangId): Promise<CodeGrammar | null> {
  let pending = loading.get(id)
  if (!pending) {
    pending = LOADERS[id]().then(
      (grammar) => {
        loaded.set(id, grammar)
        return grammar
      },
      () => null,
    )
    loading.set(id, pending)
  }
  return pending
}

export function loadedCodeGrammar(id: CodeLangId): CodeGrammar | null {
  return loaded.get(id) ?? null
}
