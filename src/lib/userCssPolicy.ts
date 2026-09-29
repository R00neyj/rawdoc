// 사용자 CSS 상수·타입·스니펫 검증·부팅 저장 모양 — 서버도 쓰므로 ES2022 만, 토크나이저 import 금지 (F-2094 3.3)

export const USER_CSS_MAX_SNIPPETS = 50
export const USER_CSS_MAX_TOTAL_BYTES = 262_144
export const USER_CSS_MAX_NAME_LENGTH = 60
export const USER_CSS_MAX_BODY_BYTES = 540_672
export const USER_CSS_CHECKER_VERSION = 1

export const USER_CSS_ALLOWED_AT_RULES: readonly string[] = [
  'media', 'supports', 'container', 'layer', 'scope', 'starting-style',
  'keyframes', '-webkit-keyframes',
  'font-face',
  'page',
  'top-left-corner', 'top-left', 'top-center', 'top-right', 'top-right-corner',
  'bottom-left-corner', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-right-corner',
  'left-top', 'left-middle', 'left-bottom', 'right-top', 'right-middle', 'right-bottom',
  'charset',
]

export const USER_CSS_ALLOWED_RULE_KINDS: readonly string[] = [
  'CSSStyleRule', 'CSSNestedDeclarations', 'CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule',
  'CSSLayerBlockRule', 'CSSLayerStatementRule', 'CSSKeyframesRule', 'CSSKeyframeRule', 'CSSFontFaceRule',
  'CSSPageRule', 'CSSMarginRule', 'CSSStartingStyleRule', 'CSSScopeRule',
]

export type UserCssSnippet = { id: string; name: string; css: string; enabled: boolean; updatedAt: number }

export type UserCssRemovalReason =
  | 'import' | 'rule-kind' | 'font-src' | 'url' | 'custom-property' | 'substitution' | 'unstable'
export type UserCssRemoval = {
  reason: UserCssRemovalReason
  rule: string
  property: string | null
}
export type UserCssCompiled = {
  css: string
  ruleCount: number
  removed: readonly UserCssRemoval[]
}

export type UserCssBoot = {
  v: number
  local: string[]
  account: { userId: string; sheets: string[] } | null
}

export type SnippetNameProblem = 'empty' | 'too-long' | 'untrimmed' | 'control'
export type UserCssValidation =
  | { ok: true; snippets: UserCssSnippet[] }
  | { ok: false; error: 'invalid'; field: string }
  | { ok: false; error: 'too_large' }

export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) bytes += 1
    else if (c < 0x800) bytes += 2
    else if (c >= 0xd800 && c <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

const isControl = (c: number) => c <= 0x1f || (c >= 0x7f && c <= 0x9f)

export function checkSnippetName(name: string): SnippetNameProblem | null {
  if (name.length === 0) return 'empty'
  if (name.length > USER_CSS_MAX_NAME_LENGTH) return 'too-long'
  if (name !== name.trim()) return 'untrimmed'
  for (let i = 0; i < name.length; i++) if (isControl(name.charCodeAt(i))) return 'control'
  return null
}

function totalBytes(snippets: readonly { css: string }[]): number {
  let total = 0
  for (const s of snippets) total += utf8ByteLength(s.css)
  return total
}

export function checkUserCssLimits(snippets: readonly { css: string }[]): 'count' | 'bytes' | null {
  if (snippets.length > USER_CSS_MAX_SNIPPETS) return 'count'
  return totalBytes(snippets) > USER_CSS_MAX_TOTAL_BYTES ? 'bytes' : null
}

const SNIPPET_ID = /^[0-9a-f]{16}$/

function snippetProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  const o = value as Record<string, unknown>
  if (typeof o.id !== 'string' || !SNIPPET_ID.test(o.id)) return '.id'
  if (typeof o.name !== 'string' || checkSnippetName(o.name) !== null) return '.name'
  if (typeof o.css !== 'string') return '.css'
  if (typeof o.enabled !== 'boolean') return '.enabled'
  if (typeof o.updatedAt !== 'number' || !Number.isSafeInteger(o.updatedAt) || o.updatedAt < 0) return '.updatedAt'
  return null
}

export function validateUserCssSnippets(value: unknown): UserCssValidation {
  if (!Array.isArray(value) || value.length > USER_CSS_MAX_SNIPPETS) return { ok: false, error: 'invalid', field: 'snippets' }
  for (let i = 0; i < value.length; i++) {
    const problem = snippetProblem(value[i])
    if (problem !== null) return { ok: false, error: 'invalid', field: `snippets[${i}]${problem}` }
  }
  const snippets = (value as UserCssSnippet[]).map(({ id, name, css, enabled, updatedAt }) => ({ id, name, css, enabled, updatedAt }))
  const seen = new Set<string>()
  for (let i = 0; i < snippets.length; i++) {
    if (seen.has(snippets[i].id)) return { ok: false, error: 'invalid', field: `snippets[${i}].id` }
    seen.add(snippets[i].id)
  }
  if (totalBytes(snippets) > USER_CSS_MAX_TOTAL_BYTES) return { ok: false, error: 'too_large' }
  return { ok: true, snippets }
}

export function buildUserCssBoot(
  local: readonly UserCssSnippet[],
  account: { userId: string; snippets: readonly UserCssSnippet[] } | null,
  compile: (source: string) => UserCssCompiled,
): UserCssBoot {
  const sheets = (list: readonly UserCssSnippet[]) => list.filter((s) => s.enabled).map((s) => compile(s.css).css)
  return {
    v: USER_CSS_CHECKER_VERSION,
    local: sheets(local),
    account: account ? { userId: account.userId, sheets: sheets(account.snippets) } : null,
  }
}
