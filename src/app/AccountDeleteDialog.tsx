// 계정 삭제 대화상자 D-15 — 미리 보기, 다시 로그인, 확인 입력, 삭제 (specs/features/F-2038.md 6.2·6.3)
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import Dialog from './Dialog'
import { fetchAccountPreview, requestAccountDelete } from './accountDelete'
import { ACCOUNT_DELETE_CONFIRM_WORD, type AccountDeletePreview } from '../lib/accountDeletion'
import { formatCount, formatMegabytes } from '../lib/usageLimits'

type Phase = 'loading' | 'load-error' | 'reauth' | 'confirm' | 'deleting'

type AccountDeleteDialogProps = {
  open: boolean
  // 이 기기에 안 올린 변경이 있다 — App 이 열 때 한 번 계산한다 (6.4)
  unsynced: boolean
  onClose: () => void
  // 미리 보기 401 — 로그아웃된 것. App 이 닫고 계정 상태를 다시 읽는다 (6.2)
  onSignedOut: () => void
  onReauth: () => Promise<void>
  onDeleted: () => Promise<void>
}

// D-13 과 같은 비교 — 앞뒤 공백은 그대로, NFC 차이만 없앤다
function sameWord(a: string, b: string): boolean {
  return a.normalize('NFC') === b.normalize('NFC')
}

const TEXT = {
  loading: '불러오는 중…',
  loadError: '계정 정보를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
  reauth: '계정을 삭제하려면 10분 안에 로그인한 상태여야 합니다. 다시 로그인하면 이 창이 다시 열립니다.',
  empty: '서버에 저장한 문서·폴더·이미지가 없습니다.',
  notes: [
    '다른 사람에게 받은 초대도 끊깁니다. 다른 사람 문서에 직접 쓴 내용은 그 문서에 남습니다.',
    '이 브라우저에 로그인 없이 만든 문서와 로컬 금고는 지우지 않습니다.',
    '지운 자료는 장애 복구용 자동 백업에 최대 30일 남았다가 사라집니다.',
    '다른 기기는 다음에 연결할 때 로그아웃됩니다. 그 기기에 남은 사본은 그 브라우저의 사이트 데이터를 지워야 사라집니다.',
  ],
  unsynced: '이 기기에서 아직 서버에 올리지 못한 변경도 함께 사라집니다.',
  networkError: '계정을 삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.',
  failedError: '계정을 삭제하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
}

function summaryLines(p: AccountDeletePreview): string[] {
  const lines = [
    `서버 문서 ${formatCount(p.docs)}개${p.e2eeDocs > 0 ? ` (금고 문서 ${formatCount(p.e2eeDocs)}개 포함)` : ''}`,
    `폴더 ${formatCount(p.folders)}개`,
    `이미지 ${formatCount(p.attachments.count)}개 · ${formatMegabytes(p.attachments.bytes)}`,
  ]
  if (p.tokens > 0) lines.push(`API 토큰 ${formatCount(p.tokens)}개 — 이 토큰을 쓰는 스크립트와 명령줄 도구가 멈춥니다`)
  return lines
}

export default function AccountDeleteDialog({ open, unsynced, onClose, onSignedOut, onReauth, onDeleted }: AccountDeleteDialogProps) {
  const titleId = 'account-delete-title'
  const [phase, setPhase] = useState<Phase>('loading')
  const [preview, setPreview] = useState<AccountDeletePreview | null>(null)
  const [word, setWord] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadSeq, setLoadSeq] = useState(0)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLFormElement | null>(null)
  const deletingRef = useRef(false)

  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (open) {
      setPhase('loading')
      setPreview(null)
      setWord('')
      setError(null)
    }
  }

  // 열 때마다(그리고 다시 시도마다) 미리 보기를 읽는다
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchAccountPreview().then((result) => {
      if (cancelled) return
      if (result.kind === 'out') {
        onSignedOut()
        return
      }
      if (result.kind !== 'ok') {
        setPhase('load-error')
        return
      }
      setPreview(result.preview)
      setPhase(result.preview.fresh ? 'confirm' : 'reauth')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadSeq])

  useEffect(() => {
    if (open && phase === 'confirm') inputRef.current?.focus()
  }, [open, phase])

  // 보내는 중에는 Esc·바깥 클릭으로 닫히지 않는다 — Dialog 는 이 옵션이 없어 <dialog> 에 먼저 걸어 막는다 (6.2)
  useEffect(() => {
    const dialog = rootRef.current?.closest('dialog')
    if (!dialog) return
    function blockKey(e: globalThis.KeyboardEvent) {
      if (deletingRef.current && e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    function blockCancel(e: Event) {
      if (deletingRef.current) e.preventDefault()
    }
    function blockBackdrop(e: MouseEvent) {
      if (deletingRef.current && e.target === dialog) e.stopImmediatePropagation()
    }
    dialog.addEventListener('keydown', blockKey, true)
    dialog.addEventListener('cancel', blockCancel)
    dialog.addEventListener('click', blockBackdrop, true)
    return () => {
      dialog.removeEventListener('keydown', blockKey, true)
      dialog.removeEventListener('cancel', blockCancel)
      dialog.removeEventListener('click', blockBackdrop, true)
    }
  }, [])

  const deleting = phase === 'deleting'
  const canConfirm = phase === 'confirm' && sameWord(word, ACCOUNT_DELETE_CONFIRM_WORD)

  function handleClose() {
    if (deletingRef.current) return
    onClose()
  }

  async function doDelete() {
    if (!canConfirm || deletingRef.current) return
    deletingRef.current = true
    setPhase('deleting')
    setError(null)
    const result = await requestAccountDelete()
    if (result === 'ok') {
      await onDeleted()
      return
    }
    deletingRef.current = false
    if (result === 'reauth') {
      setPhase('reauth')
      return
    }
    setPhase('confirm')
    setError(result === 'network' ? TEXT.networkError : TEXT.failedError)
  }

  function retryLoad() {
    setPhase('loading')
    setLoadSeq((n) => n + 1)
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void doDelete()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.nativeEvent.isComposing) return
    void doDelete()
  }

  const showConfirm = (phase === 'confirm' || phase === 'deleting') && preview !== null
  const empty = preview !== null && preview.docs === 0 && preview.folders === 0 && preview.attachments.count === 0

  return (
    <Dialog open={open} onClose={handleClose} titleId={titleId} initialFocusRef={cancelRef}>
      <form ref={rootRef} className="account-delete-dialog" onSubmit={handleSubmit}>
        <h2 id={titleId}>계정 삭제</h2>
        {phase === 'loading' && <p className="dialog-note">{TEXT.loading}</p>}
        {phase === 'load-error' && <p className="account-delete-error">{TEXT.loadError}</p>}
        {phase === 'reauth' && <p>{TEXT.reauth}</p>}
        {showConfirm && preview && (
          <>
            <p className="account-delete-lead">{preview.email} 계정을 지웁니다. 되돌릴 수 없습니다.</p>
            {empty ? (
              <p className="account-delete-summary-empty">{TEXT.empty}</p>
            ) : (
              <ul className="account-delete-summary">
                {summaryLines(preview).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {preview.sharedDocs > 0 && (
              <p className="account-delete-shared">
                다른 사람과 공유 중인 문서 {formatCount(preview.sharedDocs)}개도 지워집니다. 초대받은 사람과 공유 링크로 보던 사람도 더는 열 수
                없습니다.
              </p>
            )}
            <ul className="account-delete-notes">
              {TEXT.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
              {unsynced && <li>{TEXT.unsynced}</li>}
            </ul>
            <div className="dialog-field">
              <span id="account-delete-confirm-label">계속하려면 {ACCOUNT_DELETE_CONFIRM_WORD}를 입력하세요</span>
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                aria-labelledby="account-delete-confirm-label"
                value={word}
                disabled={deleting}
                onChange={(e) => setWord(e.target.value)}
                onKeyDown={handleKeyDown}
              />
            </div>
            {error && (
              <p className="account-delete-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} onClick={handleClose} disabled={deleting}>
            취소
          </button>
          {phase === 'load-error' && (
            <button type="button" onClick={retryLoad}>
              다시 시도
            </button>
          )}
          {phase === 'reauth' && (
            <button type="button" onClick={() => void onReauth()}>
              다시 로그인…
            </button>
          )}
          {showConfirm && (
            <button type="submit" className="danger" disabled={!canConfirm || deleting}>
              {deleting ? '삭제하는 중…' : '계정 삭제'}
            </button>
          )}
        </div>
      </form>
    </Dialog>
  )
}
