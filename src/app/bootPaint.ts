// 첫 페인트 전 <html> 에 테마·사이드바 값을 넣는 머리 스크립트 + 인계 뒤 스켈레톤 정리 (specs/features/F-2015.md 4·5장)
import {
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH_CAP,
  MAX_SIDEBAR_WIDTH_MARGIN,
  DEFAULT_SIDEBAR_WIDTH,
} from './sidebarWidth'
import {
  MIN_CONTENT_WIDTH,
  MAX_CONTENT_WIDTH,
  CONTENT_WIDTH_STEP,
  DEFAULT_CONTENT_WIDTH,
  CONTENT_WIDTH_VAR,
} from './contentWidth'

export const BOOT_SKELETON_ID = 'boot-skeleton'
export const BOOT_VIEW_ATTR = 'data-boot-view'
export const BOOT_SIDEBAR_ATTR = 'data-boot-sidebar'
export const BOOT_SIDEBAR_WIDTH_VAR = '--boot-sidebar-w'

const THEME_KEY = 'md.theme'
const SIDEBAR_KEY = 'md.sidebar'
const SIDEBAR_WIDTH_KEY = 'md.sidebarWidth'
const START_SCREEN_KEY = 'md.startScreen'
const CONTENT_WIDTH_KEY = 'md.contentWidth'

const themeKeyJson = JSON.stringify(THEME_KEY)
const sidebarKeyJson = JSON.stringify(SIDEBAR_KEY)
const sidebarWidthKeyJson = JSON.stringify(SIDEBAR_WIDTH_KEY)
const startScreenKeyJson = JSON.stringify(START_SCREEN_KEY)
const contentWidthKeyJson = JSON.stringify(CONTENT_WIDTH_KEY)
const viewAttrJson = JSON.stringify(BOOT_VIEW_ATTR)
const sidebarAttrJson = JSON.stringify(BOOT_SIDEBAR_ATTR)
const sidebarWidthVarJson = JSON.stringify(BOOT_SIDEBAR_WIDTH_VAR)
const contentWidthVarJson = JSON.stringify(CONTENT_WIDTH_VAR)
const minJson = JSON.stringify(MIN_SIDEBAR_WIDTH)
const maxCapJson = JSON.stringify(MAX_SIDEBAR_WIDTH_CAP)
const maxMarginJson = JSON.stringify(MAX_SIDEBAR_WIDTH_MARGIN)
const defaultJson = JSON.stringify(DEFAULT_SIDEBAR_WIDTH)
const contentMinJson = JSON.stringify(MIN_CONTENT_WIDTH)
const contentMaxJson = JSON.stringify(MAX_CONTENT_WIDTH)
const contentStepJson = JSON.stringify(CONTENT_WIDTH_STEP)
const contentDefaultJson = JSON.stringify(DEFAULT_CONTENT_WIDTH)

// 클래식 스크립트(모듈 아님) — document·localStorage·matchMedia·location·innerWidth 다섯 전역만 쓴다 (4.3)
export const BOOT_PAINT_SCRIPT = `(function () {
  try {
    var el = document.documentElement
    function readPref(key) {
      try { return localStorage.getItem(key) } catch (e) { return null }
    }

    try {
      var themes = ['white', 'sepia', 'dark']
      var pref = readPref(${themeKeyJson})
      var dark = false
      try { dark = matchMedia('(prefers-color-scheme: dark)').matches } catch (e) {}
      var theme = themes.indexOf(pref) !== -1 ? pref : (dark ? 'dark' : 'white')
      el.setAttribute('data-theme', theme)
    } catch (e) {}

    try {
      var stored = readPref(${sidebarWidthKeyJson})
      var width
      if (stored === null || stored === undefined || stored === '') {
        width = ${defaultJson}
      } else {
        var n = Number(stored)
        width = (!isFinite(n) || Math.floor(n) !== n || n < ${minJson} || n > ${maxCapJson}) ? ${defaultJson} : n
      }
      var maxW = Math.min(${maxCapJson}, innerWidth - ${maxMarginJson})
      var maxFloor = Math.max(maxW, ${minJson})
      var clamped = Math.min(Math.max(width, ${minJson}), maxFloor)
      el.style.setProperty(${sidebarWidthVarJson}, clamped + 'px')
    } catch (e) {}

    try {
      if (readPref(${sidebarKeyJson}) === 'collapsed') el.setAttribute(${sidebarAttrJson}, 'collapsed')
    } catch (e) {}

    try {
      var storedContentWidth = readPref(${contentWidthKeyJson})
      var contentWidth
      if (storedContentWidth === null || storedContentWidth === undefined || storedContentWidth === '') {
        contentWidth = ${contentDefaultJson}
      } else {
        var cn = Number(storedContentWidth)
        contentWidth =
          !isFinite(cn) ||
          Math.floor(cn) !== cn ||
          cn < ${contentMinJson} ||
          cn > ${contentMaxJson} ||
          cn % ${contentStepJson} !== 0
            ? ${contentDefaultJson}
            : cn
      }
      el.style.setProperty(${contentWidthVarJson}, contentWidth + 'px')
    } catch (e) {}

    try {
      var path = location.pathname
      var hash = location.hash
      function segments(p) {
        var raw = p.split('/')
        var out = []
        for (var i = 0; i < raw.length; i++) {
          if (raw[i] !== '') out.push(raw[i])
        }
        return out
      }
      function hashStarts(prefix) {
        return hash.length > prefix.length && hash.slice(0, prefix.length) === prefix
      }
      var pathParts = segments(path)
      var isPathPublic = pathParts.length === 2 && pathParts[0] === 'p' && pathParts[1].length > 0
      var isPathPublicFolder =
        pathParts.length === 3 && pathParts[0] === 'p' && pathParts[1] === 'f' && pathParts[2].length > 0
      var view = 'home'
      if (isPathPublic || isPathPublicFolder || hashStarts('#/p/f/') || hashStarts('#/p/')) {
        view = 'off'
      } else if (hashStarts('#/d/')) {
        view = 'doc'
      } else if (hashStarts('#/s/') || hash === '#/shares' || hash === '#/help' || hash === '#/map' || hashStarts('#/map/')) {
        view = 'blank'
      } else if (readPref(${startScreenKeyJson}) === 'last') {
        view = 'doc'
      }
      el.setAttribute(${viewAttrJson}, view)
    } catch (e) {}
  } catch (e) {}
})()`

// #boot-skeleton 을 걷고 머리 스크립트가 남긴 속성을 지운다. data-theme 은 지우지 않는다 (5.3)
export function removeBootSkeleton(doc: Pick<Document, 'getElementById' | 'documentElement'>): void {
  try {
    const node = doc.getElementById(BOOT_SKELETON_ID)
    if (node) node.remove()
  } catch {
    // 노드가 없거나 이미 지워졌어도 밖으로 던지지 않는다
  }
  try {
    doc.documentElement.removeAttribute(BOOT_VIEW_ATTR)
    doc.documentElement.removeAttribute(BOOT_SIDEBAR_ATTR)
    doc.documentElement.style.removeProperty(BOOT_SIDEBAR_WIDTH_VAR)
  } catch {
    // 위와 같음
  }
}
