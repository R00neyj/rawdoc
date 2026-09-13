// 조합 종료 재계산 신호 (specs/features/F-103.md 3.2, CLAUDE.md 불변조건)
//
// IME 조합 중 재계산을 보류하는 확장(F-104 이후)이 있다면, compositionend 시점에
// 밀린 재계산을 반드시 따라잡아야 한다. compositionend 는 그 자체로 문서도 선택도
// 바꾸지 않으므로, 이 신호가 없으면 다음 사용자 조작이 올 때까지 화면이 낡은 채로
// 남는다 (.workflow/architecture.md 3장, .workflow/tasks/T-004/verify.md 6.5·7장).
//
// 또한 compositionstart 시점의 view.composing 은 false 다 — true 인 것은
// compositionStarted 뿐이다. 즉 composing 을 기준으로 보류를 걸면 조합 진입 직후
// 첫 update 1건은 보류를 타지 않고 통과한다 (.workflow/architecture.md 3장).
// spike 의 검증 전용 로그 장치는 옮기지 않는다 — CLAUDE.md 불변조건.
import { StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** 조합이 끝났으니 밀린 재계산을 지금 하라는 신호 */
export const forceRecalc = StateEffect.define()

/** @param {EditorView} view */
export function isComposing(view) {
  return !!view?.composing
}

/**
 * update(ViewUpdate) 나 transaction(Transaction) 어느 쪽이든 forceRecalc effect 를
 * 담고 있는지 본다.
 * @param {{transactions:import('@codemirror/state').Transaction[]}|import('@codemirror/state').Transaction} updateOrTransaction
 */
export function isForced(updateOrTransaction) {
  const transactions = updateOrTransaction?.transactions ?? [updateOrTransaction]
  return transactions.some((tr) => tr?.effects?.some((e) => e.is(forceRecalc)))
}

/**
 * compositionend 뒤 한 틱 지나 forceRecalc 를 dispatch 한다.
 * compositionend 시점엔 CM6 가 DOM 정리를 끝냈다는 보장이 없어 setTimeout(0) 으로 미룬다.
 * @param {() => boolean} isDestroyed 이미 destroy() 된 뷰에 dispatch 하지 않기 위한 확인
 */
export function compositionCatchup(isDestroyed) {
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
