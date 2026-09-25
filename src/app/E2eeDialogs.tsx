// 금고 대화상자 — D-8 만들기, D-11 열기(+복구), D-12 암호 바꾸기, D-13 초기화, 잠금 해제 폼 (specs/features/F-404.md 7장)
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Dialog from './Dialog'
import { downloadBlob } from './exportDoc'
import { isE2eePasswordLongEnough } from '../lib/e2eeLimits'
import type { E2eeActionError, E2eeScope, Keyring } from '../e2ee/keyring'

function samePassword(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC')
}

// 7.9 표 — 오류 코드 → 대화상자 오류 줄. D-12 의 wrong-password 는 호출부가 따로 바꾼다
const ERROR_TEXT: Record<E2eeActionError, string> = {
  'wrong-password': '암호가 맞지 않습니다.',
  'wrong-recovery-code': '복구 코드가 맞지 않습니다.',
  'password-too-short': '10자 이상 입력하세요.',
  'vault-exists': '다른 탭이나 기기에서 이미 금고를 만들었습니다. 그 금고의 암호로 여세요.',
  conflict: '다른 탭이나 기기에서 금고가 바뀌었습니다. 처음부터 다시 해 주세요.',
  'no-vault': '다른 탭이나 기기에서 금고를 없앴습니다.',
  'vault-not-empty': '', // 7.4 가 docs·folders 를 넣어 따로 만든다
  offline: '인터넷에 연결되어 있지 않아 저장하지 못했습니다. 연결한 뒤 다시 누르세요.',
  'rate-limited': '요청이 많아 저장하지 못했습니다. 잠시 뒤 다시 누르세요.',
  'account-blocked': '이 계정은 운영자가 쓰기를 막아 금고를 만들거나 바꿀 수 없습니다.',
  'bad-bundle': '금고 정보가 손상되어 열 수 없습니다.',
  'unsupported-version': '이 버전의 앱으로는 열 수 없는 금고입니다. 새로고침해 새 버전을 받으세요.',
  failed: '금고 정보를 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.',
}

// 읽기로 시작하는 동작(열기·만들기 1단계·복구 확인)에만 쓴다 — 쓰기 동작은 ERROR_TEXT 를 그대로 쓴다(7.9 offline 줄)
function readErrorText(error: E2eeActionError): string {
  return error === 'offline' ? '인터넷에 연결되어 있지 않아 금고 정보를 불러오지 못했습니다.' : ERROR_TEXT[error]
}

function recoveryFileContent(code: string, scope: E2eeScope, accountEmail: string | null): string {
  const scopeLine = scope.kind === 'account' ? `계정: ${accountEmail ?? '계정 금고'}` : '로그인 전 이 브라우저의 금고'
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return [
    '금고 복구 코드',
    code,
    '',
    scopeLine,
    `만든 날: ${y}-${m}-${d}`,
    '',
    '금고 암호를 잊었을 때 이 코드로 금고를 열고 새 암호를 정할 수 있습니다.',
    '이 코드를 가진 사람은 금고 문서를 열 수 있습니다. 다른 사람에게 보여 주지 마세요.',
    '',
  ].join('\n')
}

function RecoveryCodeStep({
  code,
  scope,
  accountEmail,
  confirmLabel,
  confirmBusyLabel,
  busy,
  disabled,
  onCancel,
  onConfirm,
}: {
  code: string
  scope: E2eeScope
  accountEmail: string | null
  confirmLabel: string
  confirmBusyLabel: string
  busy: boolean
  disabled?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [checked, setChecked] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const copyBtnRef = useRef<HTMLButtonElement | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    copyBtnRef.current?.focus()
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      setCopyError(true)
      return
    }
    setCopyError(false)
    setCopied(true)
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
  }

  function handleSaveFile() {
    const content = recoveryFileContent(code, scope, accountEmail)
    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), 'recovery-code.txt')
  }

  return (
    <>
      <h2>복구 코드</h2>
      <p>이 코드는 지금 한 번만 보입니다. 금고 암호를 잊었을 때 이 코드로만 금고를 열 수 있습니다.</p>
      <code className="e2ee-recovery-code">{code}</code>
      <div className="dialog-btn-row">
        <button type="button" ref={copyBtnRef} onClick={handleCopy}>
          {copied ? '복사됨' : '복사'}
        </button>
        <button type="button" onClick={handleSaveFile}>
          파일로 저장
        </button>
      </div>
      {copyError && <p className="e2ee-error" role="alert">복사하지 못했습니다. 코드를 직접 골라 복사하세요.</p>}
      <label className="dialog-field">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        <span>복구 코드를 안전한 곳에 보관했습니다</span>
      </label>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" disabled={!checked || busy || disabled} onClick={onConfirm}>
          {busy ? confirmBusyLabel : confirmLabel}
        </button>
      </div>
    </>
  )
}

export type E2eeUnlockFormProps = {
  keyring: Keyring
  onOpened: () => void
  onForgotPassword: () => void
  // 잠겨서 뜬 P1 은 초점을 옮기지 않는다 — 기본 true (F-405 6.2)
  autoFocus?: boolean
  // P1 과 D-11 이 한 화면에 같이 있을 수 있어 기본은 useId. D-11 은 고정 id 를 준다 (F-405 6.2)
  labelId?: string
}

// D-11 암호 모드와 F-405 의 P1 패널이 함께 쓰는 폼 (F-404.md 7.2)
export function E2eeUnlockForm({ keyring, onOpened, onForgotPassword, autoFocus = true, labelId }: E2eeUnlockFormProps) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<E2eeActionError | null>(null)
  const [gone, setGone] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const generatedLabelId = useId()
  const passwordLabelId = labelId ?? generatedLabelId
  const autoFocusRef = useRef(autoFocus)

  useEffect(() => {
    if (autoFocusRef.current) inputRef.current?.focus()
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || gone) return
    setBusy(true)
    setError(null)
    const err = await keyring.open(password)
    setBusy(false)
    if (err === null) {
      onOpened()
      return
    }
    setError(err)
    if (err === 'no-vault') setGone(true)
  }

  return (
    <form className="e2ee-unlock-form" onSubmit={handleSubmit}>
      <div className="dialog-field">
        <span id={passwordLabelId}>금고 암호</span>
        <input
          ref={inputRef}
          type="password"
          autoComplete="current-password"
          aria-labelledby={passwordLabelId}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p className="e2ee-error" role="alert">
          {error === 'wrong-password' ? '암호가 맞지 않습니다.' : readErrorText(error)}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="link-btn" onClick={onForgotPassword}>
          암호를 잊었나요?
        </button>
        <button type="submit" disabled={busy || gone}>
          {busy ? '여는 중…' : '열기'}
        </button>
      </div>
    </form>
  )
}

// 'recover' 는 D-11 을 복구 1 모드로 연다 — P1 의 암호를 잊었나요? (F-405 6.2)
export type E2eeDialogMode = 'create' | 'unlock' | 'recover' | 'changePassword' | 'reset' | null

export type E2eeDialogsProps = {
  mode: E2eeDialogMode
  keyring: Keyring | null
  scope: E2eeScope | null
  accountEmail: string | null
  onClose: () => void
  // 암호로 열기 성공(D-11 password 모드) — 알림 없음 (7.2)
  onOpened: () => void
  // 만들기 성공(D-8) — 알림 E15 (7.9)
  onCreated: () => void
  // 복구 코드로 새 암호 정해 열기 성공(D-11 recovery3) — 알림 E17 (7.9)
  onRecovered: () => void
  onChanged: () => void
  onReset: () => void
}

// D-8·D-11·D-12·D-13 (F-404.md 7.1~7.4). 여러 대화상자가 겹칠 수 있으므로 각자 open 을 계산한다
export default function E2eeDialogs({ mode, keyring, scope, accountEmail, onClose, onOpened, onCreated, onRecovered, onChanged, onReset }: E2eeDialogsProps) {
  return (
    <>
      <CreateDialog open={mode === 'create'} keyring={keyring} scope={scope} accountEmail={accountEmail} onClose={onClose} onCreated={onCreated} />
      <UnlockDialog
        open={mode === 'unlock' || mode === 'recover'}
        initialMode={mode === 'recover' ? 'recovery1' : 'password'}
        keyring={keyring}
        scope={scope}
        accountEmail={accountEmail}
        onClose={onClose}
        onOpened={onOpened}
        onRecovered={onRecovered}
      />
      <ChangePasswordDialog open={mode === 'changePassword'} keyring={keyring} onClose={onClose} onChanged={onChanged} />
      <ResetDialog open={mode === 'reset'} keyring={keyring} onClose={onClose} onReset={onReset} />
    </>
  )
}

function CreateDialog({
  open,
  keyring,
  scope,
  accountEmail,
  onClose,
  onCreated,
}: {
  open: boolean
  keyring: Keyring | null
  scope: E2eeScope | null
  accountEmail: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const titleId = 'e2ee-create-title'
  const [step, setStep] = useState<1 | 2>(1)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [confirmBlocked, setConfirmBlocked] = useState(false)
  const passwordRef = useRef<HTMLInputElement | null>(null)

  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setStep(1)
      setPassword('')
      setConfirm('')
      setError(null)
      setRecoveryCode('')
      setConfirmBlocked(false)
    }
  }

  useEffect(() => {
    if (open && step === 1) passwordRef.current?.focus()
  }, [open, step])

  function handleClose() {
    keyring?.createCancel()
    onClose()
  }

  async function handleNext(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!keyring || busy) return
    if (!isE2eePasswordLongEnough(password)) {
      setError('10자 이상 입력하세요.')
      return
    }
    if (!samePassword(password, confirm)) {
      setError('두 암호가 다릅니다.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await keyring.createStart(password)
    setBusy(false)
    if (result.ok) {
      setRecoveryCode(result.recoveryCode)
      setStep(2)
    } else {
      setError(readErrorText(result.error))
    }
  }

  async function handleConfirm() {
    if (!keyring || busy) return
    setBusy(true)
    const result = await keyring.createConfirm()
    setBusy(false)
    if (result.ok) {
      onCreated()
      return
    }
    if (result.error === 'vault-exists') setConfirmBlocked(true)
    setError(ERROR_TEXT[result.error])
  }

  return (
    <Dialog open={open} onClose={handleClose} titleId={titleId} describedById={undefined}>
      <div className="e2ee-dialog">
        {step === 1 ? (
          <form onSubmit={handleNext}>
            <h2 id={titleId}>금고 만들기</h2>
            <p>
              금고에 넣은 문서는 이 기기에서 암호화한 뒤 저장합니다. 서버와 운영자도 내용을 읽을 수 없습니다. 금고 암호와 복구 코드를 모두 잃으면
              누구도 되살릴 수 없습니다.
            </p>
            {scope?.kind === 'local' && <p className="dialog-note">이 금고는 이 브라우저에만 있습니다. 로그인하면 계정 금고로 옮길 수 있습니다.</p>}
            <div className="dialog-field">
              <span id="e2ee-create-password-label">금고 암호</span>
              <input
                ref={passwordRef}
                type="password"
                autoComplete="new-password"
                aria-labelledby="e2ee-create-password-label"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="dialog-field">
              <span id="e2ee-create-confirm-label">암호 확인</span>
              <input
                type="password"
                autoComplete="new-password"
                aria-labelledby="e2ee-create-confirm-label"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && (
              <p className="e2ee-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={handleClose}>
                취소
              </button>
              <button type="submit" disabled={busy}>
                {busy ? '만드는 중…' : '다음'}
              </button>
            </div>
          </form>
        ) : (
          <RecoveryCodeStep
            code={recoveryCode}
            scope={scope ?? { kind: 'local' }}
            accountEmail={accountEmail}
            confirmLabel="금고 만들기"
            confirmBusyLabel="만드는 중…"
            busy={busy}
            disabled={confirmBlocked}
            onCancel={handleClose}
            onConfirm={handleConfirm}
          />
        )}
        {step === 2 && error && (
          <p className="e2ee-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

type UnlockMode = 'password' | 'recovery1' | 'recovery2' | 'recovery3'

function UnlockDialog({
  open,
  initialMode,
  keyring,
  scope,
  accountEmail,
  onClose,
  onOpened,
  onRecovered,
}: {
  open: boolean
  initialMode: UnlockMode
  keyring: Keyring | null
  scope: E2eeScope | null
  accountEmail: string | null
  onClose: () => void
  onOpened: () => void
  onRecovered: () => void
}) {
  const titleId = 'e2ee-unlock-title'
  const [mode, setMode] = useState<UnlockMode>('password')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState('')
  const codeRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)

  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setMode(initialMode)
      setCode('')
      setPassword('')
      setConfirm('')
      setError(null)
      setRecoveryCode('')
    }
  }

  useEffect(() => {
    if (!open) return
    if (mode === 'recovery1') codeRef.current?.focus()
    if (mode === 'recovery2') passwordRef.current?.focus()
  }, [open, mode])

  function handleClose() {
    keyring?.recoveryCancel()
    onClose()
  }

  async function handleVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!keyring || busy) return
    setBusy(true)
    setError(null)
    const result = await keyring.recoveryVerify(code)
    setBusy(false)
    if (result.ok) {
      setMode('recovery2')
    } else {
      setError(readErrorText(result.error))
    }
  }

  async function handleNewPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!keyring || busy) return
    if (!isE2eePasswordLongEnough(password)) {
      setError('10자 이상 입력하세요.')
      return
    }
    if (!samePassword(password, confirm)) {
      setError('두 암호가 다릅니다.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await keyring.recoveryReset(password)
    setBusy(false)
    if (result.ok) {
      setRecoveryCode(result.recoveryCode)
      setMode('recovery3')
    } else {
      setError(ERROR_TEXT[result.error])
    }
  }

  async function handleConfirmRecovery() {
    if (!keyring || busy) return
    setBusy(true)
    const result = await keyring.recoveryConfirm()
    setBusy(false)
    if (result.ok) {
      onRecovered()
      return
    }
    setError(ERROR_TEXT[result.error])
  }

  return (
    <Dialog open={open} onClose={handleClose} titleId={titleId}>
      <div className="e2ee-dialog">
        {mode === 'password' && keyring && (
          <>
            <h2 id={titleId}>금고 열기</h2>
            <p>금고 암호를 입력하면 이 탭에서 금고 문서를 열 수 있습니다.</p>
            <E2eeUnlockForm keyring={keyring} onOpened={onOpened} onForgotPassword={() => setMode('recovery1')} labelId="e2ee-unlock-password-label" />
          </>
        )}
        {mode === 'recovery1' && (
          <form onSubmit={handleVerify}>
            <h2 id={titleId}>복구 코드로 열기</h2>
            <div className="dialog-field">
              <span id="e2ee-recovery-code-label">복구 코드</span>
              <input
                ref={codeRef}
                type="text"
                autoComplete="off"
                spellCheck={false}
                aria-labelledby="e2ee-recovery-code-label"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            {error && (
              <p className="e2ee-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="link-btn" onClick={() => setMode('password')}>
                암호로 열기
              </button>
              <button type="submit" disabled={busy}>
                {busy ? '확인하는 중…' : '다음'}
              </button>
            </div>
          </form>
        )}
        {mode === 'recovery2' && (
          <form onSubmit={handleNewPassword}>
            <h2 id={titleId}>새 금고 암호</h2>
            <p>새 금고 암호를 정하면 복구 코드도 새로 만듭니다. 전에 쓰던 복구 코드는 더 쓸 수 없습니다.</p>
            <div className="dialog-field">
              <span id="e2ee-new-password-label">새 금고 암호</span>
              <input
                ref={passwordRef}
                type="password"
                autoComplete="new-password"
                aria-labelledby="e2ee-new-password-label"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="dialog-field">
              <span id="e2ee-new-confirm-label">암호 확인</span>
              <input
                type="password"
                autoComplete="new-password"
                aria-labelledby="e2ee-new-confirm-label"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && (
              <p className="e2ee-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={handleClose}>
                취소
              </button>
              <button type="submit" disabled={busy}>
                {busy ? '만드는 중…' : '다음'}
              </button>
            </div>
          </form>
        )}
        {mode === 'recovery3' && (
          <>
            <h2 id={titleId}>새 복구 코드</h2>
            <RecoveryCodeStep
              code={recoveryCode}
              scope={scope ?? { kind: 'local' }}
              accountEmail={accountEmail}
              confirmLabel="저장하고 열기"
              confirmBusyLabel="만드는 중…"
              busy={busy}
              onCancel={handleClose}
              onConfirm={handleConfirmRecovery}
            />
            {error && (
              <p className="e2ee-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

function ChangePasswordDialog({
  open,
  keyring,
  onClose,
  onChanged,
}: {
  open: boolean
  keyring: Keyring | null
  onClose: () => void
  onChanged: () => void
}) {
  const titleId = 'e2ee-change-password-title'
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentRef = useRef<HTMLInputElement | null>(null)

  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setCurrent('')
      setNext('')
      setConfirm('')
      setError(null)
    }
  }

  useEffect(() => {
    if (open) currentRef.current?.focus()
  }, [open])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!keyring || busy) return
    if (!isE2eePasswordLongEnough(next)) {
      setError('10자 이상 입력하세요.')
      return
    }
    if (!samePassword(next, confirm)) {
      setError('두 암호가 다릅니다.')
      return
    }
    setBusy(true)
    setError(null)
    const err = await keyring.changePassword(current, next)
    setBusy(false)
    if (err === null) {
      onChanged()
      return
    }
    setError(err === 'wrong-password' ? '지금 금고 암호가 맞지 않습니다.' : ERROR_TEXT[err])
  }

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId}>
      <form className="e2ee-dialog" onSubmit={handleSubmit}>
        <h2 id={titleId}>금고 암호 바꾸기</h2>
        <div className="dialog-field">
          <span id="e2ee-current-password-label">지금 금고 암호</span>
          <input
            ref={currentRef}
            type="password"
            autoComplete="current-password"
            aria-labelledby="e2ee-current-password-label"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="dialog-field">
          <span id="e2ee-next-password-label">새 금고 암호</span>
          <input
            type="password"
            autoComplete="new-password"
            aria-labelledby="e2ee-next-password-label"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </div>
        <div className="dialog-field">
          <span id="e2ee-next-confirm-label">암호 확인</span>
          <input
            type="password"
            autoComplete="new-password"
            aria-labelledby="e2ee-next-confirm-label"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        {error && (
          <p className="e2ee-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" disabled={busy}>
            {busy ? '바꾸는 중…' : '바꾸기'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function ResetDialog({ open, keyring, onClose, onReset }: { open: boolean; keyring: Keyring | null; onClose: () => void; onReset: () => void }) {
  const titleId = 'e2ee-reset-title'
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setConfirmText('')
      setError(null)
    }
  }

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const canConfirm = samePassword(confirmText, '초기화')

  async function doReset() {
    if (!keyring || busy || !canConfirm) return
    setBusy(true)
    setError(null)
    const result = await keyring.reset()
    setBusy(false)
    if (result.ok) {
      onReset()
      return
    }
    if (result.error === 'vault-not-empty') {
      setError(`금고 문서 ${result.docs ?? 0}개와 금고 폴더 ${result.folders ?? 0}개가 남아 있어 초기화하지 못했습니다.`)
    } else {
      setError(ERROR_TEXT[result.error])
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void doReset()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.nativeEvent.isComposing) return
    void doReset()
  }

  return (
    <Dialog open={open} onClose={onClose} titleId={titleId}>
      <form className="e2ee-dialog" onSubmit={handleSubmit}>
        <h2 id={titleId}>금고 초기화</h2>
        <p>금고 문서와 금고 폴더를 모두 지우고 금고를 없앱니다. 지운 금고 문서는 되살릴 수 없습니다. 금고 암호와 복구 코드를 모두 잃었을 때만 쓰세요.</p>
        <div className="dialog-field">
          <span id="e2ee-reset-confirm-label">계속하려면 초기화를 입력하세요</span>
          <input
            ref={inputRef}
            type="text"
            aria-labelledby="e2ee-reset-confirm-label"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        {error && (
          <p className="e2ee-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="danger" disabled={!canConfirm || busy}>
            {busy ? '초기화하는 중…' : '초기화'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
