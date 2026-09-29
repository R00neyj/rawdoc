// 사용자 CSS 시트 묶음·부팅 이어받기·안전 모드 주소·컴파일 캐시·조합 미룸 (specs/features/F-2095.md 4·5장)
import { compileUserCss } from './userCssCompile'
import type { UserCssCompiled } from '../lib/userCssPolicy'
import { USER_CSS_ATTR, USER_CSS_HANDOFF, USER_CSS_REV_ATTR } from './bootPaint'

export type UserCssItem = { name: string; css: string }
export type UserCssMode = 'on' | 'off' | 'safe'
export type UserCssDoc = {
  adoptedStyleSheets: CSSStyleSheet[]
  documentElement: Pick<Element, 'getAttribute' | 'setAttribute'>
  defaultView: object | null
}
export type UserCssSheets = {
  apply(items: readonly UserCssItem[] | null, mode: UserCssMode): void
  applied(): readonly UserCssItem[]
}

function queryParts(search: string): string[] {
  return (search.charAt(0) === '?' ? search.slice(1) : search).split('&')
}

// 부팅 스크립트와 같은 규칙 — 디코딩 없이 첫 = 앞이 정확히 safe (2장 5)
function isSafePart(part: string): boolean {
  const eq = part.indexOf('=')
  return (eq === -1 ? part : part.slice(0, eq)) === 'safe'
}

export function hasSafeParam(search: string): boolean {
  return queryParts(search).some(isSafePart)
}

export function urlWithoutSafe(pathname: string, search: string, hash: string): string {
  const rest = queryParts(search).filter((part) => part !== '' && !isSafePart(part))
  return `${pathname}${rest.length > 0 ? `?${rest.join('&')}` : ''}${hash}`
}

export function planUserCssSheets(prev: readonly string[], next: readonly string[]): (number | null)[] {
  const used = new Set<number>()
  return next.map((text) => {
    for (let i = 0; i < prev.length; i++) {
      if (!used.has(i) && prev[i] === text) {
        used.add(i)
        return i
      }
    }
    return null
  })
}

type Handoff = { sheets: CSSStyleSheet[]; texts: string[] }

function takeHandoff(doc: UserCssDoc): Handoff | null {
  const view = doc.defaultView as Record<string, unknown> | null
  if (!view) return null
  const raw = view[USER_CSS_HANDOFF] as Partial<Handoff> | null | undefined
  delete view[USER_CSS_HANDOFF]
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sheets) || !Array.isArray(raw.texts)) return null
  if (raw.sheets.length !== raw.texts.length || raw.texts.some((t) => typeof t !== 'string')) return null
  const current = doc.adoptedStyleSheets
  if (!raw.sheets.every((sheet) => current.includes(sheet))) return null
  return { sheets: raw.sheets, texts: raw.texts }
}

export function createUserCssSheets(doc: UserCssDoc, createSheet: () => CSSStyleSheet = () => new CSSStyleSheet()): UserCssSheets {
  const handoff = takeHandoff(doc)
  let owned: CSSStyleSheet[] = handoff ? handoff.sheets : []
  let ownedTexts: string[] = handoff ? handoff.texts : []
  let appliedItems: readonly UserCssItem[] = []

  function build(text: string): CSSStyleSheet {
    const sheet = createSheet()
    try {
      sheet.replaceSync(text)
      return sheet
    } catch {
      return createSheet()
    }
  }

  return {
    apply(items, mode) {
      const texts = (items ?? []).map((item) => item.css)
      const plan = planUserCssSheets(ownedTexts, texts)
      const next = plan.map((slot, i) => (slot === null ? build(texts[i]) : owned[slot]))
      const current = doc.adoptedStyleSheets
      const target = [...current.filter((sheet) => !owned.includes(sheet)), ...next]
      const same = target.length === current.length && target.every((sheet, i) => sheet === current[i])
      const root = doc.documentElement
      if (!same) {
        doc.adoptedStyleSheets = target
        const rev = Number(root.getAttribute(USER_CSS_REV_ATTR))
        root.setAttribute(USER_CSS_REV_ATTR, String((Number.isSafeInteger(rev) && rev > 0 ? rev : 0) + 1))
      }
      root.setAttribute(USER_CSS_ATTR, mode)
      owned = next
      ownedTexts = texts
      appliedItems = items ? items.map((item) => ({ ...item })) : []
    },
    applied: () => appliedItems,
  }
}

let sharedSheets: UserCssSheets | null = null

// 앱 전체가 쓰는 하나 — 처음 부를 때 부팅 시트를 이어받는다
export function userCssSheets(): UserCssSheets {
  sharedSheets ??= createUserCssSheets(document)
  return sharedSheets
}

export function appliedUserCss(): readonly UserCssItem[] {
  return sharedSheets ? sharedSheets.applied() : []
}

const compileCache = new Map<string, UserCssCompiled>()

export function compileCached(source: string): UserCssCompiled {
  let compiled = compileCache.get(source)
  if (!compiled) {
    compiled = compileUserCss(source)
    compileCache.set(source, compiled)
  }
  return compiled
}

export function pruneCompileCache(keep: Iterable<string>): void {
  const wanted = new Set(keep)
  for (const source of compileCache.keys()) if (!wanted.has(source)) compileCache.delete(source)
}

export function createDeferredRun(i: { isComposing: () => boolean; run: () => void }): { request(): void; flush(): void } {
  let pending = false
  return {
    request() {
      if (i.isComposing()) pending = true
      else {
        pending = false
        i.run()
      }
    },
    flush() {
      if (!pending || i.isComposing()) return
      pending = false
      i.run()
    },
  }
}
