import { useEffect, useRef, useState, type FormEvent } from 'react'
import Dialog from './Dialog'
import { listGrants, putGrant, deleteGrant, type Grant, type GrantRole, type GrantTargetType } from '../storage/docsApi'
import type { Notice } from './notice'

// D-4 사람 초대 (specs/features/F-225.md 2장). 공유 메뉴(문서)·폴더 ⋯ 메뉴에서 owner 일 때 연다
export type InviteTarget = { type: GrantTargetType; id: string; name: string } | null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HIGHLIGHT_DURATION = 1200

const ROLE_LABEL: Record<GrantRole, string> = { view: '보기', edit: '편집' }

function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

type InviteDialogProps = {
  target: InviteTarget
  onClose: () => void
  onNotice: (notice: Notice) => void
}

export default function InviteDialog({ target, onClose, onNotice }: InviteDialogProps) {
  const titleId = 'invite-title'
  const emailInputRef = useRef<HTMLInputElement | null>(null)
  const grantListRef = useRef<HTMLUListElement | null>(null)
  const highlightTimeoutRef = useRef<number | null>(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<GrantRole>('view')
  const [formError, setFormError] = useState(false)
  const [grants, setGrants] = useState<Grant[]>([])
  const [highlightEmail, setHighlightEmail] = useState<string | null>(null)
  const [highlightPhase, setHighlightPhase] = useState<'start' | 'fading'>('start')
  const pendingRemoveFocusIndexRef = useRef<number | null>(null)
  const [removalTick, setRemovalTick] = useState(0)

  // 대화상자를 다시 열 때(대상이 바뀔 때) 입력값을 되돌리고 현재 초대 목록을 다시 읽는다
  const [trackedTargetKey, setTrackedTargetKey] = useState<string | null>(null)
  const targetKey = target ? `${target.type}:${target.id}` : null
  if (targetKey !== trackedTargetKey) {
    setTrackedTargetKey(targetKey)
    setEmail('')
    setRole('view')
    setFormError(false)
    setGrants([])
    setHighlightEmail(null)
  }

  useEffect(() => {
    if (!target) return
    let cancelled = false
    listGrants(target.type, target.id)
      .then((list) => {
        // 응답이 JSON 이 아니면 readJson 이 null 을 돌려준다 — 빈 목록으로
        if (!cancelled) setGrants(Array.isArray(list) ? list : [])
      })
      .catch(() => {
        if (!cancelled) setGrants([])
      })
    return () => {
      cancelled = true
    }
  }, [target])

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    const index = pendingRemoveFocusIndexRef.current
    if (index === null) return
    pendingRemoveFocusIndexRef.current = null
    const list = grantListRef.current
    const buttons = list ? list.querySelectorAll<HTMLButtonElement>('.invite-grant-remove') : null
    const next = buttons && buttons.length > 0 ? buttons[Math.min(index, buttons.length - 1)] : null
    if (next) {
      next.focus()
    } else {
      emailInputRef.current?.focus()
    }
  }, [removalTick])

  function triggerHighlight(targetEmail: string) {
    if (reducedMotion()) return
    if (highlightTimeoutRef.current) window.clearTimeout(highlightTimeoutRef.current)
    setHighlightPhase('start')
    setHighlightEmail(targetEmail)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setHighlightPhase('fading')
      })
    })
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightEmail(null)
    }, HIGHLIGHT_DURATION)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!target) return
    const value = email.trim().toLowerCase()
    if (!EMAIL_RE.test(value)) {
      setFormError(true)
      return
    }
    setFormError(false)
    try {
      const result = await putGrant(target.type, target.id, value, role)
      setGrants((prev) => {
        const others = prev.filter((g) => g.email !== result.email)
        return [...others, { email: result.email, role: result.role, createdAt: Date.now() }].sort(
          (a, b) => a.createdAt - b.createdAt,
        )
      })
      setEmail('')
      emailInputRef.current?.focus()
      triggerHighlight(result.email)
      onNotice({
        type: 'info',
        message: `${result.email} 님에게 ${ROLE_LABEL[result.role]} 권한을 줬습니다. 앱 주소를 직접 알려 주세요.`,
      })
    } catch {
      setFormError(true)
    }
  }

  async function handleChangeRole(grantEmail: string, nextRole: GrantRole) {
    if (!target) return
    try {
      await putGrant(target.type, target.id, grantEmail, nextRole)
      setGrants((prev) => prev.map((g) => (g.email === grantEmail ? { ...g, role: nextRole } : g)))
      triggerHighlight(grantEmail)
    } catch {
      onNotice({ type: 'error', message: '역할을 바꾸지 못했습니다. 연결을 확인하세요.' })
    }
  }

  async function handleRemove(grantEmail: string) {
    if (!target) return
    const index = grants.findIndex((g) => g.email === grantEmail)
    try {
      await deleteGrant(target.type, target.id, grantEmail)
      setGrants((prev) => prev.filter((g) => g.email !== grantEmail))
      pendingRemoveFocusIndexRef.current = index
      setRemovalTick((t) => t + 1)
    } catch {
      onNotice({ type: 'error', message: '초대를 지우지 못했습니다. 연결을 확인하세요.' })
    }
  }

  const targetName = target ? (target.type === 'folder' ? `${target.name} 폴더` : target.name) : ''

  return (
    <Dialog open={Boolean(target)} onClose={onClose} titleId={titleId} initialFocusRef={emailInputRef} size="wide" describedById="invite-target-name">
      <h2 id={titleId}>사람 초대</h2>
      <p id="invite-target-name" className="invite-target">
        {targetName}
      </p>

      <form onSubmit={handleSubmit} className="invite-form">
        <div className="invite-bar">
          <div
            className={`invite-input-group${formError ? ' invite-input-group--error' : ''}`}
            aria-invalid={formError || undefined}
          >
            <input
              ref={emailInputRef}
              type="text"
              className="invite-email-input"
              placeholder="이메일 주소"
              aria-label="초대할 이메일"
              aria-describedby={formError ? 'invite-email-error' : undefined}
              aria-invalid={formError || undefined}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (formError) setFormError(false)
              }}
            />
            <div className="seg invite-role-seg" role="radiogroup" aria-label="권한">
              {(['view', 'edit'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={role === value}
                  onClick={() => setRole(value)}
                >
                  {ROLE_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" className="invite-submit">
            초대
          </button>
        </div>
      </form>
      {formError && (
        <p id="invite-email-error" className="invite-error">
          이메일 주소를 확인하세요.
        </p>
      )}

      <div className="invite-list-head">
        <span>
          볼 수 있는 사람 <strong className="invite-list-count">{grants.length}</strong>
        </span>
      </div>

      {grants.length === 0 ? (
        <p className="invite-empty">아직 초대한 사람이 없습니다.</p>
      ) : (
        <ul className="invite-grant-list" ref={grantListRef}>
          {grants.map((g) => {
            const highlightClass =
              g.email === highlightEmail
                ? highlightPhase === 'start'
                  ? ' invite-grant-row--highlight-start'
                  : ' invite-grant-row--highlight-fading'
                : ''
            return (
              <li key={g.email} className={`invite-grant-row${highlightClass}`}>
                <span className="invite-grant-email" title={g.email}>
                  {g.email}
                </span>
                <div className="seg invite-grant-role" role="radiogroup" aria-label={`${g.email} 권한`}>
                  {(['view', 'edit'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={g.role === value}
                      onClick={() => handleChangeRole(g.email, value)}
                    >
                      {ROLE_LABEL[value]}
                    </button>
                  ))}
                </div>
                <button type="button" className="invite-grant-remove" onClick={() => handleRemove(g.email)}>
                  삭제
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="invite-foot">
        <p className="invite-hint">같은 이메일의 Google 또는 GitHub 계정으로 로그인하면 사이드바 공유받음에 보입니다.</p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </Dialog>
  )
}
