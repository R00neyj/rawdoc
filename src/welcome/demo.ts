// 랜딩(/)의 스크롤 스토리 번들 진입점 — 앱과 같은 createEditor 를 스토리 무대에 띄운다 (F-239.md 2.1, F-2049)
// 스타일은 ?inline 으로 받아 <style> 로 넣는다. 워커가 돌려주는 정적 HTML 이라 CSS 파일
// 경로를 알 수 없고, 이 번들 하나만 부르면 되게 하려는 것이다
// 서체는 앱(main.tsx)과 같은 조각 CSS — 통파일을 넣으면 랜딩만 4.5MB 를 받는다 (F-2040 3.1)
import pretendardCss from 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css?inline'
import notoCss from '@fontsource/noto-serif-kr/400.css?inline'
import notoBoldCss from '@fontsource/noto-serif-kr/700.css?inline'
import tokensCss from '../styles/tokens.css?inline'
import appCss from '../styles/app.css?inline'
import previewCss from '../editor/preview/preview.css?inline'
import calloutCss from '../styles/callout.css?inline'
import wikilinkCss from '../styles/wikilink.css?inline'
import peersCss from '../styles/peers.css?inline'
import { mountStory } from './story'
import { revealFeatures } from './features'

function injectStyles(): void {
  const style = document.createElement('style')
  style.textContent = [
    pretendardCss,
    notoCss,
    notoBoldCss,
    tokensCss,
    appCss,
    previewCss,
    calloutCss,
    wikilinkCss,
    peersCss,
  ].join('\n')
  // 랜딩 자신의 <style> 이 뒤에 오게 해서, 겹치는 규칙은 랜딩 쪽이 이긴다
  document.head.prepend(style)
}

const section = document.getElementById('story')
if (section) {
  injectStyles()
  mountStory(section)
  revealFeatures(document)
}
