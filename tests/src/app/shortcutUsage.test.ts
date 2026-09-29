import { describe, expect, it } from 'vitest'
import { scopesFor, matchShortcut, parseUsed, serializeUsed, type TargetProbe, type MatchState, type KeyEventLike } from '../../../src/app/shortcutUsage'

function probe(selectors: Record<string, boolean>): TargetProbe {
  return {
    matches: (sel: string) => Boolean(selectors[sel]),
    closest: (sel: string) => (selectors[`closest:${sel}`] ? {} : null),
  }
}

describe('scopesFor — U5', () => {
  it('.cm-content 자신 → body·editor(+app·doc)', () => {
    const t = probe({ '.cm-content': true })
    const scopes = scopesFor(t, { dialogOpen: false, statusBar: true })
    expect(scopes.has('body')).toBe(true)
    expect(scopes.has('editor')).toBe(true)
    expect(scopes.has('app')).toBe(true)
    expect(scopes.has('doc')).toBe(true)
    expect(scopes.has('cell')).toBe(false)
  })

  it('칸 안 .cm-content → cell 만(편집기 계열)', () => {
    const t = probe({ '.cm-content': true, 'closest:.md-table-cell-editing': true })
    const scopes = scopesFor(t, { dialogOpen: false, statusBar: true })
    expect(scopes.has('cell')).toBe(true)
    expect(scopes.has('body')).toBe(false)
    expect(scopes.has('editor')).toBe(false)
  })

  it('.cm-panels 안 입력 → editor(body 아님)', () => {
    const t = probe({ 'closest:.cm-panels': true })
    const scopes = scopesFor(t, { dialogOpen: false, statusBar: true })
    expect(scopes.has('editor')).toBe(true)
    expect(scopes.has('body')).toBe(false)
  })

  it('textarea.doc-title → body 아님', () => {
    const t = probe({})
    const scopes = scopesFor(t, { dialogOpen: false, statusBar: true })
    expect(scopes.has('body')).toBe(false)
  })

  it('.comment-reply-input → comment', () => {
    const t = probe({ '.comment-composer-input, .comment-reply-input': true })
    const scopes = scopesFor(t, { dialogOpen: false, statusBar: true })
    expect(scopes.has('comment')).toBe(true)
  })

  it('null → app·doc 만', () => {
    const scopes = scopesFor(null, { dialogOpen: false, statusBar: true })
    expect(scopes).toEqual(new Set(['app', 'doc']))
  })

  it('dialogOpen: true 면 app·doc 없음', () => {
    const scopes = scopesFor(null, { dialogOpen: true, statusBar: true })
    expect(scopes.has('app')).toBe(false)
    expect(scopes.has('doc')).toBe(false)
  })

  it('statusBar: false 면 doc 없음', () => {
    const scopes = scopesFor(null, { dialogOpen: false, statusBar: false })
    expect(scopes.has('app')).toBe(true)
    expect(scopes.has('doc')).toBe(false)
  })
})

function ev(overrides: Partial<KeyEventLike>): KeyEventLike {
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
    ...overrides,
  }
}

const freshState: MatchState = { escapeAt: null }

describe('matchShortcut — U6', () => {
  it('Ctrl+B@body → format.bold', () => {
    const r = matchShortcut(ev({ key: 'b', code: 'KeyB', ctrlKey: true }), new Set(['body']), freshState, false)
    expect(r.id).toBe('format.bold')
  })

  it('Meta+B@body → format.bold', () => {
    const r = matchShortcut(ev({ key: 'b', code: 'KeyB', metaKey: true }), new Set(['body']), freshState, false)
    expect(r.id).toBe('format.bold')
  })

  it('Ctrl+M@doc → comment.toggleRail, Meta+M@doc → null (맥에서도 Control 그대로)', () => {
    const r1 = matchShortcut(ev({ key: 'm', code: 'KeyM', ctrlKey: true }), new Set(['doc']), freshState, true)
    expect(r1.id).toBe('comment.toggleRail')
    const r2 = matchShortcut(ev({ key: 'm', code: 'KeyM', metaKey: true }), new Set(['doc']), freshState, true)
    expect(r2.id).toBeNull()
  })

  it('Ctrl+Shift+Alt+B@body → null', () => {
    const r = matchShortcut(
      ev({ key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true, altKey: true }),
      new Set(['body']),
      freshState,
      false,
    )
    expect(r.id).toBeNull()
  })

  it('Ctrl+B@comment → null', () => {
    const r = matchShortcut(ev({ key: 'b', code: 'KeyB', ctrlKey: true }), new Set(['comment']), freshState, false)
    expect(r.id).toBeNull()
  })

  it('Tab@body → edit.indent', () => {
    const r = matchShortcut(ev({ key: 'Tab', code: 'Tab' }), new Set(['body']), freshState, false)
    expect(r.id).toBe('edit.indent')
  })

  it('Tab@cell → table.nextCell', () => {
    const r = matchShortcut(ev({ key: 'Tab', code: 'Tab' }), new Set(['cell']), freshState, false)
    expect(r.id).toBe('table.nextCell')
  })

  it('Esc@cell → table.exit', () => {
    const r = matchShortcut(ev({ key: 'Escape', code: 'Escape' }), new Set(['cell']), freshState, false)
    expect(r.id).toBe('table.exit')
  })

  it('Alt+Enter@cell → table.lineBreak', () => {
    const r = matchShortcut(ev({ key: 'Enter', code: 'Enter', altKey: true }), new Set(['cell']), freshState, false)
    expect(r.id).toBe('table.lineBreak')
  })

  it('Enter@body → null', () => {
    const r = matchShortcut(ev({ key: 'Enter', code: 'Enter' }), new Set(['body']), freshState, false)
    expect(r.id).toBeNull()
  })

  it('Ctrl+Enter@comment → comment.send', () => {
    const r = matchShortcut(ev({ key: 'Enter', code: 'Enter', ctrlKey: true }), new Set(['comment']), freshState, false)
    expect(r.id).toBe('comment.send')
  })

  it("Ctrl+Shift+/(key '?', code 'Slash')@doc → nav.shortcuts", () => {
    const r = matchShortcut(
      ev({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }),
      new Set(['doc', 'app']),
      freshState,
      false,
    )
    expect(r.id).toBe('nav.shortcuts')
  })

  it('같은 키 @app 만(상태바 없음) → null', () => {
    const r = matchShortcut(
      ev({ key: '?', code: 'Slash', ctrlKey: true, shiftKey: true }),
      new Set(['app']),
      freshState,
      false,
    )
    expect(r.id).toBeNull()
  })

  it('Ctrl+Y@body 맥 → null', () => {
    const r = matchShortcut(ev({ key: 'y', code: 'KeyY', ctrlKey: true }), new Set(['body']), freshState, true)
    expect(r.id).toBeNull()
  })

  it('Ctrl+Y@body 윈도우 → edit.redo', () => {
    const r = matchShortcut(ev({ key: 'y', code: 'KeyY', ctrlKey: true }), new Set(['body']), freshState, false)
    expect(r.id).toBe('edit.redo')
  })

  it('Shift+F10@body 맥 → null', () => {
    const r = matchShortcut(ev({ key: 'F10', code: 'F10', shiftKey: true }), new Set(['body']), freshState, true)
    expect(r.id).toBeNull()
  })
})

describe('matchShortcut — U7 순서 입력 (Esc 다음 Tab)', () => {
  it('Esc(t=0) → Tab(t=2000)@body → nav.leaveEditor', () => {
    const r1 = matchShortcut(ev({ key: 'Escape', code: 'Escape', timeStamp: 0 }), new Set(['body']), freshState, false)
    const r2 = matchShortcut(ev({ key: 'Tab', code: 'Tab', timeStamp: 2000 }), new Set(['body']), r1.state, false)
    expect(r2.id).toBe('nav.leaveEditor')
  })

  it('Esc(0) → Tab(2001) → edit.indent', () => {
    const r1 = matchShortcut(ev({ key: 'Escape', code: 'Escape', timeStamp: 0 }), new Set(['body']), freshState, false)
    const r2 = matchShortcut(ev({ key: 'Tab', code: 'Tab', timeStamp: 2001 }), new Set(['body']), r1.state, false)
    expect(r2.id).toBe('edit.indent')
  })

  it('Esc → a → Tab → edit.indent', () => {
    const r1 = matchShortcut(ev({ key: 'Escape', code: 'Escape', timeStamp: 0 }), new Set(['body']), freshState, false)
    const r2 = matchShortcut(ev({ key: 'a', code: 'KeyA', timeStamp: 10 }), new Set(['body']), r1.state, false)
    const r3 = matchShortcut(ev({ key: 'Tab', code: 'Tab', timeStamp: 20 }), new Set(['body']), r2.state, false)
    expect(r3.id).toBe('edit.indent')
  })

  it('Esc → Shift(수정키만) → Tab → nav.leaveEditor', () => {
    const r1 = matchShortcut(ev({ key: 'Escape', code: 'Escape', timeStamp: 0 }), new Set(['body']), freshState, false)
    const r2 = matchShortcut(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true, timeStamp: 10 }), new Set(['body']), r1.state, false)
    expect(r2.state).toBe(r1.state)
    const r3 = matchShortcut(ev({ key: 'Tab', code: 'Tab', timeStamp: 2000 }), new Set(['body']), r2.state, false)
    expect(r3.id).toBe('nav.leaveEditor')
  })

  it('isComposing 이거나 keyCode 229 인 어떤 키도 null 이고 state 가 그대로', () => {
    const r1 = matchShortcut(ev({ key: 'Escape', code: 'Escape', timeStamp: 0 }), new Set(['body']), freshState, false)
    const r2 = matchShortcut(ev({ key: 'b', code: 'KeyB', ctrlKey: true, isComposing: true }), new Set(['body']), r1.state, false)
    expect(r2.id).toBeNull()
    expect(r2.state).toBe(r1.state)
    const r3 = matchShortcut(ev({ key: 'b', code: 'KeyB', ctrlKey: true, keyCode: 229 }), new Set(['body']), r1.state, false)
    expect(r3.id).toBeNull()
    expect(r3.state).toBe(r1.state)
  })
})

describe('parseUsed·serializeUsed — U8', () => {
  it.each(['', '{', '{}', '"x"'])('parseUsed(%s) → 빈 집합', (raw) => {
    expect(parseUsed(raw)).toEqual(new Set())
  })

  it('parseUsed 는 배열 안 문자열만 남긴다', () => {
    expect(parseUsed('["format.bold",3,null,"x"]')).toEqual(new Set(['format.bold', 'x']))
  })

  it('serializeUsed 는 카탈로그 순서로 정렬하고 없는 id 는 버린다', () => {
    expect(serializeUsed(new Set(['x', 'table.exit', 'format.bold']))).toBe('["format.bold","table.exit"]')
  })
})
