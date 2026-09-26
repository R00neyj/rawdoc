// 랜딩(/welcome) 히어로의 편집기 데모 — 앱과 같은 createEditor 를 그대로 띄운다 (F-239.md 2.1)
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
import { createEditor } from '../editor/createEditor'
import { typeStages } from './korChars'

const DEMO_TEXT = [
  '# 원문 그대로 쓰는 한국어 마크다운 협업 도구',
  '',
  '##를 쳐도 기호가 사라지지 않고, 입력한 그대로 남습니다.',
  '',
  '## 회의록',
  '다음 회의는 **금요일 오후 2시**입니다',
  '',
  '- 안건은 [[9월 로드맵]] 참고',
].join('\n')

const STAGE_MS = 16
const CHAR_MS = 10

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
  ].join('\n')
  // 랜딩 자신의 <style> 이 뒤에 오게 해서, 겹치는 규칙은 랜딩 쪽이 이긴다
  document.head.prepend(style)
}

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

export function mountWelcomeDemo(host: HTMLElement): void {
  injectStyles()
  host.textContent = ''
  host.classList.add('cm-host', 'demo-host')

  const handle = createEditor(host, { text: '', lineNumbers: true })
  const view = handle.view

  let stopped = false
  // 다 친 뒤 커서는 첫 줄에 둔다 — 커서가 있는 줄은 기호를 원문 그대로 보여주므로
  // 히어로에 `#` 이 남는다 (F-239.md 0장)
  function finish(): void {
    if (stopped) return
    stopped = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: DEMO_TEXT },
      selection: { anchor: 0 },
    })
  }

  // 사람이 손대면 그 자리에서 애니메이션을 접고 전체 문장을 채운다
  const takeOver = () => finish()
  view.dom.addEventListener('mousedown', takeOver, { once: true })
  view.dom.addEventListener('keydown', takeOver, { once: true })
  view.dom.addEventListener('touchstart', takeOver, { once: true, passive: true })

  if (prefersReducedMotion()) {
    finish()
    return
  }

  let settled = 0
  let index = 0

  function typeChar(): void {
    if (stopped) return
    if (index >= DEMO_TEXT.length) {
      view.dispatch({ selection: { anchor: 0 } })
      stopped = true
      return
    }
    const ch = DEMO_TEXT.charAt(index)
    const forms = typeStages(ch)
    let stage = 0

    function nextStage(): void {
      if (stopped) return
      view.dispatch({
        changes: { from: settled, to: view.state.doc.length, insert: forms[stage] },
        selection: { anchor: settled + forms[stage].length },
      })
      stage += 1
      if (stage < forms.length) {
        setTimeout(nextStage, STAGE_MS)
        return
      }
      view.dispatch({
        changes: { from: settled, to: view.state.doc.length, insert: ch },
        selection: { anchor: settled + ch.length },
      })
      settled += ch.length
      index += 1
      setTimeout(typeChar, CHAR_MS)
    }

    nextStage()
  }

  setTimeout(typeChar, 300)
}

const host = document.getElementById('demo')
if (host) mountWelcomeDemo(host as HTMLElement)
