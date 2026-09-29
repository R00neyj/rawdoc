// 사용자 CSS 저장 — 두 슬롯 읽기·로컬 쓰기·부팅 값 (specs/features/F-2095.md 6장, 7.1)
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  USER_CSS_ACCOUNT_KEY,
  USER_CSS_KEY,
  editableSnippets,
  isBootCurrent,
  notifyUserCssChanged,
  readAccountSlot,
  readUserCssSources,
  saveLocalSnippets,
  saveUserCssSnippets,
  selectSlot,
  subscribeUserCss,
  writeUserCssBoot,
  type UserCssSources,
} from '../../../src/app/userCssStore'
import { USER_CSS_BOOT_KEY } from '../../../src/app/bootPaint'
import { USER_CSS_CHECKER_VERSION, USER_CSS_MAX_TOTAL_BYTES, buildUserCssBoot, type UserCssSnippet } from '../../../src/lib/userCssPolicy'

let store: Map<string, string>
let failSet: (key: string, value: string) => boolean

beforeEach(() => {
  store = new Map()
  failSet = () => false
  globalThis.localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      if (failSet(key, value)) throw new Error('QuotaExceededError')
      store.set(key, value)
    },
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size
    },
  } as Storage
})

const compile = (source: string) => ({ css: `c:${source}`, ruleCount: 1, removed: [] })

function snip(i: number, css: string, enabled = true): UserCssSnippet {
  return { id: i.toString(16).padStart(16, '0'), name: `스니펫 ${i}`, css, enabled, updatedAt: 1 }
}

const boot = (local: unknown, account: unknown = null, v: unknown = USER_CSS_CHECKER_VERSION) => JSON.stringify({ v, local, account })

describe('readUserCssSources', () => {
  test('두 슬롯을 읽는다', () => {
    store.set(USER_CSS_KEY, JSON.stringify({ snippets: [snip(1, 'a')] }))
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify({ userId: 'u1', rev: 3, snippets: [snip(2, 'b')], pending: { upserts: [], deletes: [] } }))
    expect(readUserCssSources()).toEqual({ local: [snip(1, 'a')], account: { userId: 'u1', snippets: [snip(2, 'b')] } })
  })

  test('없음·빈 값·깨짐·검증 실패는 로컬 [], 계정 null, 고쳐 쓰지 않는다', () => {
    expect(readUserCssSources()).toEqual({ local: [], account: null })
    const broken: [string, string][] = [
      ['', ''],
      ['{nope', '{nope'],
      [JSON.stringify([snip(1, 'a')]), JSON.stringify({ userId: 'u1' })],
      [JSON.stringify({ snippets: [{ ...snip(1, 'a'), id: 'x' }] }), JSON.stringify({ userId: '', snippets: [] })],
      [JSON.stringify({ snippets: 'a' }), JSON.stringify({ userId: 7, snippets: [] })],
      ['null', JSON.stringify({ userId: 'u1', snippets: [{ ...snip(1, 'a'), enabled: 'yes' }] })],
    ]
    for (const [local, account] of broken) {
      store.set(USER_CSS_KEY, local)
      store.set(USER_CSS_ACCOUNT_KEY, account)
      expect(readUserCssSources(), local).toEqual({ local: [], account: null })
      expect(store.get(USER_CSS_KEY)).toBe(local)
      expect(store.get(USER_CSS_ACCOUNT_KEY)).toBe(account)
    }
  })

  test('읽기가 던져도 빈 값', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('x') } } as unknown as Storage
    expect(readUserCssSources()).toEqual({ local: [], account: null })
  })
})

describe('selectSlot', () => {
  const sources: UserCssSources = { local: [snip(1, 'L')], account: { userId: 'u1', snippets: [snip(2, 'A')] } }
  test('계정 없음 → 로컬, 같은 계정 → 계정, 다른 계정·슬롯 없음 → []', () => {
    expect(selectSlot(sources, null)).toEqual([snip(1, 'L')])
    expect(selectSlot(sources, 'u1')).toEqual([snip(2, 'A')])
    expect(selectSlot(sources, 'u2')).toEqual([])
    expect(selectSlot({ ...sources, account: null }, 'u1')).toEqual([])
  })
})

describe('isBootCurrent', () => {
  test('부팅이 적용할 목록과 칸마다 같으면 참', () => {
    const raw = boot(['a', 'b'], { userId: 'u1', sheets: ['x'] })
    expect(isBootCurrent(raw, null, ['a', 'b'])).toBe(true)
    expect(isBootCurrent(raw, null, ['a'])).toBe(false)
    expect(isBootCurrent(raw, null, ['b', 'a'])).toBe(false)
    expect(isBootCurrent(raw, 'u1', ['x'])).toBe(true)
    expect(isBootCurrent(raw, 'u1', ['a', 'b'])).toBe(false)
    expect(isBootCurrent(raw, 'u2', [])).toBe(true)
    expect(isBootCurrent(raw, 'u2', ['x'])).toBe(false)
  })

  test('비었거나 깨졌거나 버전이 다르면 texts 가 빈 목록일 때만 참', () => {
    for (const raw of ['', '{nope', boot(['a'], null, USER_CSS_CHECKER_VERSION + 1), boot([1]), boot(Array(51).fill('a'))]) {
      expect(isBootCurrent(raw, null, []), raw.slice(0, 30)).toBe(true)
      expect(isBootCurrent(raw, null, ['a']), raw.slice(0, 30)).toBe(false)
    }
  })
})

describe('writeUserCssBoot', () => {
  test('buildUserCssBoot JSON 을 쓰고 성공 여부를 돌려준다', () => {
    const sources: UserCssSources = { local: [snip(1, 'a'), snip(2, 'b', false)], account: { userId: 'u1', snippets: [snip(3, 'c')] } }
    expect(writeUserCssBoot(sources, compile)).toBe(true)
    expect(store.get(USER_CSS_BOOT_KEY)).toBe(JSON.stringify(buildUserCssBoot(sources.local, sources.account, compile)))
    failSet = (key) => key === USER_CSS_BOOT_KEY
    expect(writeUserCssBoot(sources, compile)).toBe(false)
  })
})

describe('saveLocalSnippets', () => {
  const before = { local: JSON.stringify({ snippets: [snip(9, 'old')] }), boot: boot(['c:old']) }
  let heard: string[]
  let unsubscribe: () => void

  beforeEach(() => {
    store.set(USER_CSS_KEY, before.local)
    store.set(USER_CSS_BOOT_KEY, before.boot)
    heard = []
    unsubscribe = subscribeUserCss((origin) => heard.push(origin))
    return () => unsubscribe()
  })

  function expectUnchanged() {
    expect(store.get(USER_CSS_KEY)).toBe(before.local)
    expect(store.get(USER_CSS_BOOT_KEY)).toBe(before.boot)
    expect(heard).toEqual([])
  }

  test('ok — 원문·부팅 값을 쓰고 self 한 번', () => {
    const account = { userId: 'u1', rev: 1, snippets: [snip(3, 'acc')] }
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify(account))
    const next = [snip(1, 'a'), snip(2, 'b', false)]
    expect(saveLocalSnippets(next, compile)).toBe('ok')
    expect(JSON.parse(store.get(USER_CSS_KEY)!)).toEqual({ snippets: next })
    expect(store.get(USER_CSS_BOOT_KEY)).toBe(
      JSON.stringify(buildUserCssBoot(next, { userId: 'u1', snippets: account.snippets }, compile)),
    )
    expect(heard).toEqual(['self'])
  })

  test('count', () => {
    expect(saveLocalSnippets(Array.from({ length: 51 }, (_, i) => snip(i, 'a')), compile)).toBe('count')
    expectUnchanged()
  })

  test('bytes', () => {
    expect(saveLocalSnippets([snip(1, 'a'.repeat(USER_CSS_MAX_TOTAL_BYTES + 1))], compile)).toBe('bytes')
    expectUnchanged()
  })

  test('invalid', () => {
    expect(saveLocalSnippets([{ ...snip(1, 'a'), name: ' 앞공백' }], compile)).toBe('invalid')
    expect(saveLocalSnippets([snip(1, 'a'), snip(1, 'b')], compile)).toBe('invalid')
    expectUnchanged()
  })

  test('quota — 원문 쓰기가 던지면 아무것도 안 바뀜', () => {
    failSet = (key) => key === USER_CSS_KEY
    expect(saveLocalSnippets([snip(1, 'a')], compile)).toBe('quota')
    expectUnchanged()
  })

  test('부팅 값만 실패 — 원문은 쓰고 부팅 값은 빈 값, self 한 번, ok', () => {
    failSet = (key, value) => key === USER_CSS_BOOT_KEY && value !== ''
    expect(saveLocalSnippets([snip(1, 'a')], compile)).toBe('ok')
    expect(JSON.parse(store.get(USER_CSS_KEY)!)).toEqual({ snippets: [snip(1, 'a')] })
    expect(store.get(USER_CSS_BOOT_KEY)).toBe('')
    expect(heard).toEqual(['self'])
  })
})

describe('notifyUserCssChanged', () => {
  test('구독자에게 origin 을 알리고 해제하면 안 불린다', () => {
    const listener = vi.fn()
    const off = subscribeUserCss(listener)
    notifyUserCssChanged('remote')
    expect(listener).toHaveBeenCalledWith('remote')
    off()
    notifyUserCssChanged('self')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('F-2099 계정 슬롯', () => {
  const emptyPending = { upserts: [], deletes: [] }

  test('readAccountSlot 은 칸마다 기본값으로 읽고 account 판정은 readUserCssSources 와 같다', () => {
    expect(readAccountSlot()).toBeNull()
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify({ userId: 'u1', snippets: [snip(1, 'a')] }))
    expect(readAccountSlot()).toEqual({ userId: 'u1', rev: 0, snippets: [snip(1, 'a')], pending: emptyPending, mergedLocal: false, fetchedAt: 0, etag: '' })
    const odd = { userId: 'u1', snippets: [], rev: -1, pending: { upserts: ['0000000000000001', 'x', 3], deletes: 'no' }, mergedLocal: 'yes', fetchedAt: 'z', etag: 7 }
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify(odd))
    expect(readAccountSlot()).toEqual({ userId: 'u1', rev: 0, snippets: [], pending: { upserts: ['0000000000000001'], deletes: [] }, mergedLocal: false, fetchedAt: 0, etag: '' })
    for (const raw of ['', '{', JSON.stringify({ userId: '', snippets: [] }), JSON.stringify({ userId: 'u1', snippets: 'a' })]) {
      store.set(USER_CSS_ACCOUNT_KEY, raw)
      expect(readAccountSlot(), raw).toBeNull()
      expect(readUserCssSources().account).toBeNull()
    }
  })

  test('saveUserCssSnippets(null, …) 은 saveLocalSnippets 와 같다', () => {
    expect(saveUserCssSnippets(null, [snip(1, 'a')], compile)).toBe('ok')
    expect(JSON.parse(store.get(USER_CSS_KEY)!)).toEqual({ snippets: [snip(1, 'a')] })
    expect(store.has(USER_CSS_ACCOUNT_KEY)).toBe(false)
  })

  test('id 있음 — 슬롯에 pending 반영·부팅 값 account 갱신·self 한 번·로컬 슬롯 불변', () => {
    store.set(USER_CSS_KEY, JSON.stringify({ snippets: [snip(9, 'loc')] }))
    const localRaw = store.get(USER_CSS_KEY)
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify({ userId: 'u1', rev: 4, snippets: [snip(1, 'a'), snip(2, 'b')], pending: emptyPending, mergedLocal: true, fetchedAt: 5, etag: '"t"' }))
    const heard: string[] = []
    const off = subscribeUserCss((o) => heard.push(o))
    const next = [snip(1, 'a2'), snip(3, 'c')]
    expect(saveUserCssSnippets('u1', next, compile)).toBe('ok')
    off()
    const slot = readAccountSlot()!
    expect(slot).toMatchObject({ userId: 'u1', rev: 4, snippets: next, mergedLocal: true, fetchedAt: 5, etag: '"t"' })
    expect(slot.pending).toEqual({ upserts: [snip(1, 'x').id, snip(3, 'x').id], deletes: [snip(2, 'x').id] })
    expect(JSON.parse(store.get(USER_CSS_BOOT_KEY)!).account).toEqual({ userId: 'u1', sheets: ['c:a2', 'c:c'] })
    expect(heard).toEqual(['self'])
    expect(store.get(USER_CSS_KEY)).toBe(localRaw)
  })

  test('다른 사용자 슬롯이면 빈 새 슬롯에서 시작한다', () => {
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify({ userId: 'u1', rev: 4, snippets: [snip(1, 'a')], pending: { upserts: [snip(1, 'x').id], deletes: [] }, mergedLocal: true }))
    expect(saveUserCssSnippets('u2', [snip(5, 'z')], compile)).toBe('ok')
    expect(readAccountSlot()).toMatchObject({ userId: 'u2', rev: 0, snippets: [snip(5, 'z')], pending: { upserts: [snip(5, 'x').id], deletes: [] }, mergedLocal: false, etag: '' })
  })

  test('한도·검증 실패 코드와 quota 는 두 키를 바꾸지 않는다', () => {
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify({ userId: 'u1', snippets: [snip(1, 'a')] }))
    store.set(USER_CSS_BOOT_KEY, boot([]))
    const before = [store.get(USER_CSS_ACCOUNT_KEY), store.get(USER_CSS_BOOT_KEY)]
    expect(saveUserCssSnippets('u1', Array.from({ length: 51 }, (_, i) => snip(i, 'a')), compile)).toBe('count')
    expect(saveUserCssSnippets('u1', [{ ...snip(1, 'a'), name: ' x' }], compile)).toBe('invalid')
    failSet = (key) => key === USER_CSS_ACCOUNT_KEY
    expect(saveUserCssSnippets('u1', [snip(1, 'b')], compile)).toBe('quota')
    expect([store.get(USER_CSS_ACCOUNT_KEY), store.get(USER_CSS_BOOT_KEY)]).toEqual(before)
  })

  test('editableSnippets 세 갈래', () => {
    store.set(USER_CSS_KEY, JSON.stringify({ snippets: [snip(9, 'loc')] }))
    store.set(USER_CSS_ACCOUNT_KEY, JSON.stringify({ userId: 'u1', snippets: [snip(1, 'a')] }))
    expect(editableSnippets(null)).toEqual([snip(9, 'loc')])
    expect(editableSnippets('u1')).toEqual([snip(1, 'a')])
    expect(editableSnippets('u2')).toEqual([])
  })
})
