import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import 'pretendard/dist/web/variable/pretendardvariable.css'
import '@fontsource/noto-serif-kr/korean-400.css'
import '@fontsource/noto-serif-kr/latin-400.css'
import '@fontsource/noto-serif-kr/korean-700.css'
import '@fontsource/noto-serif-kr/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/markdown.css'
import './styles/callout.css'
import './styles/frontmatter.css'
import './styles/wikilink.css'

import { getPref } from './app/prefs.js'
import { resolveTheme } from './app/theme.js'
import App from './app/App.jsx'

// 첫 화면 그리기 전에 반영해 서체가 바뀌며 깜빡이지 않게 한다 (specs/features/F-121.md, F-141)
document.documentElement.dataset.headingFont = getPref('md.headingFont', 'serif')
document.documentElement.dataset.bodyFont = getPref('md.bodyFont', 'sans')
document.documentElement.dataset.fontSize = getPref('md.fontSize', 'medium') // F-154 2.2
document.documentElement.dataset.indent = getPref('md.indent', '4') // F-154 2.3
document.documentElement.dataset.theme = resolveTheme(
  getPref('md.theme', 'system'),
  window.matchMedia('(prefers-color-scheme: dark)').matches,
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
