// 편집 모드 위키링크 표시·클릭 (specs/features/F-131.md 3장)
// 계산(buildWikiLinks)은 DOM 없이 동작한다. decoration 은 문서를 바꾸지 않는다
// (CLAUDE.md 불변조건). 활성(닿음) 판정은 F-129 와 같은 범위 단위(active.js selectionTouches)
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range as CMRange } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import type { ChangeDesc, Line } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'

import { findWikiLinks, resolveWikiTarget } from '../../lib/wikiLink'
import { isEditorFocused, selectionTouches } from './active'
import { isComposing, isForced } from '../composition'

const HIDE = Decoration.replace({})

// 위키링크가 대상이 아닌 블록 — 구문 트리로 판정한다 (F-131 2장, F-137 3.1)
// Frontmatter 는 F-133 3.2 "위키링크는 프론트매터 안에서 동작하지 않는다"
const OPAQUE_NODE = new Set(['FencedCode', 'InlineCode', 'Table', 'Frontmatter'])

// wikiComplete.ts 가 [[ 자동완성 판정에 그대로 재사용한다 (F-137 3.2)
export function isOpaquePosition(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, 1)
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (OPAQUE_NODE.has(n.name)) return true
  }
  return false
}

type WikiLinkOnLine = {
  from: number
  to: number
  openFrom: number
  openTo: number
  closeFrom: number
  closeTo: number
  prefixFrom: number
  prefixTo: number
  visibleFrom: number
  visibleTo: number
  hasAlias: boolean
  target: string
}

// 위키링크 범위(from, to) 안 자리를 찾는다. 편집 모드 표시·클릭이 공용으로 쓴다
function wikiLinksOnLine(state: EditorState, line: Line): WikiLinkOnLine[] {
  const lineText = state.doc.sliceString(line.from, line.to)
  const matches = findWikiLinks(lineText)
  if (matches.length === 0) return []

  return matches
    .map((m) => {
      const linkFrom = line.from + m.from
      const linkTo = line.from + m.to
      if (isOpaquePosition(state, linkFrom)) return null

      const targetFrom = line.from + m.targetFrom
      const targetTo = line.from + m.targetTo
      const hasAlias = m.alias !== null
      // 보이는 글자 범위: 별칭이 있으면 별칭, 없으면 대상 원문 그대로(# 뒤 포함, F-131 2장)
      const visibleFrom = hasAlias ? targetTo + 1 : targetFrom
      const visibleTo = hasAlias ? linkTo - 2 : targetTo

      return {
        from: linkFrom,
        to: linkTo,
        openFrom: linkFrom,
        openTo: linkFrom + 2,
        closeFrom: linkTo - 2,
        closeTo: linkTo,
        // "대상|" 구간(별칭이 있을 때만) — targetFrom 부터 별칭 시작 전까지
        prefixFrom: targetFrom,
        prefixTo: hasAlias ? visibleFrom : targetFrom,
        visibleFrom,
        visibleTo,
        hasAlias,
        target: m.target,
      }
    })
    .filter((entry): entry is WikiLinkOnLine => entry !== null)
}

// 위키링크가 존재하는 문서를 가리키는지에 따른 표시용 mark
function visibleMark(target: string, titles: string[]): Decoration {
  const exists = resolveWikiTarget(target, titles.map((title) => ({ title }))) !== null
  const cls = exists ? 'md-wikilink' : 'md-wikilink md-wikilink--missing'
  const titleAttr = exists ? target : `새 문서 만들기: ${target}`
  return Decoration.mark({ class: cls, attributes: { title: titleAttr } })
}

const SYNTAX_MARK = Decoration.mark({ class: 'md-wikilink-mark' })

// ranges 는 보통 view.visibleRanges, titles 는 문서 제목 목록.
// hasFocus 는 편집기 포커스 (F-146 3.2). 기본값 true 는 포커스를
// 다루지 않는 기존 호출부(테스트 등)의 동작을 그대로 유지한다
export function buildWikiLinks(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  titles: string[],
  hasFocus = true,
): CMRange<Decoration>[] {
  const out: CMRange<Decoration>[] = []
  const seenLines = new Set<number>()

  for (const { from, to } of ranges) {
    const firstLine = state.doc.lineAt(from).number
    const lastLine = state.doc.lineAt(to).number

    for (let n = firstLine; n <= lastLine; n++) {
      if (seenLines.has(n)) continue
      seenLines.add(n)

      const line = state.doc.line(n)
      for (const link of wikiLinksOnLine(state, line)) {
        if (selectionTouches(state, link.from, link.to, hasFocus)) {
          // 닿음: 원문 전체 표시, 기호 색만 (--accent)
          out.push(SYNTAX_MARK.range(link.openFrom, link.openTo))
          if (link.hasAlias) out.push(SYNTAX_MARK.range(link.prefixFrom, link.prefixTo))
          out.push(SYNTAX_MARK.range(link.closeFrom, link.closeTo))
          continue
        }

        // 닿지 않음: [[ ]] 숨김(별칭 있으면 "대상|" 도), 보이는 글자에 mark
        out.push(HIDE.range(link.openFrom, link.openTo))
        if (link.hasAlias) out.push(HIDE.range(link.prefixFrom, link.prefixTo))
        out.push(HIDE.range(link.closeFrom, link.closeTo))
        out.push(visibleMark(link.target, titles).range(link.visibleFrom, link.visibleTo))
      }
    }
  }

  return out
}

export type WikiLinkAt = { from: number; to: number; visibleFrom: number; visibleTo: number; target: string }

// pos 가 어느 위키링크의 범위 안인지 찾는다 (클릭 처리용). 보이는 글자 범위도 함께 돌려준다
export function findWikiLinkAt(state: EditorState, pos: number): WikiLinkAt | null {
  const line = state.doc.lineAt(pos)
  for (const link of wikiLinksOnLine(state, line)) {
    if (pos >= link.from && pos <= link.to) {
      return { from: link.from, to: link.to, visibleFrom: link.visibleFrom, visibleTo: link.visibleTo, target: link.target }
    }
  }
  return null
}

// 제목 목록 갱신 신호 (createEditor.ts handle 의 setWikiTitles)
export const setWikiTitlesEffect = StateEffect.define<string[]>()

// 현재 문서 제목 목록. 초기값은 createEditor.ts 가 wikiTitlesField.init() 으로 준다
export const wikiTitlesField = StateField.define<string[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setWikiTitlesEffect)) return effect.value
    }
    return value
  },
})

function hasTitlesEffect(update: ViewUpdate): boolean {
  return update.transactions.some((tr) => tr.effects.some((e) => e.is(setWikiTitlesEffect)))
}

// mapDecorationsOnHold — inline.ts·lines.ts 와 같은 이유(F-134 3.1)로 조합 중 문서
// 변경분을 decoration 위치에 반영한다
export function mapDecorationsOnHold(
  decorations: ReturnType<typeof Decoration.set>,
  changes: ChangeDesc,
): ReturnType<typeof Decoration.set> {
  return decorations.map(changes)
}

// 편집 모드 위키링크 표시 확장. IME 규칙은 다른 프리뷰 확장과 같다(F-104 2.3·F-134 3.1·3.8).
// 제목 목록이 바뀌면(setWikiTitles) 재계산 조건에 포함한다 (F-131 3장)
export function wikiLinksPreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: ReturnType<typeof Decoration.set>

      constructor(view: EditorView) {
        this.decorations = Decoration.set(
          buildWikiLinks(view.state, view.visibleRanges, view.state.field(wikiTitlesField), isEditorFocused(view)),
          true,
        )
      }

      update(update: ViewUpdate) {
        const titlesChanged = hasTitlesEffect(update)
        if (!isForced(update)) {
          const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state)
          if (!update.docChanged && !update.selectionSet && !update.viewportChanged && !treeChanged && !titlesChanged) {
            return
          }
          if (isComposing(update.view)) {
            if (update.docChanged) this.decorations = mapDecorationsOnHold(this.decorations, update.changes)
            return
          }
        }
        this.decorations = Decoration.set(
          buildWikiLinks(
            update.state,
            update.view.visibleRanges,
            update.state.field(wikiTitlesField),
            isEditorFocused(update.view),
          ),
          true,
        )
      }
    },
    { decorations: (v) => v.decorations },
  )
}

export type OnOpenWikiLink = (target: string) => void

// 편집 모드 위키링크 클릭 확장 (F-131 3장). F-129 링크 클릭과 같은 구조 —
// mousedown 에서 기본 동작을 막아야 여는 클릭에서 커서가 움직이지 않는다
export function wikiLinkClicks(onOpenWikiLink?: OnOpenWikiLink): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!onOpenWikiLink) return false
      if (event.button !== 0) return false // 왼쪽 버튼만
      if (isComposing(view)) return false // 조합 중이면 가로채지 않는다

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false

      const link = findWikiLinkAt(view.state, pos)
      if (!link) return false
      if (!(event.target as Element | null)?.closest?.('.md-wikilink')) return false // 실제 글자 위가 아니면 기본 동작

      if (event.shiftKey) return false // 기존 선택 확장 동작 그대로
      if (event.ctrlKey || event.metaKey) return false // 열지 않고 커서 이동 — 편집 진입

      // 드러난 상태(커서가 위키링크에 닿음)면 보통 커서 이동 — 열지 않는다
      if (selectionTouches(view.state, link.from, link.to, isEditorFocused(view))) return false

      event.preventDefault()
      onOpenWikiLink(link.target)
      return true
    },
  })
}
