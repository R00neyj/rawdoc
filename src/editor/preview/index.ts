// 라이브 프리뷰 확장 (F-104 인라인·F-105 줄 요소)
// createEditor.ts 가 보기 모드 Compartment 에 넣을 확장을 여기서 조립해 반환한다
import type { Extension } from '@codemirror/state'

import './preview.css'

import { blockPreview } from './blocks'
import type { ResolveAttachment } from './blocks'
import { inlinePreview } from './inline'
import { gutterAlignPreview, linePreview, listIndentPreview } from './lines'
import { linkClicks } from './links'
import { wikiLinkClicks, wikiLinksPreview } from './wikiLinks'
import type { OnOpenWikiLink } from './wikiLinks'

// resolveAttachment 는 이미지 블록 위젯이 첨부를 읽는 콜백 (F-157.md 2.2)
export function livePreview({
  onOpenWikiLink,
  resolveAttachment,
}: { onOpenWikiLink?: OnOpenWikiLink; resolveAttachment?: ResolveAttachment } = {}): Extension {
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
