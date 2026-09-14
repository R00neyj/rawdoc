// 라이브 프리뷰 확장 (F-104 인라인·F-105 줄 요소)
// createEditor.js 가 보기 모드 Compartment 에 넣을 확장을 여기서 조립해 반환한다
import './preview.css'

import { blockPreview } from './blocks.js'
import { inlinePreview } from './inline.js'
import { gutterAlignPreview, linePreview, listIndentPreview } from './lines.js'
import { linkClicks } from './links.js'
import { wikiLinkClicks, wikiLinksPreview } from './wikiLinks.js'

// resolveAttachment 는 이미지 블록 위젯이 첨부를 읽는 콜백 (F-157.md 2.2)
export function livePreview({ onOpenWikiLink, resolveAttachment } = {}) {
  return [
    inlinePreview(),
    linePreview(),
    gutterAlignPreview(),
    listIndentPreview(),
    blockPreview({ resolveAttachment }),
    linkClicks(),
    wikiLinksPreview(),
    wikiLinkClicks(onOpenWikiLink),
  ]
}
