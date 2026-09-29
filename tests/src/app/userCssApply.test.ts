// 사용자 CSS 적용 도구 (specs/features/F-2095.md 7.1)
import { beforeEach, describe, expect, test, vi } from 'vitest'

const compileSpy = vi.hoisted(() => vi.fn((source: string) => ({ css: `c:${source}`, ruleCount: 1, removed: [] })))
vi.mock('../../../src/app/userCssCompile', () => ({ compileUserCss: compileSpy }))

import {
  compileCached,
  createDeferredRun,
  createUserCssSheets,
  hasSafeParam,
  planUserCssSheets,
  pruneCompileCache,
  urlWithoutSafe,
  type UserCssDoc,
} from '../../../src/app/userCssApply'
import { USER_CSS_ATTR, USER_CSS_HANDOFF, USER_CSS_REV_ATTR } from '../../../src/app/bootPaint'

describe('hasSafeParam', () => {
  test('질의 조각의 첫 = 앞이 정확히 safe', () => {
    for (const s of ['?safe', '?safe=1', '?app=1&safe', '?&safe', '?a=1&safe=&b']) expect(hasSafeParam(s), s).toBe(true)
    for (const s of ['?safer', '?Safe', '?%73afe', '?a=safe', '', '?']) expect(hasSafeParam(s), s).toBe(false)
  })
})

describe('urlWithoutSafe', () => {
  test('safe·빈 조각을 빼고 순서 유지, 해시 그대로', () => {
    expect(urlWithoutSafe('/', '?app=1&safe', '#/d/x')).toBe('/?app=1#/d/x')
    expect(urlWithoutSafe('/', '?a=1&safe=&b', '')).toBe('/?a=1&b')
    expect(urlWithoutSafe('/', '?safe', '#/d/x')).toBe('/#/d/x')
    expect(urlWithoutSafe('/', '?&safe&', '')).toBe('/')
    expect(urlWithoutSafe('/x', '?b=2&safe=1&a=1', '#h')).toBe('/x?b=2&a=1#h')
  })
})

describe('planUserCssSheets', () => {
  test('칸마다 아직 안 쓴, 글이 같은 가장 앞 칸', () => {
    expect(planUserCssSheets(['a', 'b'], ['b', 'a'])).toEqual([1, 0])
    expect(planUserCssSheets(['a'], ['a', 'a'])).toEqual([0, null])
    expect(planUserCssSheets([], ['x'])).toEqual([null])
    expect(planUserCssSheets(['a', 'a', 'b'], ['a', 'c', 'a'])).toEqual([0, null, 1])
    expect(planUserCssSheets(['a'], [])).toEqual([])
  })
})

type Sheet = { id: string; text: string | null; replaceSync(text: string): void }

function fakeDoc(initial: Sheet[], rev: string | null = null) {
  const attrs: Record<string, string> = {}
  if (rev !== null) attrs[USER_CSS_REV_ATTR] = rev
  let sheets: Sheet[] = initial
  let assigns = 0
  const win: Record<string, unknown> = {}
  const doc = {
    documentElement: {
      getAttribute: (name: string) => (name in attrs ? attrs[name] : null),
      setAttribute: (name: string, value: string) => {
        attrs[name] = value
      },
    },
    defaultView: win,
    get adoptedStyleSheets() {
      return sheets
    },
    set adoptedStyleSheets(next: Sheet[]) {
      assigns++
      sheets = next
    },
  }
  return { doc: doc as unknown as UserCssDoc, win, attrs, sheets: () => sheets, assigns: () => assigns }
}

let made = 0
function sheet(text: string | null = null, throwOn?: string): Sheet {
  return {
    id: `s${made++}`,
    text,
    replaceSync(t: string) {
      if (t === throwOn) throw new Error('parse')
      this.text = t
    },
  }
}
const factory = (throwOn?: string) => () => sheet(null, throwOn) as unknown as CSSStyleSheet
const items = (...css: string[]) => css.map((c, i) => ({ name: `n${i}`, css: c }))

describe('createUserCssSheets', () => {
  test('부팅과 글이 같으면 같은 객체, 대입 없음, rev 그대로, 이어받기 속성 지움', () => {
    const other = sheet('app')
    const a = sheet('a')
    const c = sheet('c')
    const f = fakeDoc([other, a, c], '1')
    f.win[USER_CSS_HANDOFF] = { sheets: [a, c], texts: ['a', 'c'] }
    const set = createUserCssSheets(f.doc, factory())
    expect(USER_CSS_HANDOFF in f.win).toBe(false)
    set.apply(items('a', 'c'), 'on')
    expect(f.sheets()).toEqual([other, a, c])
    expect(f.sheets()[1]).toBe(a)
    expect(f.sheets()[2]).toBe(c)
    expect(f.assigns()).toBe(0)
    expect(f.attrs[USER_CSS_REV_ATTR]).toBe('1')
    expect(f.attrs[USER_CSS_ATTR]).toBe('on')
    expect(set.applied()).toEqual(items('a', 'c'))
  })

  test('한 칸만 다르면 그 칸만 새로, 대입 한 번, rev + 1', () => {
    const a = sheet('a')
    const c = sheet('c')
    const f = fakeDoc([a, c], '1')
    f.win[USER_CSS_HANDOFF] = { sheets: [a, c], texts: ['a', 'c'] }
    const set = createUserCssSheets(f.doc, factory())
    set.apply(items('a', 'x'), 'on')
    expect(f.assigns()).toBe(1)
    expect(f.sheets()[0]).toBe(a)
    expect(f.sheets()[1]).not.toBe(c)
    expect(f.sheets().map((s) => s.text)).toEqual(['a', 'x'])
    expect(f.attrs[USER_CSS_REV_ATTR]).toBe('2')
    set.apply(items('x', 'a'), 'on')
    expect(f.assigns()).toBe(2)
    expect(f.attrs[USER_CSS_REV_ATTR]).toBe('3')
    expect(f.sheets().map((s) => s.text)).toEqual(['x', 'a'])
  })

  test('모양이 틀리거나 문서에 없는 이어받기는 무시하고 속성을 지운다', () => {
    const bad = [
      { sheets: [sheet('a')], texts: ['a'] },
      { sheets: 'x', texts: [] },
      { texts: ['a'] },
      null,
    ]
    for (const handoff of bad) {
      const inDoc = sheet('a')
      const f = fakeDoc([inDoc])
      f.win[USER_CSS_HANDOFF] = handoff
      const set = createUserCssSheets(f.doc, factory())
      expect(USER_CSS_HANDOFF in f.win).toBe(false)
      set.apply(items('a'), 'on')
      expect(f.sheets()[0]).toBe(inDoc)
      expect(f.sheets()).toHaveLength(2)
    }
    const a = sheet('a')
    const lenMismatch = fakeDoc([a])
    lenMismatch.win[USER_CSS_HANDOFF] = { sheets: [a], texts: ['a', 'b'] }
    createUserCssSheets(lenMismatch.doc, factory()).apply(items('a'), 'on')
    expect(lenMismatch.sheets()).toHaveLength(2)
  })

  test('남의 시트는 앞자리, 우리 것은 늘 맨 뒤', () => {
    const ours = sheet('a')
    const theirs = sheet('t')
    const f = fakeDoc([ours, theirs], '1')
    f.win[USER_CSS_HANDOFF] = { sheets: [ours], texts: ['a'] }
    const set = createUserCssSheets(f.doc, factory())
    set.apply(items('a'), 'on')
    expect(f.sheets()).toEqual([theirs, ours])
    expect(f.sheets()[1]).toBe(ours)
    expect(f.attrs[USER_CSS_REV_ATTR]).toBe('2')
  })

  test('null 이면 우리 시트 0개, 모드 그대로 표시', () => {
    const theirs = sheet('t')
    const a = sheet('a')
    const f = fakeDoc([theirs, a], '1')
    f.win[USER_CSS_HANDOFF] = { sheets: [a], texts: ['a'] }
    const set = createUserCssSheets(f.doc, factory())
    const nothing = null
    set.apply(nothing, 'safe')
    expect(f.sheets()).toEqual([theirs])
    expect(f.attrs[USER_CSS_ATTR]).toBe('safe')
    expect(f.attrs[USER_CSS_REV_ATTR]).toBe('2')
    expect(set.applied()).toEqual([])
    set.apply(nothing, 'off')
    expect(f.assigns()).toBe(1)
    expect(f.attrs[USER_CSS_ATTR]).toBe('off')
  })

  test('이어받기 없이 처음 적용하면 rev 1, 빈 목록은 대입 없음', () => {
    const f = fakeDoc([])
    const set = createUserCssSheets(f.doc, factory())
    set.apply([], 'off')
    expect(f.assigns()).toBe(0)
    expect(f.attrs[USER_CSS_REV_ATTR]).toBeUndefined()
    expect(f.attrs[USER_CSS_ATTR]).toBe('off')
    set.apply(items('a'), 'on')
    expect(f.attrs[USER_CSS_REV_ATTR]).toBe('1')
  })

  test('replaceSync 가 던진 칸은 빈 시트, 개수·순서 유지', () => {
    const f = fakeDoc([])
    const set = createUserCssSheets(f.doc, factory('bad'))
    set.apply(items('a', 'bad', 'c'), 'on')
    expect(f.sheets().map((s) => s.text)).toEqual(['a', null, 'c'])
  })
})

describe('createDeferredRun', () => {
  test('조합 중에는 미루고 끝난 뒤 flush 에서 한 번', () => {
    let composing = true
    const run = vi.fn()
    const deferred = createDeferredRun({ isComposing: () => composing, run })
    deferred.request()
    deferred.request()
    deferred.request()
    expect(run).toHaveBeenCalledTimes(0)
    deferred.flush()
    expect(run).toHaveBeenCalledTimes(0)
    composing = false
    deferred.flush()
    expect(run).toHaveBeenCalledTimes(1)
    deferred.flush()
    expect(run).toHaveBeenCalledTimes(1)
    deferred.request()
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('compileCached', () => {
  beforeEach(() => {
    compileSpy.mockClear()
    pruneCompileCache([])
  })

  test('같은 원문은 한 번만 컴파일', () => {
    expect(compileCached('x').css).toBe('c:x')
    expect(compileCached('x').css).toBe('c:x')
    expect(compileSpy).toHaveBeenCalledTimes(1)
    compileCached('y')
    expect(compileSpy).toHaveBeenCalledTimes(2)
  })

  test('pruneCompileCache 는 남길 원문만 둔다', () => {
    compileCached('x')
    compileCached('y')
    pruneCompileCache(['x'])
    compileCached('x')
    expect(compileSpy).toHaveBeenCalledTimes(2)
    compileCached('y')
    expect(compileSpy).toHaveBeenCalledTimes(3)
  })
})
