// D-20 GitHub 당기기 — 합치기 편집기와 덩어리 고르기, 지연 조각 (specs/features/F-2129.md 5장)
import { useEffect, useRef, useState } from 'react'
import { defaultKeymap, history, historyKeymap, invertedEffects } from '@codemirror/commands'
import { getChunks, getOriginalDoc, unifiedMergeView, updateOriginalDoc } from '@codemirror/merge'
import { ChangeSet, EditorState, type StateEffect } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import Dialog from './Dialog'
import { MERGE_COLLAPSE, MERGE_DIFF_CONFIG, mergeChanges } from './githubMerge'
import type { GithubPullCompare, GithubPullDialogProps } from './useGithubPull'

function chunkButton(type: 'accept' | 'reject', action: (e: MouseEvent) => void): HTMLElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.className = 'github-pull-chunk-btn'
  b.textContent = type === 'accept' ? '내 것 유지' : 'GitHub 것으로'
  b.addEventListener('mousedown', action)
  // 키보드로 누른 click(detail 0)만 — 마우스는 mousedown 에서 이미 처리했다
  b.addEventListener('click', (e) => { if (e.detail === 0) action(e) })
  return b
}

// 라이브러리의 덩어리 수락은 원본만 바꿔 기록에 남지 않는다 — 되돌릴 수 있게 역효과를 단다
const undoableAccept = invertedEffects.of((tr) => {
  const out: StateEffect<unknown>[] = []
  const before = getOriginalDoc(tr.startState)
  for (const e of tr.effects) if (e.is(updateOriginalDoc)) out.push(updateOriginalDoc.of({ doc: before, changes: e.value.changes.invert(before) }))
  return out
})

function acceptAll(view: EditorView) {
  const chunks = getChunks(view.state)?.chunks ?? []
  if (chunks.length === 0) return
  const { state } = view
  const orig = getOriginalDoc(state)
  const specs = chunks.map((ch) => {
    let insert = state.sliceDoc(ch.fromB, Math.max(ch.fromB, ch.toB - 1))
    if (ch.fromB !== ch.toB && ch.toA <= orig.length) insert += state.lineBreak
    return { from: ch.fromA, to: Math.min(orig.length, ch.toA), insert }
  })
  const changes = ChangeSet.of(specs, orig.length)
  view.dispatch({ effects: updateOriginalDoc.of({ doc: changes.apply(orig), changes }), userEvent: 'accept' })
}

function rejectAll(view: EditorView) {
  const chunks = getChunks(view.state)?.chunks ?? []
  if (chunks.length === 0) return
  const { state } = view
  const orig = getOriginalDoc(state)
  const changes = chunks.map((ch) => {
    let insert = orig.sliceString(ch.fromA, Math.max(ch.fromA, ch.toA - 1))
    if (ch.fromA !== ch.toA && ch.toB <= state.doc.length) insert += state.lineBreak
    return { from: ch.fromB, to: Math.min(state.doc.length, ch.toB), insert }
  })
  view.dispatch({ changes, userEvent: 'revert' })
}

function createMergeView(parent: HTMLElement, c: GithubPullCompare): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: c.base,
      extensions: [
        unifiedMergeView({
          original: c.remote.text,
          mergeControls: chunkButton,
          diffConfig: MERGE_DIFF_CONFIG,
          collapseUnchanged: MERGE_COLLAPSE,
          syntaxHighlightDeletions: false,
        }),
        undoableAccept,
        EditorView.lineWrapping,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.contentAttributes.of({ 'aria-label': '합친 결과' }),
      ],
    }),
  })
}

export default function GithubPullDialog({ state, onCancel, onApply }: GithubPullDialogProps) {
  const compare = state?.phase === 'compare' ? state : null
  const busy = compare?.busy === true
  const buildKey = compare ? `${compare.docId}:${compare.key}` : null
  const [readyKey, setReadyKey] = useState<string | null>(null)
  const ready = buildKey !== null && readyKey === buildKey
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const compareRef = useRef(compare)
  const busyRef = useRef(busy)
  useEffect(() => {
    compareRef.current = compare
    busyRef.current = busy
  })

  // 덩어리 계산이 최대 0.6초 동기로 돈다 — 받는 중 문구가 그려진 다음 프레임에 만든다 (5장)
  useEffect(() => {
    if (buildKey === null) return
    let view: EditorView | null = null
    let timer = 0
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        const c = compareRef.current
        if (!c || !hostRef.current) return
        view = createMergeView(hostRef.current, c)
        viewRef.current = view
        setReadyKey(buildKey)
        view.focus()
      }, 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      view?.destroy()
      viewRef.current = null
      setReadyKey(null)
    }
  }, [buildKey])

  // 적용 중에는 바깥 클릭으로도 닫히지 않게 대화상자 click 을 먼저 가로챈다
  useEffect(() => {
    const dialog = titleRef.current?.closest('dialog')
    if (!dialog) return
    const block = (e: MouseEvent) => {
      if (busyRef.current && e.target === dialog) e.stopImmediatePropagation()
    }
    dialog.addEventListener('click', block, true)
    return () => dialog.removeEventListener('click', block, true)
  }, [])

  function apply() {
    const view = viewRef.current
    if (!compare || !view || busy || view.composing) return
    const result = view.state.doc.toString()
    onApply({ result, changes: mergeChanges(compare.base, result) })
  }

  return (
    <Dialog
      open={state !== null}
      onClose={onCancel}
      titleId="github-pull-title"
      size="xwide"
      initialFocusRef={cancelRef}
      onCancel={(e) => { if (busyRef.current) e.preventDefault() }}
    >
      <h2 id="github-pull-title" ref={titleRef}>GitHub에서 당기기</h2>
      {!ready && <p className="dialog-note">GitHub에서 받는 중…</p>}
      {compare && (
        <>
          <p className="dialog-note">바뀐 부분마다 고르세요. 고르지 않은 부분은 지금 내용을 유지합니다.</p>
          {compare.note && <p className="dialog-note github-pull-note">{compare.note}</p>}
          {compare.status && <p className="dialog-note" role="status">{compare.status}</p>}
          {compare.error && <p className="dialog-note github-error" role="alert">{compare.error}</p>}
          <div className="github-pull-merge" ref={hostRef} />
        </>
      )}
      <div className="dialog-actions github-pull-actions">
        {compare && (
          <span className="github-pull-bulk">
            <button type="button" disabled={!ready || busy} onClick={() => viewRef.current && acceptAll(viewRef.current)}>모두 내 것</button>
            <button type="button" disabled={!ready || busy} onClick={() => viewRef.current && rejectAll(viewRef.current)}>모두 GitHub 것</button>
          </span>
        )}
        <button type="button" ref={cancelRef} disabled={busy} onClick={onCancel}>취소</button>
        {compare && (
          <button type="button" className="primary" disabled={!ready || busy} onClick={apply}>
            {busy ? '적용하는 중…' : '적용'}
          </button>
        )}
      </div>
    </Dialog>
  )
}
