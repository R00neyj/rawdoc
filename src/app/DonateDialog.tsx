// 후원 대화상자 — 넓은 창은 토스 QR, 휴대폰은 자기 화면 QR 을 못 찍으니 앱 여는 링크 (small 2026-10-11)
import { useRef } from 'react'
import Dialog from './Dialog'
import { closeDonateDialog, useDonateDialogOpen } from './donateStore'
import { IconFavorite } from './icons'
import { usePhoneWidth } from './phone/usePhoneWidth'
import { DONATE_QR_PATH, TOSS_DONATE_URL } from '../lib/donateLink'

export default function DonateDialog() {
  const open = useDonateDialogOpen()
  const phone = usePhoneWidth()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const titleId = 'donate-title'

  return (
    <Dialog open={open} onClose={closeDonateDialog} titleId={titleId} initialFocusRef={closeRef}>
      <div className="donate-dialog">
        <span className="donate-heart" aria-hidden="true">
          <IconFavorite size={28} />
        </span>
        <h2 id={titleId}>커피 한 잔 보내기</h2>
        <p className="donate-lead">광고도 구독료도 없이 운영하고 있습니다. 보내 주신 마음은 서버비에 보탭니다.</p>
        {phone ? (
          <>
            <a className="dialog-btn donate-open" href={TOSS_DONATE_URL}>
              토스로 보내기
            </a>
            <p className="dialog-note donate-note">토스 앱이 열리고 송금 화면으로 이어집니다</p>
          </>
        ) : (
          <figure className="donate-qr-wrap">
            <img className="donate-qr" src={DONATE_QR_PATH} alt="토스 송금 QR" width={180} height={180} />
            <figcaption className="donate-note">휴대폰 카메라로 찍으면 토스 송금 화면이 열립니다</figcaption>
          </figure>
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
