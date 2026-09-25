// P1 잠금 해제 패널 — 편집 영역 자리에 잠긴 금고 문서 대신 뜬다 (specs/features/F-405.md 6.2)
import { useEffect, useId } from 'react'
import type { Keyring } from '../e2ee/keyring'
import { E2eeUnlockForm } from './E2eeDialogs'

export type E2eeLockedPanelProps = {
  keyring: Keyring
  // 금고가 열려 있고 목록을 다시 읽은 뒤에도 이 문서가 잠긴 모양이면 풀지 못한 문서다 (4.1)
  damaged: boolean
  // 문서를 골라서 뜨면 true, 잠겨서 뜨면 false — 자동 잠금 중 다른 곳의 입력을 빼앗지 않는다
  autoFocus: boolean
  onOpened: () => void
  onForgotPassword: () => void
}

export default function E2eeLockedPanel({ keyring, damaged, autoFocus, onOpened, onForgotPassword }: E2eeLockedPanelProps) {
  const headingId = useId()

  // 처음 보일 때 상태를 아직 모르면 한 번 읽는다 (F-404 3.2 ④)
  useEffect(() => {
    if (keyring.getStatus() === 'unknown') void keyring.load()
  }, [keyring])

  return (
    <section className="e2ee-locked-panel" aria-labelledby={headingId}>
      <h2 id={headingId}>잠긴 금고 문서입니다.</h2>
      {damaged ? (
        <p className="dialog-note">이 금고 문서를 풀지 못했습니다. 문서가 손상되었거나 다른 금고에서 만든 문서입니다.</p>
      ) : (
        <E2eeUnlockForm keyring={keyring} onOpened={onOpened} onForgotPassword={onForgotPassword} autoFocus={autoFocus} />
      )}
    </section>
  )
}
