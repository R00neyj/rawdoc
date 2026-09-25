// D-14 로그인 전 금고 옮기기 (specs/features/F-408.md 5.2)
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Dialog from './Dialog'
import { E2eeUnlockForm } from './E2eeDialogs'
import type { UseE2ee } from './useE2ee'
import { readE2eeRow } from '../storage/idbStore'
import { createAccountBundleSource } from '../e2ee/bundleSource'
import { E2eeError, openWithPassword as openLocalBundleWithPassword, parseKeyBundle } from '../e2ee/crypto'
import type { LocalE2eeKeys } from '../e2ee/convert'

// F-404 7.9 문구를 그대로 옮긴 것 — 읽기로 시작하는 동작은 offline 문구가 다르다. 드문 오류 코드(계정 금고를 다른 곳에서 없앤 경우 등)는 마지막 줄로 묶는다
function actionErrorText(code: string, mode: 'read' | 'write'): string {
  if (code === 'wrong-password') return '암호가 맞지 않습니다.'
  if (code === 'offline') {
    return mode === 'read' ? '인터넷에 연결되어 있지 않아 금고 정보를 불러오지 못했습니다.' : '인터넷에 연결되어 있지 않아 저장하지 못했습니다. 연결한 뒤 다시 누르세요.'
  }
  if (code === 'rate-limited') return '요청이 많아 저장하지 못했습니다. 잠시 뒤 다시 누르세요.'
  if (code === 'account-blocked') return '이 계정은 운영자가 쓰기를 막아 금고를 만들거나 바꿀 수 없습니다.'
  if (code === 'bad-bundle') return '금고 정보가 손상되어 열 수 없습니다.'
  if (code === 'unsupported-version') return '이 버전의 앱으로는 열 수 없는 금고입니다. 새로고침해 새 버전을 받으세요.'
  return '금고 정보를 처리하지 못했습니다. 잠시 뒤 다시 시도하세요.'
}

type NoteKind = 'none' | 'has-account' | 'other'

function noteFor(kind: NoteKind): string | null {
  if (kind === 'none') return '계정에 아직 금고가 없어 이 금고가 그대로 계정 금고가 됩니다. 금고 암호와 복구 코드도 그대로 씁니다.'
  if (kind === 'has-account') return '계정 금고에 넣습니다. 계정 금고의 암호와 복구 코드는 바뀌지 않습니다.'
  return null
}

export type E2eeMigrateDialogProps = {
  open: boolean
  count: number
  userId: string
  e2ee: UseE2ee
  // 나중에·Esc·바깥 클릭 — 아무것도 쓰지 않는다 (2.4)
  onClose: () => void
  // 키를 얻었다 — App 이 실행(4장)으로 이어받는다
  onReady: (keys: LocalE2eeKeys, localBundle: string) => void
}

// D-14 1단계(로그인 전 금고 암호) · 2단계(계정 금고 열기, 두 금고 암호가 다를 때만) (specs/features/F-408.md 5.2)
export default function E2eeMigrateDialog({ open, count, userId, e2ee, onClose, onReady }: E2eeMigrateDialogProps) {
  const titleId = 'e2ee-migrate-title'
  const [step, setStep] = useState<1 | 2>(1)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<NoteKind>('other')
  const inputRef = useRef<HTMLInputElement | null>(null)
  const pendingRef = useRef<{ localKey: CryptoKey; bundle: string } | null>(null)

  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setStep(1)
      setPassword('')
      setError(null)
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    pendingRef.current = null
    void e2ee.refreshStatus().then((status) => {
      setNote(status === 'none' ? 'none' : status === 'locked' || status === 'open' ? 'has-account' : 'other')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번만
  }, [open])

  useEffect(() => {
    if (open && step === 1) inputRef.current?.focus()
  }, [open, step])

  // 2단계는 계정 열쇠고리 상태를 구독한다 — 폼으로 열든 D-11 복구로 열든 open 이 되면 곧바로 실행으로 간다
  useEffect(() => {
    if (step !== 2 || e2ee.status !== 'open') return
    const pending = pendingRef.current
    const accountKey = e2ee.keyring.getMasterKey()
    if (!pending || !accountKey) return
    onReady({ mode: 'rewrap', localKey: pending.localKey, accountKey }, pending.bundle)
  }, [step, e2ee.status, e2ee.keyring, onReady])

  function handleClose() {
    onClose()
  }

  async function handleStep1(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const row = await readE2eeRow('local')
      if (!row) {
        setError(actionErrorText('bad-bundle', 'read'))
        return
      }
      let bundle
      try {
        bundle = parseKeyBundle(row.bundle)
      } catch (err) {
        setError(actionErrorText(err instanceof E2eeError ? err.code : 'failed', 'read'))
        return
      }
      let localKey: CryptoKey
      try {
        const opened = await openLocalBundleWithPassword(bundle, password)
        localKey = opened.masterKey
      } catch (err) {
        setError(actionErrorText(err instanceof E2eeError ? err.code : 'failed', 'read'))
        return
      }

      // 계정 금고 만들기를 먼저 시도한다 — 있으면 409(conflict) (2.1)
      const result = await createAccountBundleSource(userId).create(row.bundle)
      if (result.kind === 'ok') {
        void e2ee.openWithPassword(password) // 실패해도 이관은 계속한다 (2.1)
        onReady({ mode: 'adopt', localKey, accountKey: localKey }, row.bundle)
        return
      }
      if (result.kind === 'conflict') {
        if (e2ee.keyring.getStatus() === 'open') {
          onReady({ mode: 'rewrap', localKey, accountKey: e2ee.keyring.getMasterKey()! }, row.bundle)
          return
        }
        // 방금 받은 로컬 금고 암호로 먼저 한 번 해 본다(11장 Q2) — 두 금고 암호가 같으면 더 묻지 않는다
        const err = await e2ee.openWithPassword(password)
        if (err === null) {
          onReady({ mode: 'rewrap', localKey, accountKey: e2ee.keyring.getMasterKey()! }, row.bundle)
          return
        }
        if (err === 'wrong-password') {
          pendingRef.current = { localKey, bundle: row.bundle }
          setStep(2)
          return
        }
        setError(actionErrorText(err, 'read'))
        return
      }
      // error — 아무것도 바뀌지 않았다. 다시 누를 수 있다
      setError(actionErrorText(result.kind === 'error' ? result.reason : 'failed', 'write'))
    } finally {
      setBusy(false)
    }
  }

  const description = `이 브라우저에 로그인 전에 만든 금고 문서 ${count.toLocaleString('ko-KR')}개가 있습니다. 그 금고의 암호를 입력하면 계정 금고로 옮깁니다. 이 브라우저의 금고 문서는 지우지 않습니다.`
  const noteText = noteFor(note)

  return (
    <Dialog open={open} onClose={handleClose} titleId={titleId}>
      <div className="e2ee-dialog e2ee-migrate-dialog">
        {step === 1 ? (
          <form onSubmit={handleStep1}>
            <h2 id={titleId}>로그인 전 금고 옮기기</h2>
            <p>{description}</p>
            {noteText && <p className="dialog-note e2ee-migrate-note">{noteText}</p>}
            <div className="dialog-field">
              <span id="e2ee-migrate-password-label">로그인 전 금고 암호</span>
              <input
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                aria-labelledby="e2ee-migrate-password-label"
                value={password}
                onChange={(ev) => setPassword(ev.target.value)}
              />
            </div>
            <p className="dialog-note">암호를 잊었으면 로그아웃한 뒤 설정의 금고 탭에서 복구 코드로 새 암호를 정하고 다시 로그인하세요.</p>
            {error && (
              <p className="e2ee-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" onClick={handleClose}>
                나중에
              </button>
              <button type="submit" disabled={busy}>
                {busy ? '옮기는 중…' : '옮기기'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2 id={titleId}>계정 금고 열기</h2>
            <p>이 계정에는 이미 금고가 있고, 방금 입력한 암호로는 열리지 않았습니다. 계정 금고 암호를 입력하면 로그인 전 금고 문서를 계정 금고로 옮깁니다.</p>
            <E2eeUnlockForm
              keyring={e2ee.keyring}
              onOpened={() => {}}
              onForgotPassword={() => e2ee.openSettingsDialogs.recover()}
              labelId="e2ee-migrate-step2-password-label"
            />
            <div className="dialog-actions">
              <button type="button" onClick={handleClose}>
                나중에
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
