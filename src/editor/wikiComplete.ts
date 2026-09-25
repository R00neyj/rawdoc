// `[[` 뒤 제목 자동완성, autocompletion() override 소스만 쓴다 — 후보는 wikiContextField 해석기 (specs/features/F-131.md 3.1, F-2018 5.5)
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { autocompletion } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

import { shortestWikiTarget, type WikiDocRef, type WikiResolver } from '../lib/wikiResolve'
import { isOpaquePosition, wikiContextField } from './preview/wikiLinks'

// [[ 뒤부터 커서까지, 대괄호·파이프·줄바꿈이 없는 구간에서만 튀운다(F-131 3.1 "| 를 친
// 뒤에는 띄우지 않는다" — 이 문자 클래스가 자연히 그 조건을 만족한다)
const TRIGGER_RE = /\[\[([^[\]|\n]*)$/

const MAX_OPTIONS = 20

function titleMatches(title: string, query: string): boolean {
  return title.toLocaleLowerCase('ko').includes(query.toLocaleLowerCase('ko'))
}

// 선택 적용: [[ 뒤부터 커서까지를 제목으로 바꾼다. 커서 뒤가 이미 ]] 면(F-127 이 넣은 짝)
// 그 뒤로 커서, 아니면 ]] 를 붙이고 그 뒤로 커서 (F-131 3.1)
function applyTitle(view: EditorView, from: number, to: number, title: string): void {
  const hasClosing = view.state.doc.sliceString(to, to + 2) === ']]'
  const afterTitle = from + title.length

  if (hasClosing) {
    view.dispatch({
      changes: { from, to, insert: title },
      selection: { anchor: afterTitle },
      userEvent: 'input.complete',
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: `${title}]]` },
      selection: { anchor: afterTitle + 2 },
      userEvent: 'input.complete',
    })
  }
}

// 같은 제목이 여럿일 때 후보 옆 폴더 자리 — 검색 결과 경로·문서 옮기기·공유받음 표시와 같은 말 (F-2018 5.5)
function folderDetail(resolver: WikiResolver, doc: WikiDocRef): string {
  const names = resolver.folderNames(doc.folderId)
  if (names === null) return '공유받음'
  return names.length === 0 ? '최상위' : names.join(' / ')
}

// [[ 자동완성 소스. F-137 3.2 테스트가 구문 트리 판정(FencedCode·InlineCode·
// Frontmatter 안 제외)을 직접 확인할 수 있도록 내보낸다
export function wikiCompletionSource(context: CompletionContext): CompletionResult | null {
  const match = context.matchBefore(TRIGGER_RE)
  if (!match) return null

  // FencedCode·InlineCode·Frontmatter 안에서는 띄우지 않는다 (F-131 2장, F-137 3.2)
  if (isOpaquePosition(context.state, context.pos)) return null

  const query = match.text.slice(2)
  const wiki = context.state.field(wikiContextField, false)
  if (!wiki) return null
  const { resolver, sourceFolderId, sourceE2ee } = wiki
  // 일반 문서에서는 금고 문서 후보를 거른다 — 금고 문서 안에서만 금고·일반 모두 띄운다 (F-409 4.1)
  const nonEmpty = resolver.docs.filter((d) => d.title.trim() !== '' && (sourceE2ee || !d.e2ee))
  const candidates = query === '' ? nonEmpty : nonEmpty.filter((d) => titleMatches(d.title, query))

  if (candidates.length === 0) return null

  const titleCount = new Map<string, number>()
  for (const d of nonEmpty) {
    const key = d.title.trim().toLowerCase()
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1)
  }

  const options: Completion[] = candidates.slice(0, MAX_OPTIONS).map((doc) => {
    const option: Completion = {
      label: doc.title,
      apply: (view: EditorView, _completion: Completion, from: number, to: number) =>
        applyTitle(view, from, to, shortestWikiTarget(resolver, doc, sourceFolderId)),
    }
    if ((titleCount.get(doc.title.trim().toLowerCase()) ?? 0) > 1) option.detail = folderDetail(resolver, doc)
    return option
  })

  return { from: match.from + 2, to: context.pos, options, filter: false }
}

// createEditor.ts 확장 목록에 항상(모드와 무관하게) 넣는다
export function wikiComplete(): Extension {
  return autocompletion({ override: [wikiCompletionSource] })
}
