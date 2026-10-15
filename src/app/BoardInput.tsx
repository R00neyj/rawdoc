// 칸반 보드 한 줄 입력칸 — CM6 로 편집기와 같은 자동 짝·`[[` 자동완성을 쓴다 (small 2026-10-15)
import { useEffect, useLayoutEffect, useRef } from 'react'
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { history, historyKeymap } from '@codemirror/commands'

import { autoPair } from '../editor/autoPair'
import { wikiContextField, type WikiContext } from '../editor/preview/wikiLinks'
import { wikiComplete } from '../editor/wikiComplete'

type BoardInputProps = {
  className: string
  label: string
  placeholder?: string
  value: string
  select?: boolean
  wikiContext?: WikiContext
  onChange: (value: string) => void
  onComposing: (composing: boolean) => void
  onEnter: () => void
  onEscape: () => void
  onBlur: () => void
}

// 붙여넣은 줄바꿈은 공백으로 — 카드·칸 이름은 원문 한 줄이다
const singleLine = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.newDoc.lines === 1) return tr
  const text = tr.newDoc.toString()
  const changes: { from: number; to: number; insert: string }[] = []
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) changes.push({ from: i, to: i + 1, insert: ' ' })
  return [tr, { changes, sequential: true }]
})

export default function BoardInput({ className, label, placeholder, value, select, wikiContext, onChange, onComposing, onEnter, onEscape, onBlur }: BoardInputProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const composingRef = useRef(false)
  // 확장은 마운트 때 한 번 만든다 — 최신 핸들러는 이 거울로 부른다
  const handlers = useRef({ onChange, onComposing, onEnter, onEscape, onBlur })
  useLayoutEffect(() => {
    handlers.current = { onChange, onComposing, onEnter, onEscape, onBlur }
  })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    // StrictMode 재마운트·해제 때 destroy 가 내는 blur 는 사용자가 떠난 것이 아니다
    let alive = true
    const setComposing = (composing: boolean) => {
      if (composingRef.current === composing) return
      composingRef.current = composing
      handlers.current.onComposing(composing)
    }
    const key = (run: () => void) => (view: EditorView) => {
      if (view.composing) return false
      run()
      return true
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        selection: select ? EditorSelection.range(0, value.length) : EditorSelection.cursor(value.length),
        extensions: [
          singleLine,
          history(),
          autoPair(),
          markdown(),
          wikiContext ? wikiContextField.init(() => wikiContext) : wikiContextField,
          wikiComplete(),
          keymap.of([
            // 후보 창이 열려 있으면 Enter 는 후보 고르기 몫 — 열린 직후 75ms(interactionDelay)에 눌러도 카드로 넘기지 않는다
            { key: 'Enter', run: (view) => (completionStatus(view.state) === 'active' ? (acceptCompletion(view), true) : key(() => handlers.current.onEnter())(view)) },
            { key: 'Escape', run: key(() => handlers.current.onEscape()) },
            ...historyKeymap,
          ]),
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            compositionstart: () => setComposing(true),
            compositionend: () => setComposing(false),
            keydown: (e) => {
              // 보드의 Enter·Esc·방향키 처리로 새지 않게 한다
              if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation()
              return false
            },
            blur: () => {
              if (!alive) return
              setComposing(false)
              handlers.current.onBlur()
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    return () => {
      // 조합 중에 사라지면 compositionend 가 오지 않는다 — 게이트 보류가 남지 않게 끝을 알린다
      if (composingRef.current) handlers.current.onComposing(false)
      viewRef.current = null
      alive = false
      view.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번만 만든다
  }, [])

  // 카드를 넣은 뒤 비우기처럼 바깥에서 값을 바꾸면 따라간다
  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, selection: { anchor: value.length } })
  }, [value])

  return <div ref={hostRef} className={className} />
}
