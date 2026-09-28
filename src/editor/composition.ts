// 조합 종료 재계산 신호 — compositionend 는 문서·선택을 안 바꾸므로 이 신호 없으면 화면이 낡은 채로 남는다(F-103 3.2, CLAUDE.md 불변조건)
// compositionstart 시점엔 view.composing 이 아직 false 라 조합 진입 직후 첫 update 는 보류를 안 탄다(.workflow/architecture.md 3장)
import type { EditorState, Transaction } from '@codemirror/state'
import { StateEffect } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { insertNewlineContinueList } from './listEnter'

// 조합이 끝났으니 밀린 재계산을 지금 하라는 신호
export const forceRecalc = StateEffect.define<null>()

export function isComposing(view: EditorView | undefined | null): boolean {
  return !!view?.composing
}

// update(ViewUpdate) 나 transaction(Transaction) 어느 쪽이든 forceRecalc effect 를 담고 있는지 본다
export function isForced(updateOrTransaction: ViewUpdate | Transaction): boolean {
  const transactions: readonly Transaction[] =
    'transactions' in updateOrTransaction ? updateOrTransaction.transactions : [updateOrTransaction]
  return transactions.some((tr) => tr?.effects?.some((e) => e.is(forceRecalc)))
}

type ComposingEnterTarget = { composing: boolean; state: EditorState; dispatch: (tr: Transaction) => void }
type ComposingEnterEvent = {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  preventDefault: () => void
}

// CM6 는 composing 중 keydown 을 전부 건너뛰어(view 내부 ignoreDuringComposition) markdownKeymap 의 Enter 가 안 불린다 — 같은 명령을 여기서 직접 불러 조합 여부와 무관하게 같은 결과를 낸다 (F-245)
export function handleComposingEnter(target: ComposingEnterTarget, event: ComposingEnterEvent): boolean {
  if (!target.composing) return false
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false
  event.preventDefault()
  insertNewlineContinueList(target)
  return true
}

// contentDOM 에 캡처 단계로 직접 붙인다 — EditorView.domEventHandlers 는 같은 ignoreDuringComposition 게이트를 타 조합 중엔 안 불린다
export function attachComposingEnterGuard(view: EditorView): () => void {
  const handler = (event: KeyboardEvent) => {
    handleComposingEnter(view, event)
  }
  view.contentDOM.addEventListener('keydown', handler, true)
  return () => view.contentDOM.removeEventListener('keydown', handler, true)
}

// compositionend 뒤 한 틱 지나 forceRecalc dispatch — DOM 정리 끝났다는 보장이 없어 setTimeout(0) 으로 미룬다
// isDestroyed: 이미 destroy() 된 뷰에 dispatch 하지 않기 위한 확인
export function compositionCatchup(isDestroyed: () => boolean): Extension {
  return EditorView.domEventHandlers({
    compositionend: (_event, view) => {
      setTimeout(() => {
        if (isDestroyed()) return
        view.dispatch({ effects: forceRecalc.of(null) })
      }, 0)
      return false
    },
  })
}
