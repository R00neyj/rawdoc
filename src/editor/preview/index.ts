// 라이브 프리뷰 확장 (F-104 인라인·F-105 줄 요소)
// createEditor.ts 가 보기 모드 Compartment 에 넣을 확장을 여기서 조립해 반환한다
import type { Extension } from '@codemirror/state'

import './preview.css'

import { blockPreview } from './blocks'
import type { ResolveAttachment } from './blocks'
import { highlightMarkPreview } from './highlightMark'
import { inlinePreview } from './inline'
import { gutterAlignPreview, linePreview, listIndentPreview } from './lines'
import { linkClicks } from './links'
import { wikiLinkClicks, wikiLinksPreview } from './wikiLinks'
import type { OnOpenWikiLink } from './wikiLinks'

// resolveAttachment 는 이미지 블록 위젯이 첨부를 읽는 콜백 (F-157.md 2.2)
// theme: 앱 테마 — mermaid 코드블록 위젯에 쓰인다(F-260.md 2.2·2.3)
export function livePreview({
  onOpenWikiLink,
  resolveAttachment,
  theme,
}: { onOpenWikiLink?: OnOpenWikiLink; resolveAttachment?: ResolveAttachment; theme: string }): Extension {
  return [
    inlinePreview(),
    highlightMarkPreview(),
    linePreview(),
    gutterAlignPreview(),
    listIndentPreview(),
    blockPreview({ resolveAttachment, theme }),
    linkClicks(),
    wikiLinksPreview(),
    wikiLinkClicks(onOpenWikiLink),
  ]
}
