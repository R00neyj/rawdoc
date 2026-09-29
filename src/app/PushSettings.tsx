// 설정 `계정` 탭의 `알림` 묶음 — 스위치·아래 줄·테스트 버튼 (F-2110 6.2)
import type { SettingsPush } from './SettingsDialog'

export default function PushSettings({ push }: { push: SettingsPush }) {
  const { view } = push
  return (
    <section className="settings-push" aria-labelledby="settings-push-title">
      <h3 id="settings-push-title" className="data-section-title">알림</h3>
      <div className="settings-push-row">
        <span id="settings-push-label">이 기기에서 푸시 받기</span>
        <button
          type="button"
          role="switch"
          className="settings-push-switch"
          aria-checked={view.checked}
          aria-labelledby="settings-push-label"
          aria-describedby="settings-push-note"
          aria-busy={view.locked || undefined}
          aria-disabled={view.locked || undefined}
          disabled={view.disabled}
          onClick={() => {
            if (!view.locked && !view.disabled) push.onToggle()
          }}
        />
      </div>
      <p id="settings-push-note" className="dialog-note settings-push-note">{view.note}</p>
      {view.showTest && (
        <button
          type="button"
          className="dialog-btn settings-push-test"
          disabled={view.testDisabled}
          aria-disabled={view.testLocked || undefined}
          onClick={() => {
            if (!view.testLocked && !view.testDisabled) push.onTest()
          }}
        >
          테스트 알림 보내기
        </button>
      )}
    </section>
  )
}
