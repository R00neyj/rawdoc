import { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from '../Dialog'
import { IconOpenInNew, IconPersonAdd, IconTooltip } from '../icons'
import { cancelAccessRequest, fetchAccessStatus, sendAccessRequest } from './accessRequestApi'
import { accessControlView, accessRequestErrorMessage, formatLocalDate } from './accessRequestView'
import { formatHash } from '../routing/hashRoute'
import type { AccessRequestStatus, AccessRole } from '../../lib/share/accessRequest'

export type AccessRequestControlProps = {
  token: string
  docId: string | null
  variant: 'icon' | 'text'
  openIn: 'reload' | 'hash'
  onNotice: (message: string) => void
}

const ROLE_LABEL: Record<AccessRole, string> = { view: '보기', edit: '편집' }
const ROLE_HELP: Record<AccessRole, string> = { view: '공유받은 문서로 내 목록에 둡니다', edit: '함께 고칠 수 있습니다' }
const TITLE_ID = 'access-request-title'

// 공개 보기 머리 줄의 `앱에서 열기`·`권한 요청` 버튼과 D-23 (F-2135)
export default function AccessRequestControl({ token, docId, variant, openIn, onNotice }: AccessRequestControlProps) {
  const [loaded, setLoaded] = useState<{ key: string; status: AccessRequestStatus | null } | null>(null)
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<AccessRole>('view')
  const [busy, setBusy] = useState(false)
  const requestIdRef = useRef(0)
  const radioRef = useRef<HTMLInputElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const key = `${token}\n${docId ?? ''}`
  const status = loaded && loaded.key === key ? loaded.status : null
  const view = accessControlView(status)

  const refresh = useCallback(() => {
    const id = ++requestIdRef.current
    void fetchAccessStatus(token, docId).then((next) => {
      if (requestIdRef.current === id) setLoaded({ key, status: next })
    })
  }, [token, docId, key])

  useEffect(() => {
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const request = view.request
  if (!status || (!view.openHref && !request)) return null

  const pending = request?.mode === 'pending'
  const requestLabel = pending ? '권한 요청 보냄' : '권한 요청'
  const openLabel = openIn === 'hash' ? '원본 문서 열기' : '앱에서 열기'

  function openApp() {
    if (openIn === 'hash') location.assign(formatHash(status?.targetId))
    else if (view.openHref) location.assign(view.openHref)
  }

  function openDialog() {
    if (request?.mode === 'form') setRole(request.roles[0])
    setOpen(true)
  }

  async function send() {
    setBusy(true)
    const result = await sendAccessRequest(token, docId, role)
    setBusy(false)
    if (result.ok) {
      setLoaded({ key, status: result.status })
      setOpen(false)
      onNotice('권한을 요청했습니다.')
      return
    }
    onNotice(accessRequestErrorMessage(result.error, result.retryAt))
    if (result.error === 'gone') setLoaded({ key, status: null })
    else if (result.error === 'already_member' || result.error === 'cooldown') refresh()
  }

  async function cancel() {
    setBusy(true)
    const ok = await cancelAccessRequest(token, docId)
    setBusy(false)
    if (!ok) {
      onNotice('요청을 취소하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
      return
    }
    setOpen(false)
    refresh()
    onNotice('요청을 취소했습니다.')
  }

  const openBtn = view.openHref ? (
    variant === 'icon' ? (
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn public-view-open-app" aria-label={openLabel} onClick={openApp}>
          <IconOpenInNew size={18} />
        </button>
        <IconTooltip text={openLabel} />
      </span>
    ) : (
      <button type="button" className="access-request-text-btn" onClick={openApp}>
        <IconOpenInNew size={18} />
        {openLabel}
      </button>
    )
  ) : null

  const requestBtn = request ? (
    variant === 'icon' ? (
      <span className="icon-btn-wrap">
        <button type="button" className="icon-btn public-view-request" aria-label={requestLabel} onClick={openDialog}>
          <IconPersonAdd size={18} />
        </button>
        <IconTooltip text={requestLabel} />
      </span>
    ) : (
      <button type="button" className="access-request-text-btn" onClick={openDialog}>
        <IconPersonAdd size={18} />
        {requestLabel}
      </button>
    )
  ) : null

  return (
    <>
      {openBtn}
      {requestBtn}
      <Dialog open={open && request !== null} onClose={() => setOpen(false)} titleId={TITLE_ID} initialFocusRef={request?.mode === 'form' ? radioRef : closeRef}>
        <h2 id={TITLE_ID}>권한 요청</h2>
        {request?.mode === 'form' && (
          <>
            <div className="access-request-roles" role="radiogroup" aria-label="요청할 권한">
              {request.roles.map((r) => (
                <label key={r} className="access-request-role">
                  <input type="radio" name="access-request-role" value={r} checked={role === r} ref={role === r ? radioRef : null} onChange={() => setRole(r)} />
                  <span>
                    <strong>{ROLE_LABEL[r]}</strong>
                    <small>{ROLE_HELP[r]}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="dialog-note">소유자에게 내 이름과 이메일이 보입니다.</p>
            <div className="dialog-actions">
              <button type="button" disabled={busy} onClick={() => setOpen(false)}>
                취소
              </button>
              <button type="button" disabled={busy} onClick={() => void send()}>
                {busy ? '보내는 중…' : '요청 보내기'}
              </button>
            </div>
          </>
        )}
        {request?.mode === 'pending' && (
          <>
            <p>{ROLE_LABEL[request.role]} 권한을 요청했습니다. 소유자가 승인하면 알림이 옵니다.</p>
            <div className="dialog-actions">
              <button type="button" ref={closeRef} onClick={() => setOpen(false)}>
                닫기
              </button>
              <button type="button" disabled={busy} onClick={() => void cancel()}>
                요청 취소
              </button>
            </div>
          </>
        )}
        {request?.mode === 'rejected' && (
          <>
            <p>소유자가 요청을 받아들이지 않았습니다. {formatLocalDate(request.retryAt)}부터 다시 요청할 수 있습니다.</p>
            <div className="dialog-actions">
              <button type="button" ref={closeRef} onClick={() => setOpen(false)}>
                닫기
              </button>
            </div>
          </>
        )}
      </Dialog>
    </>
  )
}
