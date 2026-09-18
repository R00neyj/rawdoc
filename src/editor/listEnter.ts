// 빈 목록 항목 Enter (specs/features/F-245.md 6.2~6.3) — insertNewlineContinueMarkup 은 항목이 정확히 2개인 tight 목록의 마지막 빈 항목에서 Enter 를 받으면 목록을 끝내지 않고 loose 로 바꿔 빈 줄을 남긴다
import { insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'
import { EditorSelection } from '@codemirror/state'
import type { StateCommand, Transaction } from '@codemirror/state'

// nonTightLists:false 는 그 "loose 로 바꾸는" 분기만 끄고, 다른 항목 수·비어 있지 않은 항목·이미 loose 인 목록 이어쓰기는 insertNewlineContinueMarkup 과 똑같이 동작한다
const continueListRaw = insertNewlineContinueMarkupCommand({ nonTightLists: false })

// F-253 3.1~3.2 — lang-markdown dist/index.js 의 nonTightList 분기(설정 없음)가 이미 loose 인 목록에 삽입문 앞에 "빈 줄 + 줄바꿈" 을 얹는다. 그 접두사만 걷어낸다
function stripLoosePrefix(insert: string, lineBreak: string): string {
  if (!insert.startsWith(lineBreak)) return insert
  const rest = insert.slice(lineBreak.length)
  const secondBreak = rest.indexOf(lineBreak)
  if (secondBreak === -1) return insert
  const blankLine = rest.slice(0, secondBreak)
  if (!/^[ \t>]*$/.test(blankLine)) return insert
  return lineBreak + rest.slice(secondBreak + lineBreak.length)
}

// 명령을 감싸 dispatch 를 가로챈다 — 실제 트랜잭션을 그대로 내보내지 않고 접두사를 뗀 changes·selection 으로 다시 만든다 (F-253 3.2)
export const insertNewlineContinueList: StateCommand = (target) => {
  let intercepted: Transaction | null = null
  const ran = continueListRaw({
    state: target.state,
    dispatch: (tr) => {
      intercepted = tr
    },
  })
  if (!ran || !intercepted) return ran

  const tr: Transaction = intercepted
  const { state } = target
  const lineBreak = state.lineBreak
  const specs: { from: number; to: number; insert: string }[] = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    specs.push({ from: fromA, to: toA, insert: stripLoosePrefix(inserted.toString(), lineBreak) })
  })
  const newChanges = state.changes(specs)
  // invertedDesc 로 원문 좌표로 되돌린 뒤 newChanges 로 다시 앞으로 매핑한다 — assoc=1 은 커서가 삽입 기호 뒤에 있었다는 뜻을 유지한다
  const backToStart = tr.changes.invertedDesc
  const newSelection = EditorSelection.create(
    tr.newSelection.ranges.map((range) =>
      EditorSelection.range(
        newChanges.mapPos(backToStart.mapPos(range.anchor, 1), 1),
        newChanges.mapPos(backToStart.mapPos(range.head, 1), 1),
      ),
    ),
    tr.newSelection.mainIndex,
  )
  target.dispatch(state.update({ changes: newChanges, selection: newSelection, scrollIntoView: true, userEvent: 'input' }))
  return true
}
