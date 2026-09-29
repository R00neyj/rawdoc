import { useLayoutEffect, useRef, useState } from 'react'
import Dialog from './Dialog'
import { createUserCssEditor } from './userCssEditor'
import { compileCached } from './userCssApply'
import { editableSnippets, saveUserCssSnippets } from './userCssStore'
import { flushUserCssPush } from './userCssSync'
import { USER_CSS_SAFE_LINE, cleanSnippetName, replaceSnippet, userCssSaveMessage, userCssStatusLines } from './userCssEdit'
import { USER_CSS_MAX_NAME_LENGTH, utf8ByteLength, type UserCssSnippet } from '../lib/userCssPolicy'

const SAVE_DELAY_MS = 400

function statusFor(css: string, enabled: boolean): string[] {
  const lines = userCssStatusLines(compileCached(css), enabled)
  return document.documentElement.getAttribute('data-user-css') === 'safe' ? [USER_CSS_SAFE_LINE, ...lines] : lines
}

function readInitial(accountId: string | null, id: string): { snippet: UserCssSnippet; otherBytes: number } | null {
  const local = editableSnippets(accountId)
  const snippet = local.find((s) => s.id === id)
  if (!snippet) return null
  const otherBytes = local.reduce((sum, s) => (s.id === id ? sum : sum + utf8ByteLength(s.css)), 0)
  return { snippet, otherBytes }
}

// D-16 CSS 편집 — 열 때 원문을 한 번 읽고, 400ms 뒤·닫을 때 저장한다 (specs/features/F-2096.md 4장)
export default function UserCssEditDialog({ accountId, snippetId, onClose }: { accountId: string | null; snippetId: string; onClose: () => void }) {
  const [initial] = useState(() => readInitial(accountId, snippetId))
  const [open, setOpen] = useState(true)
  const [nameDraft, setNameDraft] = useState(initial?.snippet.name ?? '')
  const [status, setStatus] = useState(() => (initial ? statusFor(initial.snippet.css, initial.snippet.enabled) : []))
  const [error, setError] = useState('')
  const hostRef = useRef<HTMLDivElement | null>(null)
  const focusRef = useRef<HTMLElement | null>(null)
  const nameRef = useRef(initial?.snippet.name ?? '')
  const flushRef = useRef<() => void>(() => {})
  const scheduleRef = useRef<() => void>(() => {})
  const closedRef = useRef(false)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!initial || !host) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let dirty = false
    const flush = () => {
      clearTimeout(timer)
      if (!dirty) return
      dirty = false
      const local = editableSnippets(accountId)
      const cur = local.find((s) => s.id === snippetId)
      const next = cur && { ...cur, css: view.state.doc.toString(), name: nameRef.current, updatedAt: Date.now() }
      const list = next ? replaceSnippet(local, next) : null
      if (!next || !list) {
        if (!closedRef.current) setOpen(false)
        return
      }
      if (next.css === cur.css && next.name === cur.name) return
      const result = saveUserCssSnippets(accountId, list)
      setError(result === 'ok' ? '' : userCssSaveMessage(result))
      setStatus(statusFor(next.css, next.enabled))
    }
    const schedule = () => {
      dirty = true
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!view.composing) flush()
      }, SAVE_DELAY_MS)
    }
    const view = createUserCssEditor({
      parent: host,
      doc: initial.snippet.css,
      otherBytes: initial.otherBytes,
      onDocChange: schedule,
      onTooLarge: () => setError(userCssSaveMessage('bytes')),
    })
    const onCompositionEnd = () => {
      if (dirty) schedule()
    }
    view.contentDOM.addEventListener('compositionend', onCompositionEnd)
    focusRef.current = view.contentDOM
    flushRef.current = flush
    scheduleRef.current = schedule
    return () => {
      clearTimeout(timer)
      view.destroy()
      focusRef.current = null
      flushRef.current = () => {}
    }
  }, [initial, snippetId, accountId])

  function handleNameChange(raw: string) {
    setNameDraft(raw)
    const clean = cleanSnippetName(raw)
    if (clean === '') return
    nameRef.current = clean
    scheduleRef.current()
  }

  function handleClosed() {
    if (closedRef.current) return
    closedRef.current = true
    flushRef.current()
    flushUserCssPush()
    onClose()
  }

  if (!initial) return null
  return (
    <Dialog open={open} onClose={handleClosed} titleId="user-css-edit-title" size="xwide" initialFocusRef={focusRef}>
      <h2 id="user-css-edit-title">CSS 편집</h2>
      <label className="user-css-edit-name">
        <span>이름</span>
        <input type="text" maxLength={USER_CSS_MAX_NAME_LENGTH} value={nameDraft} onChange={(e) => handleNameChange(e.target.value)} />
      </label>
      {cleanSnippetName(nameDraft) === '' && <p className="dialog-note user-css-name-problem">이름을 입력하세요.</p>}
      <span id="user-css-edit-css-label" className="user-css-edit-label">
        CSS
      </span>
      <div ref={hostRef} className="user-css-editor" />
      <p className="user-css-status" aria-live="polite">
        {status.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </p>
      {error && (
        <p className="user-css-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" onClick={() => setOpen(false)}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
