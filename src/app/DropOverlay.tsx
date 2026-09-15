// 외부 파일을 창 위로 끄는 동안 덮는 덮개, 입력만 막는다 (specs/features/F-145.md 2.4)
import { IconUpload } from './icons'

type DropOverlayProps = { visible: boolean }

export default function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null

  return (
    <div className="drop-overlay">
      <div className="drop-overlay-box">
        <IconUpload size={32} />
        <p>여기에 놓아 .md 파일 가져오기</p>
      </div>
    </div>
  )
}
