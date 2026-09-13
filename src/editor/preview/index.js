// 라이브 프리뷰 확장 (F-104 인라인·F-105 줄 요소)
// createEditor.js 가 보기 모드 Compartment 에 넣을 확장을 여기서 조립해 반환한다
import './preview.css'

import { blockPreview } from './blocks.js'
import { inlinePreview } from './inline.js'
import { linePreview } from './lines.js'
import { linkClicks } from './links.js'

export function livePreview() {
  return [inlinePreview(), linePreview(), blockPreview(), linkClicks()]
}
