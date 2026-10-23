// 칸반 보드 입력칸 — CM6 로 편집기와 같은 자동 짝·`[[` 자동완성을 쓴다 (small 2026-10-15)
import { useEffect, useLayoutEffect, useRef } from 'react'
import { acceptCompletion, completionStatus } from '@codemirror/autocomplete'
import { markdown } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExt } from '@codemirror/view'
import { history, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'

import { autoPair } from '../editor/autoPair'
import { wikiContextField, type WikiContext } from '../editor/preview/wikiLinks'
import { wikiComplete } from '../editor/wikiComplete'
import { isImageFile, type OnImageFiles } from '../editor/imageInsert'
import { inlineImageInsert } from '../lib/kanbanImages'

type BoardInputProps = {
  className: string
  label: string
  placeholder?: string
  value: string
  select?: boolean
  // 카드 입력칸 — Shift+Enter 줄바꿈, 둘째 줄부터 Tab 들여쓰기 (small 2026-10-23)
  multiline?: { indent: string }
  wikiContext?: WikiContext
  // 카드 입력칸 이미지 붙여넣기·끌어 놓기 — 편집기와 같은 저장 콜백 (small 2026-10-24)
  onImageFiles?: OnImageFiles
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

const LIST_MARK_RE = /^([ \t]*)([-*+])[ \t]+(\[[ xX]\][ \t]+)?/

// 목록 줄이면 같은 표시로 잇고, 빈 항목이면 표시를 지운다
function newlineContinueList(view: EditorView): boolean {
  const { state } = view
  const range = state.selection.main
  const line = state.doc.lineAt(range.head)
  const m = LIST_MARK_RE.exec(line.text)
  if (m && range.empty && m[0].length === line.length) {
    view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from } })
    return true
  }
  const insert = '\n' + (m ? `${m[1]}${m[2]} ${m[3] ? '[ ] ' : ''}` : '')
  view.dispatch(state.update(state.replaceSelection(insert), { scrollIntoView: true, userEvent: 'input' }))
  return true
}

// 첫 줄(카드 글자)이 걸리면 들여쓰지 않고 Tab 을 포커스 이동에 넘긴다
const detailOnly = (run: (view: EditorView) => boolean) => (view: EditorView) =>
  view.state.selection.ranges.every((r) => view.state.doc.lineAt(Math.min(r.from, r.to)).number > 1) && run(view)

export default function BoardInput({ className, label, placeholder, value, select, multiline, wikiContext, onImageFiles, onChange, onComposing, onEnter, onEscape, onBlur }: BoardInputProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const composingRef = useRef(false)
  // 확장은 마운트 때 한 번 만든다 — 최신 핸들러는 이 거울로 부른다
  const handlers = useRef({ onChange, onComposing, onEnter, onEscape, onBlur, onImageFiles })
  useLayoutEffect(() => {
    handlers.current = { onChange, onComposing, onEnter, onEscape, onBlur, onImageFiles }
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
    // 저장이 끝나면 그때의 커서 자리에 넣는다 — 그 사이 입력칸이 닫혔으면 버린다
    const takeImages = (view: EditorView, files: File[], source: 'paste' | 'drop') => {
      const save = handlers.current.onImageFiles
      const images = files.filter(isImageFile)
      if (!save || images.length === 0) return false
      void Promise.resolve(save(images, { source })).then((attached) => {
        if (!alive || !attached?.length) return
        const pos = view.state.selection.main.head
        const insert = inlineImageInsert(view.state.doc.toString(), pos, attached)
        view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length }, userEvent: `input.${source}` })
      })
      return true
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
          multiline ? indentUnit.of(multiline.indent) : singleLine,
          // 긴 글이 칸 폭을 넘어 보드를 옆으로 키우지 않게 칸 안에서 접는다 (tweak 2026-10-15)
          EditorView.lineWrapping,
          history(),
          autoPair(),
          // 기본 Enter 목록 이어쓰기가 저장 Enter 를 가로채지 않게 끈다
          markdown({ addKeymap: false }),
          wikiContext ? wikiContextField.init(() => wikiContext) : wikiContextField,
          wikiComplete(),
          keymap.of([
            // 후보 창이 열려 있으면 Enter 는 후보 고르기 몫 — 열린 직후 75ms(interactionDelay)에 눌러도 카드로 넘기지 않는다
            { key: 'Enter', run: (view) => (completionStatus(view.state) === 'active' ? (acceptCompletion(view), true) : key(() => handlers.current.onEnter())(view)) },
            { key: 'Escape', run: key(() => handlers.current.onEscape()) },
            ...(multiline
              ? [
                  { key: 'Shift-Enter', run: (view: EditorView) => !view.composing && newlineContinueList(view) },
                  { key: 'Tab', run: detailOnly(indentMore) },
                  { key: 'Shift-Tab', run: detailOnly(indentLess) },
                ]
              : []),
            ...historyKeymap,
          ]),
          placeholder ? placeholderExt(placeholder) : [],
          EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': multiline ? 'true' : 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) handlers.current.onChange(u.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            paste: (e, view) => {
              const dt = e.clipboardData
              if (!dt || dt.getData('text/plain') || !takeImages(view, Array.from(dt.files ?? []), 'paste')) return false
              e.preventDefault()
              return true
            },
            drop: (e, view) => {
              if (!takeImages(view, Array.from(e.dataTransfer?.files ?? []), 'drop')) return false
              e.preventDefault()
              return true
            },
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
