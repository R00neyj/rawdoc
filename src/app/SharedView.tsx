// 공유받은 문서 화면 S-4 (specs/ia.md 1장 S-4·3.19, F-130.md 4장) — 위키링크(F-131)는 문서 목록이 없어 여기선 만들지 않는다
import Viewer from '../viewer/Viewer'
import { renderMarkdown } from '../viewer/renderMarkdown'
import { IconDownload, IconClose } from './icons'
import type { ShareDoc } from '../lib/shareCodec'

type SharedViewProps = {
  sharedDoc: ShareDoc // decodeShare 결과
  onImport: () => void // `내 문서로 가져오기`
  onClose: () => void // `닫기`
}

export default function SharedView({ sharedDoc, onImport, onClose }: SharedViewProps) {
  const html = renderMarkdown(sharedDoc.content)

  return (
    <div className="shared-view">
      <div className="shared-view-notice" role="status">
        <span>공유받은 문서입니다. 아직 내 문서에 저장되지 않았습니다.</span>
        <div className="shared-view-notice-actions">
          <button type="button" onClick={onImport}>
            <IconDownload size={18} />
            내 문서로 가져오기
          </button>
          <button type="button" onClick={onClose}>
            <IconClose size={18} />
            닫기
          </button>
        </div>
      </div>
      <div className="shared-view-body">
        <h1 className="shared-view-title">{sharedDoc.title || '제목 없는 문서'}</h1>
        {/* 공유 화면은 첨부를 읽지 않는다 — resolveAttachment 를 넘기지 않으면 이미지 블록은
            모두 자리 표시로 보인다 (F-158.md 2.2) */}
        <Viewer html={html} missingImageText="공유 링크에는 이미지가 담기지 않습니다" />
      </div>
    </div>
  )
}
