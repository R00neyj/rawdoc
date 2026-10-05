// 사용법 글 custom-css ↔ 사용자 CSS 계약·상한 대조 (specs/features/F-2092.md 5.7, 6장 F-2100)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CHROME_HOOKS, CONTENT_HOOKS, PUBLIC_VARS, STATE_ATTRS, USER_CSS_GUIDE_PATH } from '../../../src/lib/userCssContract'
import {
  USER_CSS_ALLOWED_AT_RULES,
  USER_CSS_MAX_NAME_LENGTH,
  USER_CSS_MAX_SNIPPETS,
  USER_CSS_MAX_TOTAL_BYTES,
} from '../../../src/lib/userCssPolicy'

const GUIDE_FILE = fileURLToPath(new URL('../../../content/guides/custom-css.md', import.meta.url))
const raw = readFileSync(GUIDE_FILE, 'utf-8').replace(/\r\n/g, '\n')
const PREFIX = ':root:root '

// `## {name}` 절 본문 — 다음 ## 앞까지
function section(name: string): string {
  const start = raw.indexOf(`\n## ${name}\n`)
  expect(start, `## ${name} 절이 없다`).toBeGreaterThan(-1)
  const next = raw.indexOf('\n## ', start + 1)
  return raw.slice(start, next === -1 ? raw.length : next)
}

const strip = (selector: string) => (selector.startsWith(PREFIX) ? selector.slice(PREFIX.length) : selector)

// 마지막 복합 선택자의 마지막 조각 — `.cm-editor .cm-line.md-h6` → `.md-h6`, `.markdown-body h6` → `h6`
function tail(selector: string): string {
  return selector.slice(Math.max(selector.lastIndexOf('.'), selector.lastIndexOf(' ') + 1))
}

// 선택자 목록이 글에 모두 있다 — 하나씩 적었거나 `첫 선택자` ~ `마지막 조각` 범위로 적었다
function listedIn(text: string, selectors: readonly string[]): boolean {
  const all = selectors.map(strip)
  if (all.every((s) => text.includes(`\`${s}\``))) return true
  return all.length > 1 && text.includes(`\`${all[0]}\` ~ \`${tail(all[all.length - 1])}\``)
}

describe('custom-css 글 ↔ 계약', () => {
  it('USER_CSS_GUIDE_PATH 가 이 글(파일을 읽었다)을 가리킨다', () => {
    expect(USER_CSS_GUIDE_PATH).toBe('/guides/custom-css')
  })

  it('공개 변수가 전부 약속된 변수 절에 있고, 글이 쓴 변수는 모두 공개 변수다', () => {
    const text = section('약속된 변수')
    for (const v of PUBLIC_VARS) expect(text, v.name).toContain(`\`${v.name}\``)
    const names = new Set(PUBLIC_VARS.map((v) => v.name))
    for (const m of raw.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)) expect(names.has(m[0] as `--${string}`), m[0]).toBe(true)
  })

  it('뼈대 훅 값이 전부 화면 뼈대 훅 절에 있고, 글이 쓴 data-ui 값은 모두 훅이다', () => {
    const text = section('화면 뼈대 훅')
    for (const hook of CHROME_HOOKS) expect(text, hook.value).toContain(`\`${hook.value}\``)
    const values = new Set(CHROME_HOOKS.map((h) => h.value))
    for (const m of raw.matchAll(/data-ui="([^"]+)"/g)) expect(values.has(m[1]), m[1]).toBe(true)
  })

  it('본문 훅의 편집·보기 권장 선택자가 전부 본문 훅 절에 있고, 공통 앞부분이 :root:root 다', () => {
    const text = section('본문 훅')
    expect(text).toContain(`\`${PREFIX}\``)
    for (const hook of CONTENT_HOOKS) {
      for (const s of [...hook.edit, ...hook.view]) expect(s.startsWith(PREFIX), s).toBe(true)
      expect(listedIn(text, hook.edit), `${hook.id} 편집`).toBe(true)
      expect(listedIn(text, hook.view), `${hook.id} 보기`).toBe(true)
    }
  })

  it('글이 쓴 data-* 속성은 뼈대 훅이나 상태 속성이고, 테마 값이 상태 속성 값과 같다', () => {
    const attrs = new Set<string>(['data-ui', ...STATE_ATTRS.map((a) => a.name)])
    for (const m of raw.matchAll(/data-[a-z-]+/g)) expect(attrs.has(m[0]), m[0]).toBe(true)
    const theme = STATE_ATTRS.find((a) => a.name === 'data-theme')!
    expect(raw).toContain(`\`:root[data-theme='${theme.values[0]}']\``)
    for (const value of theme.values.slice(1)) expect(raw).toContain(`\`'${value}'\``)
    const viewMode = STATE_ATTRS.find((a) => a.name === 'data-view-mode')!
    expect(raw).toContain(viewMode.values.map((v) => `\`${v}\``).join('·'))
  })

  it('쓸 수 있다고 적은 @ 규칙은 허용 목록에 있고, 허용 목록의 주요 규칙이 빠지지 않았다', () => {
    const line = raw.split('\n').find((l) => l.includes('쓸 수 있는 것은'))!
    const listed = [...line.slice(line.indexOf('쓸 수 있는 것은')).matchAll(/`@([a-z-]+)`/g)].map((m) => m[1])
    for (const name of listed) expect(USER_CSS_ALLOWED_AT_RULES, name).toContain(name)
    const main = USER_CSS_ALLOWED_AT_RULES.filter((n) => !n.startsWith('-') && !/^(top|bottom|left|right)-/.test(n) && n !== 'charset')
    expect(listed.sort()).toEqual([...main].sort())
  })
})

describe('custom-css 글 ↔ 상한 (R5)', () => {
  it('스니펫 수·합계 크기·이름 길이가 userCssPolicy 상수와 같다', () => {
    expect(raw).toContain(`스니펫은 ${USER_CSS_MAX_SNIPPETS}개까지`)
    expect(raw).toContain(`${USER_CSS_MAX_TOTAL_BYTES / 1024}KB(${USER_CSS_MAX_TOTAL_BYTES.toLocaleString('en-US')}바이트)까지`)
    expect(raw).toContain(`이름은 ${USER_CSS_MAX_NAME_LENGTH}자까지`)
  })
})
