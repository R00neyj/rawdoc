// 설정 대화상자·팔레트가 바꾸는 화면·편집기·자동 잠금 설정값과 시스템 테마 따라가기 (F-2063)
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { EditorHandle } from '../editor/Editor'
import { getPref, setPref } from './prefs'
import { resolveStoredContentWidth, CONTENT_WIDTH_VAR } from './contentWidth'
import { resolveTheme } from './theme'
import { resolveDefaultView, type DefaultView } from './defaultView'
import { NEW_DOC_TEMPLATE_NONE } from '../lib/templates'

export type UseAppearancePrefsOptions = {
  editorRef: RefObject<EditorHandle | null>
}

export type UseAppearancePrefsResult = {
  themePref: 'system' | 'white' | 'sepia' | 'dark'
  resolvedTheme: 'white' | 'sepia' | 'dark'
  headingFont: 'serif' | 'sans'
  bodyFont: 'sans' | 'serif'
  fontSizePref: 'small' | 'medium' | 'large'
  lineNumbersPref: 'on' | 'off'
  indentPref: '2' | '4'
  startScreenPref: 'home' | 'last'
  defaultViewPref: DefaultView
  toolbarPref: 'on' | 'off'
  wikiPreviewPref: string
  newDocTemplatePref: string
  e2eeLockMinutesPref: '5' | '15' | '30' | '60' | '240'
  contentWidthPref: number
  changeTheme: (value: string) => void
  changeHeadingFont: (value: string) => void
  changeBodyFont: (value: string) => void
  changeFontSize: (value: string) => void
  changeLineNumbers: (value: string) => void
  changeIndent: (value: string) => void
  changeStartScreen: (value: string) => void
  changeDefaultView: (value: string) => void
  changeToolbar: (value: string) => void
  changeWikiPreview: (value: string) => void
  changeNewDocTemplate: (value: string) => void
  changeE2eeLockMinutes: (value: string) => void
  changeContentWidth: (px: number) => void
}

export function useAppearancePrefs({ editorRef }: UseAppearancePrefsOptions): UseAppearancePrefsResult {
  const [headingFont, setHeadingFont] = useState(() => getPref('md.headingFont', 'serif'))
  const [bodyFont, setBodyFont] = useState(() => getPref('md.bodyFont', 'sans')) // F-141 3.3
  const [themePref, setThemePref] = useState(() => getPref('md.theme', 'system')) // F-141 3.1
  // 적용된 테마(white|sepia|dark, themePref 와 달리 'system' 을 시스템 설정으로 풀어낸 값) — mermaid 렌더링에 쓰인다(F-260 2.4)
  const [resolvedTheme, setResolvedTheme] = useState<'white' | 'sepia' | 'dark'>(() =>
    resolveTheme(getPref('md.theme', 'system'), typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches),
  )
  const [lineNumbersPref, setLineNumbersPref] = useState(() => getPref('md.lineNumbers', 'on')) // F-147 2장
  const [fontSizePref, setFontSizePref] = useState(() => getPref('md.fontSize', 'medium')) // F-154 2.2
  const [indentPref, setIndentPref] = useState(() => getPref('md.indent', '4')) // F-154 2.3
  const [startScreenPref, setStartScreenPref] = useState(() => getPref('md.startScreen', 'home')) // F-232 3.4
  const [defaultViewPref, setDefaultViewPref] = useState(() => resolveDefaultView(getPref('md.defaultView', 'remember'))) // F-2112 2.2
  const [toolbarPref, setToolbarPref] = useState(() => getPref('md.toolbar', 'on')) // F-233 3.5
  // 위키링크 미리보기 켜짐(기본 켬) — 모르는 값은 켬으로 다룬다(F-2044 8.1)
  const [wikiPreviewPref, setWikiPreviewPref] = useState(() => (getPref('md.wikiPreview', 'on') === 'off' ? 'off' : 'on'))
  const [newDocTemplatePref, setNewDocTemplatePref] = useState(() => getPref('md.newDocTemplate', NEW_DOC_TEMPLATE_NONE)) // F-2037 3.1
  const [e2eeLockMinutesPref, setE2eeLockMinutesPref] = useState(() => getPref('md.e2eeLockMinutes', '30')) // F-404 8.1
  // 본문 최대 너비(설정 → 편집기 탭) — 저장값은 창 폭과 무관, 값마다 바로 반영·저장한다 (F-2043 2.1·4.3)
  const [contentWidthPref, setContentWidthPref] = useState(() => resolveStoredContentWidth(getPref('md.contentWidth', '')))

  // ----- 테마: 시스템 설정을 즉시 따라간다 (F-141 3.1 A3) -----
  useEffect(() => {
    if (themePref !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    function apply() {
      const resolved = resolveTheme('system', mql.matches)
      document.documentElement.dataset.theme = resolved
      setResolvedTheme(resolved)
      editorRef.current?.setTheme(resolved) // F-260 2.4 — mermaid 위젯 즉시 재렌더
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [themePref, editorRef])

  // SettingsDialog 가 여러 설정을 같은 Segment 로 그려 값이 string 으로 오지만, 실제 값은 항상 그 설정의 고정 옵션 중 하나다
  function changeHeadingFont(value: string) {
    const v = value as 'serif' | 'sans'
    setHeadingFont(v)
    document.documentElement.dataset.headingFont = v
    setPref('md.headingFont', v)
  }

  function changeBodyFont(value: string) {
    const v = value as 'sans' | 'serif'
    setBodyFont(v)
    document.documentElement.dataset.bodyFont = v
    setPref('md.bodyFont', v)
  }

  function changeTheme(value: string) {
    const v = value as 'system' | 'white' | 'sepia' | 'dark'
    setThemePref(v)
    setPref('md.theme', v)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const resolved = resolveTheme(v, prefersDark)
    document.documentElement.dataset.theme = resolved
    setResolvedTheme(resolved)
    editorRef.current?.setTheme(resolved) // F-260 2.4 — mermaid 위젯 즉시 재렌더
  }

  // 설정 마지막 항목: 줄 번호(거터) 켜기·끄기. 실제 반영은 아래 useLayoutEffect 가 한다 (F-147 2장)
  function changeLineNumbers(value: string) {
    const v = value as 'on' | 'off'
    setLineNumbersPref(v)
    setPref('md.lineNumbers', v)
  }

  // 글자 크기 — <html data-font-size> 로 즉시 반영 (F-154 2.2)
  function changeFontSize(value: string) {
    const v = value as 'small' | 'medium' | 'large'
    setFontSizePref(v)
    document.documentElement.dataset.fontSize = v
    setPref('md.fontSize', v)
  }

  // 자동 잠금 — 검사할 때마다 새로 읽으므로 다음 검사(최대 15초 뒤)부터 반영된다 (F-404.md 4.3)
  function changeE2eeLockMinutes(value: string) {
    const v = value as '5' | '15' | '30' | '60' | '240'
    setE2eeLockMinutesPref(v)
    setPref('md.e2eeLockMinutes', v)
  }

  // 들여쓰기 — 실제 에디터 반영은 아래 useLayoutEffect 가 한다 (F-154 2.3)
  function changeIndent(value: string) {
    const v = value as '2' | '4'
    setIndentPref(v)
    setPref('md.indent', v)
  }

  // 시작 화면 — 저장은 다음에 앱을 열 때부터 적용, 지금 화면은 강제로 바꾸지 않는다 (F-232 3.4)
  function changeStartScreen(value: string) {
    const v = value as 'home' | 'last'
    setStartScreenPref(v)
    setPref('md.startScreen', v)
  }

  // 기본 뷰 — 다음 부팅부터 적용, 지금 모드와 md.viewMode 는 건드리지 않는다 (F-2112 2.2)
  function changeDefaultView(value: string) {
    const v = resolveDefaultView(value)
    setDefaultViewPref(v)
    setPref('md.defaultView', v)
  }

  // 탭바 표시·숨김 — 즉시 반영(F-233 3.5, A6)
  function changeToolbar(value: string) {
    const v = value as 'on' | 'off'
    setToolbarPref(v)
    setPref('md.toolbar', v)
  }

  // 위키링크 미리보기 표시·숨김 — 즉시 반영, 끄면 열린 창이 닫힌다(F-2044 8.2, 4.1)
  function changeWikiPreview(value: string) {
    const v = value === 'off' ? 'off' : 'on'
    setWikiPreviewPref(v)
    setPref('md.wikiPreview', v)
  }

  // 새 문서 템플릿 — 고르면 곧바로 반영(F-2037.md 3.2). 이 값 자체를 화면에 즉시 적용할 문서는 없다
  function changeNewDocTemplate(value: string) {
    setNewDocTemplatePref(value)
    setPref('md.newDocTemplate', value)
  }

  // 본문 너비 — 슬라이더는 끄는 동안마다, 숫자 입력은 확정될 때마다 부른다. 들어오는 값은 늘 정확한 값이다 (F-2043 4.3)
  function changeContentWidth(px: number) {
    if (px === contentWidthPref) return
    setContentWidthPref(px)
    document.documentElement.style.setProperty(CONTENT_WIDTH_VAR, `${px}px`)
    setPref('md.contentWidth', String(px))
  }

  return {
    themePref, resolvedTheme, headingFont, bodyFont, fontSizePref, lineNumbersPref, indentPref, startScreenPref,
    defaultViewPref, toolbarPref, wikiPreviewPref, newDocTemplatePref, e2eeLockMinutesPref, contentWidthPref,
    changeTheme, changeHeadingFont, changeBodyFont, changeFontSize, changeLineNumbers, changeIndent, changeStartScreen,
    changeDefaultView, changeToolbar, changeWikiPreview, changeNewDocTemplate, changeE2eeLockMinutes, changeContentWidth,
  }
}
