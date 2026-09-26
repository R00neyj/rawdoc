import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// 쓰는 글자의 조각만 받는다 (specs/features/F-2040.md 3.1)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import '@fontsource/noto-serif-kr/400.css'
import '@fontsource/noto-serif-kr/700.css'
import './styles/tokens.css'
import './styles/boot.css'
import './styles/app.css'
import './styles/markdown.css'
import './styles/callout.css'
import './styles/frontmatter.css'
import './styles/wikilink.css'
import './styles/image.css'
import './styles/print.css'
import './styles/map.css'
import './styles/palette.css'
import './styles/peers.css'

import { getPref } from './app/prefs'
import { resolveTheme } from './app/theme'
import { markAppEntry } from './app/markAppEntry'
import App from './app/App'
import { DEV_YSYNC } from './editor/devSyncFlag'
import { CLI_LOGIN_HASH_PREFIX } from './lib/cliLoginUrl'

// 첫 화면 그리기 전에 반영해 서체가 바뀌며 깜빡이지 않게 한다 (specs/features/F-121.md, F-141)
document.documentElement.dataset.headingFont = getPref('md.headingFont', 'serif')
document.documentElement.dataset.bodyFont = getPref('md.bodyFont', 'sans')
document.documentElement.dataset.fontSize = getPref('md.fontSize', 'medium') // F-154 2.2
document.documentElement.dataset.indent = getPref('md.indent', '4') // F-154 2.3
document.documentElement.dataset.theme = resolveTheme(
  getPref('md.theme', 'system'),
  window.matchMedia('(prefers-color-scheme: dark)').matches,
)

// 서비스 워커로 들어온 기존 사용자·설치한 PWA 도 다음 요청부터 서버 판정이 맞게 한다 (F-271 5장)
markAppEntry()

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// CLI 로그인 화면 — App 을 띄우지 않는다(IndexedDB 를 열지 않고 첫 실행 문서도 심지 않는다). F-2021 6.2
if (location.hash.startsWith(CLI_LOGIN_HASH_PREFIX)) {
  import('./app/CliLoginPage').then((module) => {
    const CliLoginPage = module.default
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <CliLoginPage />
      </StrictMode>,
    )
  })
} else if (DEV_YSYNC) {
  // 개발 빌드 ?ysync — 첫 에디터가 만들어지기 전에 연결 훅을 심는다. 운영 빌드에서는 DEV_YSYNC 가 false 로 접혀 이 분기와 모듈이 빠진다 (F-303 9.1)
  import('./app/yDevLink')
    .then((module) => module.installDevLink())
    .catch((error: unknown) => console.error(error))
    .finally(render)
} else {
  render()
}
