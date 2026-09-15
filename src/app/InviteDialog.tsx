import { useEffect, useRef, useState, type FormEvent } from 'react'
import Dialog from './Dialog'
import { listGrants, putGrant, deleteGrant, type Grant, type GrantRole, type GrantTargetType } from '../storage/docsApi'
import type { Notice } from './notice'

// D-4 사람 초대 (specs/features/F-212.md 2.5). 공유 메뉴(문서)·폴더 ⋯ 메뉴에서 owner 일 때 연다
export type InviteTarget = { type: GrantTargetType; id: string; name: string } | null

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ROLE_LABEL: Record<GrantRole, string> = { view: '보기', edit: '편집' }

type InviteDialogProps = {
  target: InviteTarget
  onClose: () => void
  onNotice: (notice: Notice) => void
}

export default function InviteDialog({ target, onClose, onNotice }: InviteDialogProps) {
  const titleId = 'invite-title'
  const emailInputRef = useRef<HTMLInputElement | null>(null)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<GrantRole>('view')
  const [formError, setFormError] = useState(false)
  const [grants, setGrants] = useState<Grant[]>([])

  // 대화상자를 다시 열 때(대상이 바뀔 때) 입력값을 되돌리고 현재 초대 목록을 다시 읽는다
  const [trackedTargetKey, setTrackedTargetKey] = useState<string | null>(null)
  const targetKey = target ? `${target.type}:${target.id}` : null
  if (targetKey !== trackedTargetKey) {
    setTrackedTargetKey(targetKey)
    setEmail('')
    setRole('view')
    setFormError(false)
    setGrants([])
  }

  useEffect(() => {
    if (!target) return
    let cancelled = false
    listGrants(target.type, target.id)
      .then((list) => {
        if (!cancelled) setGrants(list)
      })
      .catch(() => {
        if (!cancelled) setGrants([])
      })
    return () => {
      cancelled = true
    }
  }, [target])

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
    } catch {
      onNotice({ type: 'error', message: '역할을 바꾸지 못했습니다. 연결을 확인하세요.' })
    }
  }

  async function handleRemove(grantEmail: string) {
    if (!target) return
    try {
      await deleteGrant(target.type, target.id, grantEmail)
      setGrants((prev) => prev.filter((g) => g.email !== grantEmail))
    } catch {
      onNotice({ type: 'error', message: '초대를 지우지 못했습니다. 연결을 확인하세요.' })
    }
  }

  return (
    <Dialog open={Boolean(target)} onClose={onClose} titleId={titleId} initialFocusRef={emailInputRef}>
      <h2 id={titleId}>사람 초대</h2>
      <form onSubmit={handleSubmit}>
        <div className="dialog-field">
          <span id="invite-email-label">이메일</span>
          <input
            ref={emailInputRef}
            type="text"
            className="invite-email-input"
            aria-labelledby="invite-email-label"
            aria-describedby={formError ? 'invite-email-error' : undefined}
            aria-invalid={formError || undefined}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (formError) setFormError(false)
            }}
          />
          {formError && (
            <p id="invite-email-error" className="invite-error">
              이메일 주소를 확인하세요.
            </p>
          )}
        </div>
        <div className="dialog-field">
          <span id="invite-role-label">권한</span>
          <div className="seg" role="radiogroup" aria-labelledby="invite-role-label">
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
        <div className="dialog-actions">
          <button type="submit">초대</button>
        </div>
      </form>

      {grants.length > 0 && (
        <ul className="invite-grant-list">
          {grants.map((g) => (
            <li key={g.email} className="invite-grant-row">
              <span className="invite-grant-email">{g.email}</span>
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
