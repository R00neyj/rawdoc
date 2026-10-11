// 후원 대화상자 — 넓은 창은 토스 QR, 휴대폰은 자기 화면 QR 을 못 찍으니 앱 여는 링크 (small 2026-10-11)
import { useRef } from 'react'
import Dialog from './Dialog'
import { closeDonateDialog, useDonateDialogOpen } from './donateStore'
import { usePhoneWidth } from './usePhoneWidth'
import { DONATE_QR_PATH, TOSS_DONATE_URL } from '../lib/donateLink'

export default function DonateDialog() {
  const open = useDonateDialogOpen()
  const phone = usePhoneWidth()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'donate-title'

  return (
    <Dialog open={open} onClose={closeDonateDialog} titleId={titleId} initialFocusRef={closeRef}>
      <div className="donate-dialog">
        <h2 id={titleId}>후원하기</h2>
        {phone ? (
          <>
            <p>광고·구독 없이 운영합니다. 서버비에 보태 주시면 고맙겠습니다.</p>
            <a className="dialog-btn donate-open" href={TOSS_DONATE_URL}>
              토스 앱에서 열기
            </a>
            <p className="dialog-note donate-note">토스 앱이 없으면 열리지 않습니다</p>
          </>
        ) : (
          <>
            <p>광고·구독 없이 운영합니다. 서버비에 보태 주시면 고맙겠습니다. 토스 앱으로 QR 을 찍으면 송금 화면이 열립니다</p>
            <img className="donate-qr" src={DONATE_QR_PATH} alt="토스 송금 QR" width={180} height={180} />
          </>
        )}
        <div className="dialog-actions">
          <button type="button" ref={closeRef} onClick={closeDonateDialog}>
            닫기
          </button>
        </div>
      </div>
    </Dialog>
  )
}
