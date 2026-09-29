// 사용자 CSS 탭·편집 대화상자의 순수 함수 (specs/features/F-2096.md 5장)
import { USER_CSS_MAX_TOTAL_BYTES, utf8ByteLength } from '../lib/userCssPolicy'
import type { UserCssCompiled, UserCssSnippet } from '../lib/userCssPolicy'

export function newSnippetId(random: Uint8Array): string {
  return Array.from(random.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

function smallestFree(names: ReadonlySet<string>, label: (n: number) => string, from: number): string {
  let n = from
  while (names.has(label(n))) n++
  return label(n)
}

export function nextSnippetName(names: readonly string[], kind: 'snippet' | 'template'): string {
  const used = new Set(names)
  if (kind === 'snippet') return smallestFree(used, (n) => `스니펫 ${n}`, 1)
  return used.has('템플릿') ? smallestFree(used, (n) => `템플릿 ${n}`, 2) : '템플릿'
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g

export function cleanSnippetName(raw: string): string {
  return raw.trim().replace(CONTROL_CHARS, '').trim()
}

export function replaceSnippet(list: readonly UserCssSnippet[], next: UserCssSnippet): UserCssSnippet[] | null {
  if (!list.some((s) => s.id === next.id)) return null
  return list.map((s) => (s.id === next.id ? next : s))
}

export function removeSnippet(list: readonly UserCssSnippet[], id: string): UserCssSnippet[] {
  return list.filter((s) => s.id !== id)
}

export function exceedsUserCssBytes(otherBytes: number, css: string): boolean {
  return otherBytes + utf8ByteLength(css) > USER_CSS_MAX_TOTAL_BYTES
}

export function userCssStatusLines(compiled: UserCssCompiled, enabled: boolean): string[] {
  const unstable = compiled.removed.some((r) => r.reason === 'unstable')
  const external = compiled.removed.filter((r) => r.reason !== 'unstable').length
  const lines: string[] = []
  if (!enabled) lines.push('꺼져 있어 적용하지 않습니다')
  else if (unstable) lines.push('검사를 통과하지 못해 이 스니펫을 적용하지 않았습니다.')
  else lines.push(`규칙 ${compiled.ruleCount}개 적용 중`)
  if (external > 0) lines.push(`외부 파일을 부르는 부분 ${external}곳을 빼고 적용했습니다.`)
  return lines
}

const SAVE_MESSAGES = {
  count: '스니펫은 50개까지 만들 수 있습니다.',
  bytes: 'CSS 는 모두 합쳐 256KB 까지 저장할 수 있습니다.',
  invalid: '스니펫을 저장하지 못했습니다.',
  quota: '브라우저 저장 공간이 모자라 저장하지 못했습니다.',
} as const

export function userCssSaveMessage(code: 'count' | 'bytes' | 'invalid' | 'quota'): string {
  return SAVE_MESSAGES[code]
}

export const USER_CSS_SAFE_LINE = '안전 모드 — 이 창에서는 사용자 CSS 를 적용하지 않습니다.'
