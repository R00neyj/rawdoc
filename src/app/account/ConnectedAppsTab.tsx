// 설정 `계정` 묶음 `연결` 카드의 연결된 앱 (specs/features/F-2148.md 2장)
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { connectedAppMeta, focusAfterRemove, type ConnectedApp } from './connectedApps'
import { disconnectConnectedApp, listConnectedApps } from './connectedAppsApi'

export default function ConnectedAppsTab({ online }: { online: boolean }) {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [disconnectFailed, setDisconnectFailed] = useState(false)
  const [now] = useState(() => Date.now())
  const listRef = useRef<HTMLUListElement>(null)
  const emptyRef = useRef<HTMLParagraphElement>(null)
  const pendingFocus = useRef<{ id: string | null } | null>(null)

  useEffect(() => {
    if (apps !== null || !online) return
    let cancelled = false
    listConnectedApps().then(
      (list) => {
        if (!cancelled) setApps(list)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [apps, online, attempt])

  useLayoutEffect(() => {
    const pending = pendingFocus.current
    if (!pending) return
    pendingFocus.current = null
    const row = pending.id === null ? null : [...(listRef.current?.querySelectorAll<HTMLElement>('[data-app-id]') ?? [])].find((el) => el.dataset.appId === pending.id)
    ;(row ?? emptyRef.current)?.focus()
  }, [apps])

  function retry() {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  async function disconnect(app: ConnectedApp) {
    if (apps === null || busyId !== null) return
    setDisconnectFailed(false)
    setBusyId(app.id)
    const result = await disconnectConnectedApp(app.id)
    setBusyId(null)
    if (result === 'failed') {
      setDisconnectFailed(true)
      return
    }
    pendingFocus.current = { id: focusAfterRemove(apps.map((a) => a.id), app.id) }
    setApps((prev) => prev && prev.filter((a) => a.id !== app.id))
  }

  let body
  if (apps === null) {
    if (!online) body = <p className="dialog-note">온라인일 때 연결된 앱을 볼 수 있습니다</p>
    else if (failed) {
      body = (
        <div className="dialog-btn-row">
          <span className="dialog-note">연결된 앱을 불러오지 못했습니다.</span>
          <button type="button" className="dialog-btn" onClick={retry}>
            다시 시도
          </button>
        </div>
      )
    } else body = <p className="dialog-note">불러오는 중…</p>
  } else if (apps.length === 0) {
    body = (
      <p ref={emptyRef} className="dialog-note connected-apps-empty" tabIndex={-1}>
        연결된 앱이 없습니다
      </p>
    )
  } else {
    body = (
      <>
        <ul ref={listRef} className="connected-apps-list">
          {apps.map((app) => (
            <li key={app.id} className="connected-app-row">
              <div className="connected-app-info">
                <span className="connected-app-name">{app.name}</span>
                <span className="connected-app-meta">{connectedAppMeta(app, now)}</span>
              </div>
              <button
                type="button"
                className="dialog-btn"
                data-app-id={app.id}
                aria-label={`${app.name} 연결 끊기`}
                disabled={!online || busyId !== null}
                onClick={() => void disconnect(app)}
              >
                {busyId === app.id ? '끊는 중…' : '연결 끊기'}
              </button>
            </li>
          ))}
        </ul>
        {!online && <p className="dialog-note">온라인일 때 연결을 끊을 수 있습니다</p>}
        {disconnectFailed && (
          <p className="dialog-note" role="alert">
            연결을 끊지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.
          </p>
        )}
      </>
    )
  }

  return (
    <section className="settings-apps" aria-labelledby="settings-apps-title">
      <h5 id="settings-apps-title" className="settings-card-sub">연결된 앱</h5>
      <p className="dialog-note">연결을 끊으면 그 앱은 곧바로 문서를 읽거나 고칠 수 없습니다.</p>
      {body}
    </section>
  )
}
