import { useEffect, useRef, useState, type FormEvent } from 'react'
import Dialog from './Dialog'
import { listTokens, createToken, revokeToken, type ApiToken, type CreatedApiToken } from '../storage/apiTokensApi'

// D-5 API 토큰 (specs/features/F-222.md 2.4). 계정 메뉴 `API 토큰` 에서 연다
type ApiTokensDialogProps = {
  open: boolean
  onClose: () => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function ApiTokensDialog({ open, onClose }: ApiTokensDialogProps) {
  const titleId = 'api-tokens-title'
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [tokens, setTokens] = useState<ApiToken[]>([])
  const [name, setName] = useState('')
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 대화상자를 닫으면 원문·입력·확인 상태가 사라진다 (F-222 2.4) — InviteDialog 와 같은 방식으로 렌더 중 되돌린다
  const [trackedOpen, setTrackedOpen] = useState(false)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (!open) {
      setCreated(null)
      setName('')
      setConfirmingId(null)
      setFormError(null)
      setCopied(false)
    }
  }

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listTokens()
      .then((list) => {
        if (!cancelled) setTokens(list)
      })
      .catch(() => {
        if (!cancelled) setTokens([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const value = name.trim()
    if (!value) return
    setFormError(null)
    try {
      const result = await createToken(value)
      setTokens((prev) => [{ id: result.id, name: result.name, prefix: result.prefix, createdAt: result.createdAt, lastUsedAt: result.lastUsedAt }, ...prev])
      setCreated(result)
      setName('')
    } catch (err) {
      const kind = (err as { kind?: string } | null)?.kind
      if (kind === 'too_many') {
        setFormError('토큰은 10개까지 만들 수 있습니다. 쓰지 않는 토큰을 폐기하세요.')
      } else {
        setFormError('토큰을 만들지 못했습니다. 잠시 뒤 다시 시도하세요.')
      }
    }
  }

  async function handleCopy() {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.token)
    } catch {
      return
    }
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
  }

  async function handleRevoke(id: string) {
    try {
      await revokeToken(id)
      setTokens((prev) => prev.filter((t) => t.id !== id))
    } catch {
      // 지우지 못했으면 목록에 남겨 다시 시도할 수 있게 한다
    }
    setConfirmingId(null)
  }

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId} initialFocusRef={nameInputRef}>
      <h2 id={titleId}>API 토큰</h2>
      <p>스크립트나 자동화 도구가 이 계정으로 문서를 올릴 때 씁니다. 토큰을 가진 사람은 내 문서를 읽고 고칠 수 있습니다.</p>

      {created && (
        <div className="api-token-created">
          <div className="api-token-created-row">
            <input type="text" readOnly value={created.token} className="api-token-value" aria-label="새 토큰" />
            <button type="button" onClick={handleCopy}>
              {copied ? '복사됨' : '복사'}
            </button>
          </div>
          <p className="api-token-warning">이 토큰은 지금만 볼 수 있습니다. 안전한 곳에 보관하세요.</p>
          <pre className="api-token-example">
            <code>{`curl -H "Authorization: Bearer ${created.token}" ${location.origin}/v1/docs`}</code>
          </pre>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="dialog-field">
          <span id="api-token-name-label">이름</span>
          <input
            ref={nameInputRef}
            type="text"
            className="api-token-name-input"
            aria-labelledby="api-token-name-label"
            placeholder="예: 교안 자동 업로드"
            maxLength={40}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (formError) setFormError(null)
            }}
          />
          {formError && <p className="invite-error">{formError}</p>}
        </div>
        <div className="dialog-actions">
          <button type="submit" disabled={!name.trim()}>
            토큰 만들기
          </button>
        </div>
      </form>

      {tokens.length === 0 ? (
        <p>아직 만든 토큰이 없습니다.</p>
      ) : (
        <ul className="api-token-list">
          {tokens.map((t) => (
            <li key={t.id} className="api-token-row">
              {confirmingId === t.id ? (
                <div className="api-token-confirm">
                  <span>폐기하면 이 토큰을 쓰는 스크립트가 멈춥니다.</span>
                  <div className="dialog-actions">
                    <button type="button" onClick={() => setConfirmingId(null)}>
                      취소
                    </button>
                    <button type="button" className="danger" onClick={() => handleRevoke(t.id)}>
                      폐기
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <span className="api-token-name">{t.name}</span>
                  <span className="api-token-prefix">{t.prefix}…</span>
                  <span className="api-token-meta">만든 날 {formatDate(t.createdAt)}</span>
                  <span className="api-token-meta">
                    {t.lastUsedAt ? `마지막 사용 ${formatDate(t.lastUsedAt)}` : '사용 안 함'}
                  </span>
                  <button type="button" className="api-token-revoke" onClick={() => setConfirmingId(t.id)}>
                    폐기
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="dialog-actions">
        <button type="button" onClick={onClose}>
          닫기
        </button>
      </div>
    </Dialog>
  )
}
