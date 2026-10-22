// 랜딩(/)의 스크롤 스토리 번들 진입점 — 앱과 같은 createEditor 를 스토리 무대에 띄운다 (F-239.md 2.1, F-2049)
// 스타일은 ?inline 으로 받아 <style> 로 넣는다 — 워커가 돌려주는 정적 HTML 이라 CSS 경로를 모른다. 서체는 앱과 같은 조각 CSS, 통파일이면 랜딩만 4.5MB (F-2040 3.1)
import pretendardCss from 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css?inline'
import notoCss from '@fontsource/noto-serif-kr/400.css?inline'
import notoBoldCss from '@fontsource/noto-serif-kr/700.css?inline'
import tokensCss from '../styles/tokens.css?inline'
import shellCss from '../styles/app/shell.css?inline'
import topbarCss from '../styles/app/topbar.css?inline'
import sidebarCss from '../styles/app/sidebar.css?inline'
import mainColumnCss from '../styles/app/mainColumn.css?inline'
import outlineCss from '../styles/app/outline.css?inline'
import commentsCss from '../styles/app/comments.css?inline'
import homeCss from '../styles/app/home.css?inline'
import noticesCss from '../styles/app/notices.css?inline'
import dialogsCss from '../styles/app/dialogs.css?inline'
import shareDialogsCss from '../styles/app/shareDialogs.css?inline'
import controlsCss from '../styles/app/controls.css?inline'
import editorCss from '../styles/app/editor.css?inline'
import menusCss from '../styles/app/menus.css?inline'
import docViewsCss from '../styles/app/docViews.css?inline'
import statusbarCss from '../styles/app/statusbar.css?inline'
import publicViewCss from '../styles/app/publicView.css?inline'
import pagesCss from '../styles/app/pages.css?inline'
import phoneCss from '../styles/app/phone.css?inline'
import settingsPanelsCss from '../styles/app/settingsPanels.css?inline'
import phoneTypeCss from '../styles/app/phoneType.css?inline'
import githubCss from '../styles/app/github.css?inline'
import templatesCss from '../styles/app/templates.css?inline'
import rightPanelCss from '../styles/app/rightPanel.css?inline'
import permissionCss from '../styles/app/permission.css?inline'
import codeCopyCss from '../styles/codeCopy.css?inline'
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
    shellCss,
    topbarCss,
    sidebarCss,
    mainColumnCss,
    outlineCss,
    commentsCss,
    homeCss,
    noticesCss,
    dialogsCss,
    shareDialogsCss,
    controlsCss,
    editorCss,
    menusCss,
    docViewsCss,
    statusbarCss,
    publicViewCss,
    pagesCss,
    phoneCss,
    settingsPanelsCss,
    phoneTypeCss,
    githubCss,
    templatesCss,
    rightPanelCss,
    permissionCss,
    codeCopyCss,
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
