// 템플릿 본문 넣기 — 자리 계산 + 트랜잭션 1개 dispatch (specs/features/F-2022.md 5.3·5.6). editor → lib 만 import
import type { EditorState, Line, Transaction } from '@codemirror/state'
import { EditorSelection } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

import { selectionLines, computePlacement, buildInsert } from './insertCommands'
import { planTemplateInsert } from '../lib/templates'

// F-169 2장과 같은 목록 — 기준 줄이 이 안이면 그 블록의 마지막 줄로 옮긴다(F-169 는 여기서 그냥 포기하지만, 템플릿은 뒤에 넣는다) (5.3)
const OPAQUE_BLOCK = new Set(['FencedCode', 'Frontmatter', 'Table'])

function opaqueBlockLastLine(state: EditorState, line: Line): Line | null {
  const node = syntaxTree(state).resolveInner(line.from, 1)
  for (let n: SyntaxNode | null = node; n; n = n.parent) {
    if (OPAQUE_BLOCK.has(n.name)) {
      const endPos = Math.max(n.to - 1, n.from)
      return state.doc.lineAt(endPos)
    }
  }
  return null
}

export function insertTemplate(
  target: { state: EditorState; dispatch: (tr: Transaction) => void },
  templateText: string, // 치환이 끝난 LF 글
): { inserted: boolean; frontmatterSkipped: boolean } {
  const { state, dispatch } = target
  if (state.readOnly) return { inserted: false, frontmatterSkipped: false }

  const plan = planTemplateInsert(state.doc.toString(), templateText)
  const cursorPos = state.selection.main.head
  const shift = plan.frontmatterChange ? plan.frontmatterChange.insert.length : 0

  if (plan.body === '' && plan.frontmatterChange === null) {
    return { inserted: false, frontmatterSkipped: plan.frontmatterSkipped }
  }

  const changes: { from: number; to: number; insert: string }[] = []
  if (plan.frontmatterChange) changes.push(plan.frontmatterChange)

  let newCursor: number

  if (plan.body === '') {
    // 본문이 비었으면(템플릿이 프론트매터뿐) 커서는 원래 자리(프론트매터 삽입만큼 옮긴 값) (5.5)
    newCursor = cursorPos + shift
  } else {
    const sel = selectionLines(state)
    const opaqueLast = opaqueBlockLastLine(state, sel.last)
    const baseline = opaqueLast ?? sel.last
    const baselineFirst = opaqueLast ?? sel.first

    const placement = computePlacement(state, baselineFirst, baseline, false)
    const built = buildInsert(placement, plan.body)
    changes.push({ from: placement.from, to: placement.to, insert: built.insert })
    newCursor = placement.from + shift + built.leadLen + plan.body.length
  }

  dispatch(
    state.update({
      changes,
      selection: EditorSelection.cursor(newCursor),
      userEvent: 'input.template', // input.type 로 시작하지 않아 nextUndoGroup 이 새 묶음을 연다 (5.6)
      scrollIntoView: true,
    }),
  )

  return { inserted: true, frontmatterSkipped: plan.frontmatterSkipped }
}
