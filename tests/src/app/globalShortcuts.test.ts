import { describe, it, expect } from 'vitest'
import type { KeyEventLike } from '../../../src/app/shortcutUsage'
import {
  isFindKey,
  isPaletteKey,
  isSearchDialogKey,
  isAddCommentKey,
  isToggleCommentsKey,
  isShortcutsPanelKey,
} from '../../../src/app/globalShortcuts'

function ev(over: Partial<KeyEventLike>): KeyEventLike {
  return {
    key: '',
    code: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    timeStamp: 0,
    ...over,
  }
}

const TRUE_CASES = {
  isFindKey: [
    ev({ ctrlKey: true, key: 'f', code: 'KeyF' }),
    ev({ metaKey: true, key: 'f', code: 'KeyF' }),
    ev({ ctrlKey: true, key: 'F', code: 'KeyF' }),
    ev({ ctrlKey: true, key: 'f', code: 'KeyF', isComposing: true }),
  ],
  isPaletteKey: [
    ev({ ctrlKey: true, key: 'p', code: 'KeyP' }),
    ev({ metaKey: true, key: 'p', code: 'KeyP' }),
    ev({ ctrlKey: true, key: 'p', code: 'KeyP', isComposing: true }),
  ],
  isSearchDialogKey: [
    ev({ ctrlKey: true, shiftKey: true, key: 'F', code: 'KeyF' }),
    ev({ metaKey: true, shiftKey: true, key: 'F', code: 'KeyF' }),
    ev({ ctrlKey: true, shiftKey: true, key: 'f', code: 'KeyF' }),
    ev({ ctrlKey: true, shiftKey: true, key: 'F', code: 'KeyF', isComposing: true }),
  ],
  isAddCommentKey: [
    ev({ ctrlKey: true, altKey: true, key: 'm', code: 'KeyM' }),
    ev({ metaKey: true, altKey: true, key: 'µ', code: 'KeyM' }),
    ev({ ctrlKey: true, altKey: true, key: 'm', code: 'KeyM', keyCode: 229 }),
  ],
  isToggleCommentsKey: [
    ev({ ctrlKey: true, key: 'm', code: 'KeyM' }),
    ev({ ctrlKey: true, key: 'ㅡ', code: 'KeyM' }),
    ev({ ctrlKey: true, key: 'm', code: 'KeyM', keyCode: 229 }),
  ],
  isShortcutsPanelKey: [
    ev({ ctrlKey: true, shiftKey: true, key: '?', code: 'Slash' }),
    ev({ metaKey: true, shiftKey: true, key: '?', code: 'Slash' }),
    ev({ ctrlKey: true, shiftKey: true, key: '?', code: 'Slash', keyCode: 229 }),
  ],
}

const FNS = { isFindKey, isPaletteKey, isSearchDialogKey, isAddCommentKey, isToggleCommentsKey, isShortcutsPanelKey }

describe('F-2062 U1 isFindKey', () => {
  it('참', () => {
    for (const e of TRUE_CASES.isFindKey) expect(isFindKey(e)).toBe(true)
  })
  it('거짓', () => {
    expect(isFindKey(ev({ ctrlKey: true, shiftKey: true, key: 'F', code: 'KeyF' }))).toBe(false)
    expect(isFindKey(ev({ ctrlKey: true, altKey: true, key: 'f', code: 'KeyF' }))).toBe(false)
    expect(isFindKey(ev({ key: 'f', code: 'KeyF' }))).toBe(false)
    expect(isFindKey(ev({ ctrlKey: true, key: 'p', code: 'KeyP' }))).toBe(false)
    expect(isFindKey(ev({ ctrlKey: true, key: 'ㄹ', code: 'KeyF' }))).toBe(false)
  })
})

describe('F-2062 U2 isPaletteKey', () => {
  it('참', () => {
    for (const e of TRUE_CASES.isPaletteKey) expect(isPaletteKey(e)).toBe(true)
  })
  it('거짓', () => {
    expect(isPaletteKey(ev({ ctrlKey: true, shiftKey: true, key: 'P', code: 'KeyP' }))).toBe(false)
    expect(isPaletteKey(ev({ ctrlKey: true, altKey: true, key: 'p', code: 'KeyP' }))).toBe(false)
    expect(isPaletteKey(ev({ key: 'p', code: 'KeyP' }))).toBe(false)
    expect(isPaletteKey(ev({ ctrlKey: true, key: 'ㅔ', code: 'KeyP' }))).toBe(false)
  })
})

describe('F-2062 U3 isSearchDialogKey', () => {
  it('참', () => {
    for (const e of TRUE_CASES.isSearchDialogKey) expect(isSearchDialogKey(e)).toBe(true)
  })
  it('거짓', () => {
    expect(isSearchDialogKey(ev({ ctrlKey: true, key: 'f', code: 'KeyF' }))).toBe(false)
    expect(isSearchDialogKey(ev({ ctrlKey: true, shiftKey: true, altKey: true, key: 'F', code: 'KeyF' }))).toBe(false)
    expect(isSearchDialogKey(ev({ shiftKey: true, key: 'F', code: 'KeyF' }))).toBe(false)
  })
})

describe('F-2062 U4 isAddCommentKey', () => {
  it('참', () => {
    for (const e of TRUE_CASES.isAddCommentKey) expect(isAddCommentKey(e)).toBe(true)
  })
  it('거짓', () => {
    expect(isAddCommentKey(ev({ ctrlKey: true, altKey: true, key: 'm', code: 'KeyM', isComposing: true }))).toBe(false)
    expect(isAddCommentKey(ev({ ctrlKey: true, altKey: true, shiftKey: true, key: 'M', code: 'KeyM' }))).toBe(false)
    expect(isAddCommentKey(ev({ ctrlKey: true, key: 'm', code: 'KeyM' }))).toBe(false)
    expect(isAddCommentKey(ev({ ctrlKey: true, altKey: true, key: 'm', code: 'KeyN' }))).toBe(false)
  })
})

describe('F-2062 U5 isToggleCommentsKey', () => {
  it('참', () => {
    for (const e of TRUE_CASES.isToggleCommentsKey) expect(isToggleCommentsKey(e)).toBe(true)
  })
  it('거짓', () => {
    expect(isToggleCommentsKey(ev({ metaKey: true, key: 'm', code: 'KeyM' }))).toBe(false)
    expect(isToggleCommentsKey(ev({ ctrlKey: true, metaKey: true, key: 'm', code: 'KeyM' }))).toBe(false)
    expect(isToggleCommentsKey(ev({ ctrlKey: true, shiftKey: true, key: 'M', code: 'KeyM' }))).toBe(false)
    expect(isToggleCommentsKey(ev({ ctrlKey: true, altKey: true, key: 'm', code: 'KeyM' }))).toBe(false)
    expect(isToggleCommentsKey(ev({ ctrlKey: true, key: 'm', code: 'KeyM', isComposing: true }))).toBe(false)
  })
})

describe('F-2062 U6 isShortcutsPanelKey', () => {
  it('참', () => {
    for (const e of TRUE_CASES.isShortcutsPanelKey) expect(isShortcutsPanelKey(e)).toBe(true)
  })
  it('거짓', () => {
    expect(isShortcutsPanelKey(ev({ ctrlKey: true, key: '/', code: 'Slash' }))).toBe(false)
    expect(isShortcutsPanelKey(ev({ ctrlKey: true, shiftKey: true, altKey: true, key: '?', code: 'Slash' }))).toBe(false)
    expect(isShortcutsPanelKey(ev({ ctrlKey: true, shiftKey: true, key: '?', code: 'Slash', isComposing: true }))).toBe(false)
    expect(isShortcutsPanelKey(ev({ ctrlKey: true, shiftKey: true, key: '?', code: 'Period' }))).toBe(false)
  })
})

describe('F-2062 U7 참 사례마다 정확히 한 함수만 참', () => {
  it('여섯 함수', () => {
    for (const [name, cases] of Object.entries(TRUE_CASES)) {
      for (const e of cases) {
        const hits = Object.entries(FNS).filter(([, fn]) => fn(e)).map(([n]) => n)
        expect(hits).toEqual([name])
      }
    }
  })
})
