// 사용자 CSS 컴파일 = 필터 + 브라우저 재파싱 보조 검증, 무엇이든 걸리면 통째로 버린다 (F-2094 4.7)
import { filterUserCss } from '../lib/userCssFilter'
import { USER_CSS_ALLOWED_RULE_KINDS } from '../lib/userCssPolicy'
import type { UserCssCompiled, UserCssRemoval } from '../lib/userCssPolicy'

export type CssRuleLike = { readonly cssText: string; readonly cssRules?: ArrayLike<CssRuleLike> }
export type CssSheetLike = { replaceSync(text: string): void; readonly cssRules: ArrayLike<CssRuleLike> }

const ALLOWED_KINDS = new Set(USER_CSS_ALLOWED_RULE_KINDS)
const UNSTABLE: UserCssRemoval = { reason: 'unstable', rule: '', property: null }

function isBlank(css: string): boolean {
  let i = 0
  while (i < css.length) {
    const c = css.charCodeAt(i)
    if (c === 32 || c === 9 || c === 10) i++
    else if (c === 47 && css.charCodeAt(i + 1) === 42) {
      const close = css.indexOf('*/', i + 2)
      if (close < 0) return true
      i = close + 2
    } else return false
  }
  return true
}

function kindsAllowed(rules: ArrayLike<CssRuleLike>): boolean {
  const pending = [rules]
  for (let list = pending.pop(); list; list = pending.pop()) {
    for (let i = 0; i < list.length; i++) {
      const rule = list[i]
      if (!ALLOWED_KINDS.has(Object.prototype.toString.call(rule).slice(8, -1))) return false
      if (rule.cssRules) pending.push(rule.cssRules)
    }
  }
  return true
}

export function compileUserCss(source: string, createSheet: () => CssSheetLike = () => new CSSStyleSheet()): UserCssCompiled {
  let removed: readonly UserCssRemoval[] = []
  try {
    const filtered = filterUserCss(source)
    removed = filtered.removed
    if (isBlank(filtered.css)) return { css: filtered.css, ruleCount: 0, removed }
    const sheet = createSheet()
    sheet.replaceSync(filtered.css)
    const rules = sheet.cssRules
    const serialized = Array.from(rules, (rule) => rule.cssText).join('\n')
    if (kindsAllowed(rules) && filterUserCss(serialized).removed.length === 0) {
      return { css: filtered.css, ruleCount: rules.length, removed }
    }
  } catch {
    // 아래 실패 결과로 닫는다
  }
  return { css: '', ruleCount: 0, removed: [...removed, UNSTABLE] }
}
