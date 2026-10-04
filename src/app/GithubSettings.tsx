// 설정 `계정` 탭의 `GitHub` 묶음 — 연결·해제·이번 달 사용 횟수 (specs/features/F-2128.md 4.6)
import { GITHUB_RECONNECT_MESSAGE } from './githubUi'
import type { SettingsGithub } from './SettingsDialog'

export default function GithubSettings({ github }: { github: SettingsGithub }) {
  const { status, online } = github
  if (!status) return null
  const { month } = status
  const connected = status.connected && !status.reconnect
  return (
    <section className="settings-github" aria-labelledby="settings-github-title">
      <h3 id="settings-github-title" className="data-section-title">GitHub</h3>
      <p className="dialog-note settings-github-note">
        {status.reconnect
          ? GITHUB_RECONNECT_MESSAGE
          : connected
            ? `${status.login ?? ''} 연결됨`
            : 'GitHub 계정을 연결하면 문서를 저장소 파일과 이을 수 있습니다.'}
      </p>
      <div className="dialog-btn-row">
        {connected ? (
          <button type="button" className="dialog-btn" onClick={github.onDisconnect} disabled={!online}>연결 해제</button>
        ) : (
          <button type="button" className="dialog-btn" onClick={github.onConnect} disabled={!online}>GitHub 연결</button>
        )}
        {!online && <span className="dialog-note">온라인일 때 바꿀 수 있습니다.</span>}
      </div>
      <p className="dialog-note settings-github-usage">
        {month.limit === null ? `이번 달 ${month.used}회 사용` : `이번 달 ${month.used}/${month.limit}회 사용`}
      </p>
    </section>
  )
}
