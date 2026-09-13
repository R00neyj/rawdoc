// 편집 모드 위키링크 표시·클릭 (specs/features/F-131.md 3장)
// 계산(buildWikiLinks)은 DOM 없이 동작한다. decoration 은 문서를 바꾸지 않는다
// (CLAUDE.md 불변조건). 활성(닿음) 판정은 F-129 와 같은 범위 단위(active.js selectionTouches)
import { syntaxTree } from '@codemirror/language'
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'

import { findWikiLinks, resolveWikiTarget } from '../../lib/wikiLink.js'
import { selectionTouches } from './active.js'
import { isComposing, isForced } from '../composition.js'

const HIDE = Decoration.replace({})

/**
 * 위키링크가 대상이 아닌 블록 — 구문 트리로 판정한다 (F-131 2장, F-137 3.1)
 * `Frontmatter` 는 F-133 3.2 "위키링크는 프론트매터 안에서 동작하지 않는다"
 */
const OPAQUE_NODE = new Set(['FencedCode', 'InlineCode', 'Table', 'Frontmatter'])

/** wikiComplete.js 가 `[[` 자동완성 판정에 그대로 재사용한다 (F-137 3.2) */
export function isOpaquePosition(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, 1)
  for (let n = node; n; n = n.parent) {
    if (OPAQUE_NODE.has(n.name)) return true
  }
  return false
}

/** 위키링크 범위(from, to) 안 자리를 찾는다. 편집 모드 표시·클릭이 공용으로 쓴다 */
function wikiLinksOnLine(state, line) {
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
    .filter(Boolean)
}

/**
 * 위키링크가 존재하는 문서를 가리키는지에 따른 표시용 mark
 * @param {string} target
 * @param {string[]} titles
 */
function visibleMark(target, titles) {
  const exists = resolveWikiTarget(target, titles.map((title) => ({ title }))) !== null
  const cls = exists ? 'md-wikilink' : 'md-wikilink md-wikilink--missing'
  const titleAttr = exists ? target : `새 문서 만들기: ${target}`
  return Decoration.mark({ class: cls, attributes: { title: titleAttr } })
}

const SYNTAX_MARK = Decoration.mark({ class: 'md-wikilink-mark' })

/**
 * @param {import('@codemirror/state').EditorState} state
 * @param {{from:number, to:number}[]} ranges 보통 view.visibleRanges
 * @param {string[]} titles 문서 제목 목록
 * @returns {import('@codemirror/state').Range<import('@codemirror/view').Decoration>[]}
 */
export function buildWikiLinks(state, ranges, titles) {
  const out = []
  const seenLines = new Set()

  for (const { from, to } of ranges) {
    const firstLine = state.doc.lineAt(from).number
    const lastLine = state.doc.lineAt(to).number

    for (let n = firstLine; n <= lastLine; n++) {
      if (seenLines.has(n)) continue
      seenLines.add(n)

      const line = state.doc.line(n)
      for (const link of wikiLinksOnLine(state, line)) {
        if (selectionTouches(state, link.from, link.to)) {
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

/**
 * pos 가 어느 위키링크의 범위 안인지 찾는다 (클릭 처리용). 보이는 글자 범위도 함께 돌려준다
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} pos
 */
export function findWikiLinkAt(state, pos) {
  const line = state.doc.lineAt(pos)
  for (const link of wikiLinksOnLine(state, line)) {
    if (pos >= link.from && pos <= link.to) {
      return { from: link.from, to: link.to, visibleFrom: link.visibleFrom, visibleTo: link.visibleTo, target: link.target }
    }
  }
  return null
}

/** 제목 목록 갱신 신호 (createEditor.js handle 의 setWikiTitles) */
export const setWikiTitlesEffect = StateEffect.define()

/** 현재 문서 제목 목록. 초기값은 createEditor.js 가 wikiTitlesField.init() 으로 준다 */
export const wikiTitlesField = StateField.define({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setWikiTitlesEffect)) return effect.value
    }
    return value
  },
})

function hasTitlesEffect(update) {
  return update.transactions.some((tr) => tr.effects.some((e) => e.is(setWikiTitlesEffect)))
}

/**
 * mapDecorationsOnHold — inline.js·lines.js 와 같은 이유(F-134 3.1)로 조합 중 문서
 * 변경분을 decoration 위치에 반영한다
 */
export function mapDecorationsOnHold(decorations, changes) {
  return decorations.map(changes)
}

/**
 * 편집 모드 위키링크 표시 확장. IME 규칙은 다른 프리뷰 확장과 같다(F-104 2.3·F-134 3.1·3.8).
 * 제목 목록이 바뀌면(setWikiTitles) 재계산 조건에 포함한다 (F-131 3장)
 */
export function wikiLinksPreview() {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = Decoration.set(
          buildWikiLinks(view.state, view.visibleRanges, view.state.field(wikiTitlesField)),
          true,
        )
      }

      update(update) {
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
          buildWikiLinks(update.state, update.view.visibleRanges, update.state.field(wikiTitlesField)),
          true,
        )
      }
    },
    { decorations: (v) => v.decorations },
  )
}

/**
 * 편집 모드 위키링크 클릭 확장 (F-131 3장). F-129 링크 클릭과 같은 구조 —
 * mousedown 에서 기본 동작을 막아야 여는 클릭에서 커서가 움직이지 않는다.
 * @param {(target:string)=>void} [onOpenWikiLink]
 */
export function wikiLinkClicks(onOpenWikiLink) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!onOpenWikiLink) return false
      if (event.button !== 0) return false // 왼쪽 버튼만
      if (isComposing(view)) return false // 조합 중이면 가로채지 않는다

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false

      const link = findWikiLinkAt(view.state, pos)
      if (!link) return false
      if (!event.target?.closest?.('.md-wikilink')) return false // 실제 글자 위가 아니면 기본 동작

      if (event.shiftKey) return false // 기존 선택 확장 동작 그대로
      if (event.ctrlKey || event.metaKey) return false // 열지 않고 커서 이동 — 편집 진입

      // 드러난 상태(커서가 위키링크에 닿음)면 보통 커서 이동 — 열지 않는다
      if (selectionTouches(view.state, link.from, link.to)) return false

      event.preventDefault()
      onOpenWikiLink(link.target)
      return true
    },
  })
}
