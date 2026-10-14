// 보드 입력칸에 편집기와 같은 자동 짝 기호(F-127) — 한글 조합 중에는 손대지 않는다
import { useEffect, type RefObject } from 'react'
import type { EditorState } from '@codemirror/state'

import { fieldPairBackspace, fieldPairInput, syncField, type FieldPair } from '../editor/autoPairField'

export function useFieldAutoPair(ref: RefObject<HTMLInputElement | null>, composingRef: RefObject<boolean>) {
  useEffect(() => {
    const input = ref.current
    if (!input) return
    let state: EditorState | null = null
    const current = () => (state = syncField(state, input.value, input.selectionStart ?? 0, input.selectionEnd ?? 0))
    // setRangeText 는 React 값 추적을 비켜 가 이어 보내는 input 이벤트가 onChange 로 이어진다
    const apply = (paired: FieldPair | null, e: Event) => {
      if (!paired) return
      e.preventDefault()
      state = paired.state
      const { from, to, insert, selStart, selEnd } = paired.edit
      if (from !== to || insert !== '') {
        input.setRangeText(insert, from, to)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      input.setSelectionRange(selStart, selEnd)
    }
    const onBeforeInput = (e: InputEvent) => {
      if (e.isComposing || composingRef.current || e.inputType !== 'insertText' || !e.data) return
      apply(fieldPairInput(current(), e.data), e)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' || e.isComposing || e.keyCode === 229 || composingRef.current) return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      apply(fieldPairBackspace(current()), e)
    }
    input.addEventListener('beforeinput', onBeforeInput)
    input.addEventListener('keydown', onKeyDown)
    return () => {
      input.removeEventListener('beforeinput', onBeforeInput)
      input.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, composingRef])
}
