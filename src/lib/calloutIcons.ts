// 콜아웃 종류 → 아이콘 (specs/features/F-148.md 2장)
// 순수 함수 + svg 원문(Material Symbols Outlined 400, ?raw). DOM 없음 — 편집 모드 위젯(lines.js)과
// 보기 모드 렌더러(renderMarkdown.js)가 함께 쓴다. 색은 쓰는 쪽이 CSS currentColor 로 준다
import editSvg from '@material-symbols/svg-400/outlined/edit.svg?raw'
import summarizeSvg from '@material-symbols/svg-400/outlined/summarize.svg?raw'
import infoSvg from '@material-symbols/svg-400/outlined/info.svg?raw'
import checkCircleSvg from '@material-symbols/svg-400/outlined/check_circle.svg?raw'
import localFireDepartmentSvg from '@material-symbols/svg-400/outlined/local_fire_department.svg?raw'
import checkSvg from '@material-symbols/svg-400/outlined/check.svg?raw'
import helpSvg from '@material-symbols/svg-400/outlined/help.svg?raw'
import warningSvg from '@material-symbols/svg-400/outlined/warning.svg?raw'
import closeSvg from '@material-symbols/svg-400/outlined/close.svg?raw'
import boltSvg from '@material-symbols/svg-400/outlined/bolt.svg?raw'
import bugReportSvg from '@material-symbols/svg-400/outlined/bug_report.svg?raw'
import formatListBulletedSvg from '@material-symbols/svg-400/outlined/format_list_bulleted.svg?raw'
import formatQuoteSvg from '@material-symbols/svg-400/outlined/format_quote.svg?raw'

// 종류(별칭, 소문자) → Material Symbols 이름 (F-148 2장 표). callout.js 의 색 묶음
// 별칭(KIND_ALIASES)과는 다른 표다 — 예: note·info·todo 는 같은 색 묶음이지만 아이콘은 다르다
const ICON_ALIASES = {
  note: 'edit',

  abstract: 'summarize',
  summary: 'summarize',
  tldr: 'summarize',

  info: 'info',

  todo: 'check_circle',

  tip: 'local_fire_department',
  hint: 'local_fire_department',
  important: 'local_fire_department',

  success: 'check',
  check: 'check',
  done: 'check',

  question: 'help',
  help: 'help',
  faq: 'help',

  warning: 'warning',
  caution: 'warning',
  attention: 'warning',

  failure: 'close',
  fail: 'close',
  missing: 'close',

  danger: 'bolt',
  error: 'bolt',

  bug: 'bug_report',

  example: 'format_list_bulleted',

  quote: 'format_quote',
  cite: 'format_quote',
}

const ICON_SVG = {
  edit: editSvg,
  summarize: summarizeSvg,
  info: infoSvg,
  check_circle: checkCircleSvg,
  local_fire_department: localFireDepartmentSvg,
  check: checkSvg,
  help: helpSvg,
  warning: warningSvg,
  close: closeSvg,
  bolt: boltSvg,
  bug_report: bugReportSvg,
  format_list_bulleted: formatListBulletedSvg,
  format_quote: formatQuoteSvg,
}

/**
 * 종류 이름 → Material Symbols 이름. 별칭 목록에 없으면 note 와 같은 'edit' (F-148 2장 마지막 행)
 * @param {string} type 적힌 그대로의 종류 이름
 * @returns {string}
 */
export function calloutIconName(type) {
  return ICON_ALIASES[type.toLowerCase()] ?? 'edit'
}

// 종류 이름 → 아이콘 svg 원문 (파일 내용 그대로, `<svg …>…</svg>`)
export function calloutIconSvg(type) {
  return ICON_SVG[calloutIconName(type)]
}
